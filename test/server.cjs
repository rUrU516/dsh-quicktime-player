/**
 * Static file server for the browser harness: serves the project directory and
 * sample.mp4 with HTTP Range, so the player gets a real streaming source.
 *
 *   node test/server.cjs            → prints the URL
 */
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.css': 'text/css; charset=utf-8',
}

function serveRange(req, res, file, size) {
  const match = /^bytes=(.+)$/iu.exec(req.headers.range || '')
  if (!match) {
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(size), 'accept-ranges': 'bytes' })
    fs.createReadStream(file).pipe(res)
    return
  }
  const spec = match[1].split(',')[0].trim()
  let start
  let end
  if (spec.startsWith('-')) {
    start = Math.max(0, size - Number(spec.slice(1)))
    end = size - 1
  } else {
    const [a, b] = spec.split('-')
    start = Number(a || 0)
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1)
  }
  if (!Number.isFinite(start) || start >= size) {
    res.writeHead(416, { 'content-range': `bytes */${size}` })
    res.end()
    return
  }
  res.writeHead(206, {
    'content-type': 'video/mp4',
    'accept-ranges': 'bytes',
    'content-range': `bytes ${start}-${end}/${size}`,
    'content-length': String(end - start + 1),
  })
  fs.createReadStream(file, { start, end }).pipe(res)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const relative = decodeURIComponent(url.pathname === '/' ? '/test/harness.html' : url.pathname)
  const file = path.join(ROOT, relative)
  if (!file.startsWith(ROOT)) {
    res.writeHead(403)
    res.end()
    return
  }
  fs.stat(file, (error, info) => {
    if (error || !info.isFile()) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    if (path.extname(file) === '.mp4') {
      serveRange(req, res, file, info.size)
      return
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'content-length': String(info.size) })
    fs.createReadStream(file).pipe(res)
  })
})

server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => {
  const { port } = server.address()
  console.log(`http://127.0.0.1:${port}/test/harness.html`)
  console.log(`http://127.0.0.1:${port}/test/harness.html?mode=body`)
})
