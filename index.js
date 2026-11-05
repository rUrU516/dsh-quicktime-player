/**
 * dsh-quicktime-player — Host half.
 *
 * One job: hand the browser a URL it can stream a local video file from, with
 * real HTTP Range support, so `<video>` can seek.
 *
 * Why not the built-in routes?
 *  - `/api/file` reads the whole file into memory and answers `200` only (and
 *    is capped by the image limit), so a video cannot be scrubbed.
 *  - better-sidebar's `/sidebar/file` streams but also answers `200` only, so
 *    Chromium disables scrubbing (`seekable` stays `[0, 0]`).
 *
 * And why a loopback port on top of a same-origin route?
 *  - The Desktop shell serves the page from `dsh-app://app`; every other path
 *    is proxied to the Host over `protocol.handle`. Chromium's media stack
 *    cannot seek responses that come out of a custom protocol handler
 *    (electron/electron#38749), so a video played through `dsh-app://` starts
 *    fine and snaps back to 0 on every scrub.
 *  - A plain `http://127.0.0.1:<port>` origin has no such limitation. The
 *    player therefore asks for a source URL, and this plugin answers with a
 *    tokenized loopback URL when it can, falling back to the same-origin route.
 *
 * Nothing here is configurable: the route prefix, the 4 GiB ceiling and the loopback media server are fixed, and
 * files are confined to the session working directory.
 */
import { createReadStream, readFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { appendFile, mkdir, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Stable Cordis plugin name. */
export const name = 'quicktime-player'

/** Everything below needs the HTTP carrier; sessions/files are read lazily. */
export const inject = ['webServer']

const MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.qt': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.ogg': 'video/ogg',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.ts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.mts': 'video/mp2t',
  '.3gp': 'video/3gpp',
  '.3g2': 'video/3gpp2',
}

/** Fixed behaviour: this plugin exposes no configuration by design. */
const ROUTE_PREFIX = '/quicktime'
const MAX_BYTES = 4 * 1024 * 1024 * 1024

function diagnosePath() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(home, 'quicktime-player.log')
}

async function diagnose(line) {
  try {
    const file = diagnosePath()
    await mkdir(dirname(file), { recursive: true })
    await appendFile(file, `${new Date().toISOString()} ${line}\n`, 'utf8')
  } catch {
    // Diagnostics must never break playback.
  }
}

function header(headers, key) {
  const value = headers[key]
  return typeof value === 'string' ? value : undefined
}

function parseAuthority(authority) {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255)
}

/**
 * Browser-request fence: loopback Host, no cross-site marker, Origin (when
 * present) must be the same authority. Mirrors the /api gateway's checks so a
 * random web page cannot read local files through this route.
 */
function isTrustedRequest(request) {
  const host = header(request.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname)) return false
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(request.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function normPath(value) {
  return value.replace(/[\\/]+/gu, '/').replace(/\/$/u, '')
}

function isWithin(base, target) {
  const b = normPath(base)
  const t = normPath(target)
  if (process.platform === 'win32') {
    const lb = b.toLowerCase()
    const lt = t.toLowerCase()
    return lt === lb || lt.startsWith(`${lb}/`)
  }
  return t === b || t.startsWith(`${b}/`)
}

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function sendText(res, status, text) {
  const body = Buffer.from(text, 'utf8')
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'content-length': String(body.length) })
  res.end(body)
}

/**
 * Parse one `Range: bytes=…` header against a known size.
 * Multi-range requests are answered from their first range only, which the
 * specification allows and every media element is happy with.
 */
function parseRange(raw, size) {
  if (raw === undefined) return null
  const match = /^bytes=(.+)$/iu.exec(raw.trim())
  if (!match) return null
  const spec = match[1].split(',')[0].trim()
  if (spec === '') return null
  if (spec.startsWith('-')) {
    const suffix = Number(spec.slice(1))
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    if (suffix >= size) return { start: 0, end: size - 1 }
    return { start: size - suffix, end: size - 1 }
  }
  const dash = spec.indexOf('-')
  if (dash === -1) return null
  const startText = spec.slice(0, dash)
  const endText = spec.slice(dash + 1)
  const start = startText === '' ? 0 : Number(startText)
  const end = endText === '' ? size - 1 : Number(endText)
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(end)) return null
  if (start >= size) return { unsatisfiable: true }
  return { start, end: Math.min(end, size - 1) }
}

/** Stream one file (or one byte window of it) with the headers media needs. */
function streamFile(request, res, target, size, type, extraHeaders) {
  const headers = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    ...extraHeaders,
  }
  const range = parseRange(header(request.headers, 'range'), size)
  if (range !== null && range.unsatisfiable) {
    res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` })
    res.end()
    return
  }
  if (range !== null) {
    const { start, end } = range
    res.writeHead(206, {
      ...headers,
      'content-range': `bytes ${start}-${end}/${size}`,
      'content-length': String(end - start + 1),
    })
    if (request.method === 'HEAD') {
      res.end()
      return
    }
    const stream = createReadStream(target, { start, end })
    stream.on('error', () => res.destroy())
    res.on('close', () => stream.destroy())
    stream.pipe(res)
    return
  }
  res.writeHead(200, { ...headers, 'content-length': String(size) })
  if (request.method === 'HEAD') {
    res.end()
    return
  }
  const stream = createReadStream(target)
  stream.on('error', () => res.destroy())
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}

/**
 * Where ffmpeg might live. GUI launches usually carry a minimal PATH, so the
 * Homebrew prefixes are probed explicitly before falling back to PATH lookup.
 */
const FFMPEG_CANDIDATES = () => [
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  'ffmpeg',
]

let ffmpegProbe

/** Find a working ffmpeg once, caching both hit and miss for a minute. */
function findFfmpeg() {
  const now = Date.now()
  if (ffmpegProbe !== undefined && now - ffmpegProbe.at < 60000) return ffmpegProbe.value
  let value = null
  for (const candidate of FFMPEG_CANDIDATES()) {
    try {
      const output = execFileSync(candidate, ['-version'], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] })
      const version = String(output).split('\n')[0].trim()
      value = { available: true, path: candidate, version }
      break
    } catch {
      // try the next candidate
    }
  }
  if (value === null) value = { available: false }
  ffmpegProbe = { at: now, value }
  return value
}

/** How to hand one path to the OS. Returns null where there is no opener. */
function opener(target, reveal) {
  if (process.platform === 'darwin') return { bin: 'open', args: reveal ? ['-R', target] : [target] }
  if (process.platform === 'win32') {
    return reveal
      ? { bin: 'explorer.exe', args: ['/select,' + target] }
      : { bin: 'cmd.exe', args: ['/c', 'start', '', target] }
  }
  if (process.platform === 'linux') return { bin: 'xdg-open', args: [reveal ? dirname(target) : target] }
  return null
}

/**
 * Render one clip with ffmpeg's stream copy: no re-encode, so the cut lands on
 * the nearest keyframe before `from`. Resolves with the temp file path.
 */
function renderClip(ffmpegPath, input, from, to, target) {
  return new Promise((resolve, reject) => {
    const duration = Math.max(0.1, to - from)
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-ss', String(from),
      '-i', input,
      '-t', String(duration),
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      '-map', '0',
      '-y', target,
    ]
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000)
    child.stderr.on('data', (chunk) => { if (stderr.length < 4000) stderr += String(chunk) })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(target)
      else reject(new Error(stderr.trim() || ('ffmpeg exited with ' + String(code))))
    })
  })
}

/**
 * Resolve one request's file, refusing anything outside the session working
 * directory (or an explicitly configured extra root).
 *
 * The native document preview hands out `dsh-resource://file/session/<id>/<path>`
 * addresses whose path is often **relative to the session cwd** (`test/a.mp4`),
 * while better-sidebar hands out absolute ones. Both are accepted; a relative
 * path is resolved against the session cwd before the containment check.
 */
async function resolveRequestedFile(ctx, sessionId, rawPath) {
  if (typeof sessionId !== 'string' || sessionId === '') throw new HttpError(400, 'sessionId is required')
  if (typeof rawPath !== 'string' || rawPath === '') throw new HttpError(400, 'path is required')
  if (rawPath.includes('\0')) throw new HttpError(400, 'invalid path')

  const sessions = ctx.get('sessions')
  const session = sessions?.get?.(sessionId)
  const sessionCwd = typeof session?.header?.cwd === 'string' && session.header.cwd !== '' ? session.header.cwd : process.cwd()

  const absolute = rawPath.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(rawPath) || rawPath.startsWith('\\\\')
  const target = absolute ? resolve(rawPath) : resolve(sessionCwd, rawPath)
  const allowed = isWithin(resolve(sessionCwd), target)
  if (!allowed) throw new HttpError(403, 'path is outside the session working directory')

  let info
  try {
    info = await stat(target)
  } catch {
    throw new HttpError(404, 'file not found')
  }
  if (!info.isFile()) throw new HttpError(400, 'not a regular file')
  if (info.size === 0) throw new HttpError(400, 'empty file')
  if (info.size > MAX_BYTES) throw new HttpError(413, `file exceeds ${MAX_BYTES} bytes`)
  return { target, size: info.size, type: MIME[extname(target).toLowerCase()] ?? 'application/octet-stream', name: basename(target) }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function fail(res, error) {
  if (res.headersSent) {
    res.destroy()
    return
  }
  const status = error instanceof HttpError ? error.status : 500
  sendText(res, status, error instanceof Error ? error.message : String(error))
}

/**
 * Register the routes and (optionally) the loopback media server.
 * @param ctx - Host plugin context carrying `webServer`.
 */
export function apply(ctx) {
  const token = randomBytes(18).toString('base64url')
  const state = { port: 0 }

  const loopbackUrl = (sessionId, path) => {
    const query = new URLSearchParams({ sessionId, path })
    return `http://127.0.0.1:${String(state.port)}/media/${token}?${query.toString()}`
  }
  const sameOriginUrl = (sessionId, path) => {
    const query = new URLSearchParams({ sessionId, path })
    return `${ROUTE_PREFIX}/stream?${query.toString()}`
  }

  /** `GET <prefix>/source` — describe the file and hand back a playable URL. */
  const handleSource = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const file = await resolveRequestedFile(ctx, url.searchParams.get('sessionId'), url.searchParams.get('path'))
    const sessionId = url.searchParams.get('sessionId')
    const path = url.searchParams.get('path')
    const useLoopback = state.port !== 0
    sendJson(res, 200, {
      url: useLoopback ? loopbackUrl(sessionId, path) : sameOriginUrl(sessionId, path),
      transport: useLoopback ? 'loopback' : 'same-origin',
      size: file.size,
      mime: file.type,
      name: file.name,
      absolutePath: file.target,
    })
  }

  /** `GET|HEAD <prefix>/stream` — same-origin Range stream (loopback fallback). */
  const handleStream = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const file = await resolveRequestedFile(ctx, url.searchParams.get('sessionId'), url.searchParams.get('path'))
    streamFile(req, res, file.target, file.size, file.type)
  }

  /** `POST <prefix>/diag` — player-side diagnostics, one JSON line per event. */
  const handleDiag = async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf8').slice(0, 8192)
    await diagnose(text.replace(/\s+/gu, ' ').trim())
    sendJson(res, 200, { ok: true })
  }

  /**
   * `GET <prefix>/icon` — the player's artwork.
   *
   * Served from `icon.png` beside this file when it exists (a local copy of the
   * QuickTime Player icon, generated on the machine and git-ignored), otherwise
   * from the redrawn `icon.svg` that ships with the package.
   */
  const handleIcon = async (req, res) => {
    const folder = dirname(fileURLToPath(import.meta.url))
    for (const [file, type] of [['icon.png', 'image/png'], ['icon.svg', 'image/svg+xml']]) {
      try {
        const target = join(folder, file)
        const info = await stat(target)
        if (!info.isFile()) continue
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache', 'content-length': String(info.size) })
        createReadStream(target).pipe(res)
        return
      } catch {
        // try the next candidate
      }
    }
    sendText(res, 404, 'no icon')
  }

  /** Our own version, read per request: caching it made a bumped package look stale. */
  const installedVersion = () => {
    try {
      return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version ?? null
    } catch {
      return null
    }
  }

  /** `GET <prefix>/version` — manual update check against the public registry. */
  const handleVersion = async (req, res) => {
    let latest = null
    let error = null
    try {
      const response = await fetch('https://registry.npmjs.org/dsh-quicktime-player/latest', {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(6000),
      })
      if (!response.ok) throw new Error('registry answered ' + String(response.status))
      const info = await response.json()
      if (typeof info.version === 'string') latest = info.version
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
    sendJson(res, 200, { installed: installedVersion(), latest, error })
  }

  /**
   * `GET <prefix>/open?sessionId&path&action=open|reveal` — hand the file to the
   * desktop. Staying on this side avoids depending on a client-side Remote seam.
   */
  const handleOpen = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const file = await resolveRequestedFile(ctx, url.searchParams.get('sessionId'), url.searchParams.get('path'))
    const reveal = url.searchParams.get('action') === 'reveal'
    const command = opener(file.target, reveal)
    if (command === null) throw new HttpError(501, 'this platform has no desktop opener')
    await new Promise((resolve, reject) => {
      const child = spawn(command.bin, command.args, { detached: true, stdio: 'ignore' })
      child.on('error', reject)
      child.on('spawn', () => { child.unref(); resolve() })
    })
    sendJson(res, 200, { ok: true })
  }

  /** `GET <prefix>/capabilities` — what this Host can actually do. */
  const handleCapabilities = async (req, res) => {
    const ffmpeg = findFfmpeg()
    sendJson(res, 200, {
      ffmpeg: ffmpeg.available
        ? { available: true, path: ffmpeg.path, version: ffmpeg.version }
        : { available: false },
      opener: { available: opener('/tmp/x', false) !== null },
    })
  }

  /**
   * `GET <prefix>/clip?sessionId&path&from&to` — cut one range out of a video
   * and hand it back as a download. Stream copy, so the cut lands on a keyframe.
   */
  const handleClip = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const from = Number(url.searchParams.get('from'))
    const to = Number(url.searchParams.get('to'))
    if (!Number.isFinite(from) || !Number.isFinite(to) || to - from < 0.1) {
      throw new HttpError(400, 'a range of at least 0.1 s is required')
    }
    const file = await resolveRequestedFile(ctx, url.searchParams.get('sessionId'), url.searchParams.get('path'))
    const ffmpeg = findFfmpeg()
    if (!ffmpeg.available) throw new HttpError(501, 'ffmpeg is not available on this Host')
    const extension = extname(file.target).toLowerCase() || '.mp4'
    const target = join(tmpdir(), `qtp-clip-${randomBytes(6).toString('hex')}${extension}`)
    try {
      await renderClip(ffmpeg.path, file.target, Math.max(0, from), to, target)
      const info = await stat(target)
      if (info.size > MAX_BYTES) throw new HttpError(413, 'clip exceeds the size limit')
      const stamp = (seconds) => `${Math.floor(seconds / 60)}m${String(Math.round(seconds % 60)).padStart(2, '0')}s`
      const name = `${basename(file.target, extension)}.trim-${stamp(Math.max(0, from))}-${stamp(to)}${extension}`
      res.writeHead(200, {
        'content-type': file.type,
        'content-length': String(info.size),
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        'cache-control': 'no-store',
      })
      const stream = createReadStream(target)
      stream.on('error', () => res.destroy())
      res.on('close', () => {
        stream.destroy()
        rm(target, { force: true }).catch(() => {})
      })
      stream.pipe(res)
    } catch (error) {
      rm(target, { force: true }).catch(() => {})
      throw error
    }
  }

  /** `GET <prefix>/_graph` — dev probe: is our client bundle in the module graph? */
  const handleGraph = async (req, res) => {
    const modules = ctx.get('clientModules')
    const graph = modules?.graph?.()
    const rows = Array.isArray(graph?.entries) ? graph.entries : []
    const mine = rows.filter((row) => typeof row?.id === 'string' && row.id.includes('quicktime'))
    sendJson(res, 200, {
      release: graph?.release,
      total: rows.length,
      ids: rows.map((row) => row?.id).filter((id) => typeof id === 'string').sort(),
      mine,
      clientPath: modules?.clientPath?.('dsh-quicktime-player') ?? null,
    })
  }

  ctx.effect(() => {
    const handler = async (req, res) => {
      if (!isTrustedRequest(req)) {
        sendText(res, 403, 'forbidden')
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      try {
        if (pathname === `${ROUTE_PREFIX}/source`) {
          if (req.method !== 'GET') {
            sendText(res, 405, 'method not allowed')
            return
          }
          await handleSource(req, res)
          return
        }
        if (pathname === `${ROUTE_PREFIX}/stream`) {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendText(res, 405, 'method not allowed')
            return
          }
          await handleStream(req, res)
          return
        }
        if (pathname === `${ROUTE_PREFIX}/diag`) {
          if (req.method !== 'POST') {
            sendText(res, 405, 'method not allowed')
            return
          }
          await handleDiag(req, res)
          return
        }
        if (pathname === `${ROUTE_PREFIX}/version`) {
          await handleVersion(req, res)
          return
        }
        if (pathname === `${ROUTE_PREFIX}/capabilities`) {
          await handleCapabilities(req, res)
          return
        }
        if (pathname === `${ROUTE_PREFIX}/open`) {
          await handleOpen(req, res)
          return
        }
        if (pathname === `${ROUTE_PREFIX}/clip`) {
          await handleClip(req, res)
          return
        }
        if (pathname === `${ROUTE_PREFIX}/icon`) {
          await handleIcon(req, res)
          return
        }
        if (pathname === `${ROUTE_PREFIX}/_graph`) {
          await handleGraph(req, res)
          return
        }
        sendText(res, 404, 'not found')
      } catch (error) {
        fail(res, error)
      }
    }
    return ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler })
  }, 'quicktime-player: routes')

  {
    ctx.effect(() => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        if (url.pathname !== `/media/${token}`) {
          sendText(res, 404, 'not found')
          return
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendText(res, 405, 'method not allowed')
          return
        }
        resolveRequestedFile(ctx, url.searchParams.get('sessionId'), url.searchParams.get('path'))
          .then((file) => streamFile(req, res, file.target, file.size, file.type, { 'access-control-allow-origin': '*' }))
          .catch((error) => fail(res, error))
      })
      server.on('error', () => {
        state.port = 0
      })
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        state.port = address !== null && typeof address === 'object' ? address.port : 0
      })
      return () => {
        state.port = 0
        server.close()
        server.closeAllConnections?.()
      }
    }, 'quicktime-player: loopback media server')
  }

  ctx.effect(() => {
    ctx.on('webserver/index-inject', (table) => {
      table.push({ kind: 'global', name: '__DSH_QUICKTIME_PLAYER__', value: { routePrefix: ROUTE_PREFIX } })
    })
  }, 'quicktime-player: index injection')
}
