/**
 * Real-browser harness driver: starts the static server, launches headless
 * Chrome, loads test/harness.html in both modes, and reports
 *   - harness stage (apply / render)
 *   - console errors + uncaught exceptions
 *   - whether the player mounted (video element, controls, metadata)
 *   - whether the main thread stays responsive (freeze probe)
 *   - whether a wheel gesture reaches the zoom path
 *
 *   node test/browser.cjs
 */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ROOT = path.resolve(__dirname, '..')

// ── static server (same behaviour as test/server.cjs) ───────────────────────
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      const relative = decodeURIComponent(url.pathname === '/' ? '/test/harness.html' : url.pathname)
      const file = path.join(ROOT, relative)
      const stat = fs.statSync(file, { throwIfNoEntry: false })
      if (!stat || !stat.isFile()) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      if (path.extname(file) === '.mp4' && req.headers.range) {
        const match = /^bytes=(.+)$/iu.exec(req.headers.range)
        const spec = match[1].split(',')[0].trim()
        const [a, b] = spec.split('-')
        const start = a === '' ? stat.size - Number(b) : Number(a)
        const end = b === '' ? stat.size - 1 : Math.min(Number(b), stat.size - 1)
        res.writeHead(206, {
          'content-type': 'video/mp4',
          'accept-ranges': 'bytes',
          'content-range': `bytes ${start}-${end}/${stat.size}`,
          'content-length': String(end - start + 1),
        })
        fs.createReadStream(file, { start, end }).pipe(res)
        return
      }
      const type = file.endsWith('.html') ? 'text/html; charset=utf-8'
        : file.endsWith('.mp4') ? 'video/mp4'
        : file.endsWith('.js') || file.endsWith('.cjs') ? 'text/javascript; charset=utf-8'
        : 'application/octet-stream'
      res.writeHead(200, { 'content-type': type, 'content-length': String(stat.size), 'accept-ranges': 'bytes' })
      fs.createReadStream(file).pipe(res)
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

// ── minimal CDP client ──────────────────────────────────────────────────────
class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.handlers = []
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== undefined) {
        const entry = this.pending.get(message.id)
        if (entry) {
          this.pending.delete(message.id)
          message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result)
        }
        return
      }
      for (const handler of this.handlers) handler(message)
    })
  }
  static async connect(url) {
    const socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    return new Cdp(socket)
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    this.ws.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
  on(handler) {
    this.handlers.push(handler)
  }
  close() {
    try { this.ws.close() } catch (error) { /* ignore */ }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function launchChrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qtp-chrome-'))
  const child = spawn(CHROME, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--window-size=1280,900',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  const portFile = path.join(profile, 'DevToolsActivePort')
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fs.existsSync(portFile)) break
    await sleep(100)
  }
  const [port, browserPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n')
  const cdp = await Cdp.connect(`ws://127.0.0.1:${port}${browserPath}`)
  return { child, cdp, profile }
}

async function runMode(cdp, base, mode, options = {}) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const errors = []
  cdp.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '))
    }
  })
  await cdp.send('Runtime.enable', {}, sessionId)
  await cdp.send('Page.enable', {}, sessionId)
  await cdp.send('Page.navigate', { url: `${base}/test/harness.html?mode=${mode}` }, sessionId)

  const evaluate = async (expression, awaitPromise = false) => {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, timeout: 4000 }, sessionId)
    if (result.exceptionDetails) return { exception: result.exceptionDetails.exception?.description ?? result.exceptionDetails.text }
    return { value: result.result.value }
  }

  await sleep(2500)

  // freeze probe: does a 50 ms timer still run while the player is mounted?
  let responsive = 'unknown'
  const probe = await Promise.race([
    evaluate('new Promise((resolve) => setTimeout(() => resolve("tick"), 50))', true),
    sleep(3000).then(() => 'timeout'),
  ])
  responsive = probe === 'timeout' ? 'BLOCKED' : probe.value

  let preFeed = null
  if (options.feedLocal) {
    preFeed = await evaluate(`(() => ({
      hasEmpty: !!document.querySelector('.qtp-empty'),
      hasVideo: !!document.querySelector('video'),
    }))()`)
    await evaluate('window.__feedLocal().then(() => true)', true)
    await sleep(1800)
  }

  const snapshot = await evaluate(`(() => {
    const video = document.querySelector('video')
    const root = document.querySelector('.qtp-root')
    return {
      harness: window.__harnessResult || null,
      errors: window.__errors || [],
      diag: (window.__diag || []).map((entry) => JSON.stringify(entry)),
      videoError: video && video.error ? { code: video.error.code, message: video.error.message } : null,
      networkState: video ? video.networkState : null,
      hasRoot: !!root,
      hasVideo: !!video,
      videoSrc: video ? video.getAttribute('src') : null,
      readyState: video ? video.readyState : null,
      duration: video ? video.duration : null,
      seekable: video && video.seekable.length ? [video.seekable.start(0), video.seekable.end(video.seekable.length - 1)] : [],
      buttons: document.querySelectorAll('.qtp-btn').length,
      headerPath: (() => { const el = document.querySelector('.qtp-headerPath'); return el ? el.textContent : null })(),
      transform: (() => { const el = document.querySelector('.qtp-canvas'); return el ? getComputedStyle(el).transform : null })(),
      rootHeight: root ? Math.round(root.getBoundingClientRect().height) : 0,
    }
  })()`)

  // ── toolbar interactions (own tab only) ─────────────────────────────────
  let interactions = null
  if (mode === 'tab') {
    const before = await evaluate(`(() => ({
      time: document.querySelector('.qtp-time') ? document.querySelector('.qtp-time').textContent : null,
      buttons: document.querySelectorAll('.qtp-row .qtp-btn').length,
      hasFit: !!document.querySelector('[title^="缩放归位"]'),
    }))()`)

    // click the clock: time -> frame numbers
    await evaluate(`(() => { const el = document.querySelector('.qtp-time'); if (el) el.click(); return true })()`)
    await sleep(200)
    const frameText = await evaluate(`(() => { const el = document.querySelector('.qtp-time'); return el ? el.textContent : null })()`)

    // hover the volume anchor: a vertical slider must pop up
    await evaluate(`(() => {
      const anchors = document.querySelectorAll('.qtp-anchor')
      const volume = anchors[anchors.length - 1]
      if (volume) volume.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
      return true
    })()`)
    await sleep(200)
    const volumePop = await evaluate(`(() => {
      const slider = document.querySelector('.qtp-pop .qtp-vslider')
      if (!slider) return null
      const style = getComputedStyle(slider)
      return { writingMode: style.writingMode, height: Math.round(slider.getBoundingClientRect().height), width: Math.round(slider.getBoundingClientRect().width) }
    })()`)

    // hover the rate anchor and drive its slider
    await evaluate(`(() => {
      const anchors = document.querySelectorAll('.qtp-anchor')
      if (anchors[0]) anchors[0].dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
      return true
    })()`)
    await sleep(200)
    const rateApplied = await evaluate(`(() => {
      const slider = document.querySelector('.qtp-pop .qtp-vslider')
      if (!slider) return null
      window.__rateSlider = { min: slider.min, max: slider.max, step: slider.step }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(slider, '2.4')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      const video = document.querySelector('video')
      return video ? video.playbackRate : null
    })()`)

    // focus the rate slider on purpose: Space and the arrows must still reach
    // the player instead of being eaten by the focused control
    const sliderFocused = await evaluate(`(() => {
      const slider = document.querySelector('.qtp-pop .qtp-vslider')
      if (!slider) return null
      slider.focus()
      return { focused: document.activeElement === slider, range: window.__rateSlider }
    })()`)

    const press = async (key, code, virtualKeyCode, modifiers = 0) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKeyCode, modifiers, ...(key === ' ' ? { text: ' ' } : {}) }, sessionId)
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKeyCode, modifiers }, sessionId)
      await sleep(250)
    }

    await press(' ', 'Space', 32)
    const afterSpace = await evaluate(`(() => { const v = document.querySelector('video'); return v ? { paused: v.paused, time: v.currentTime } : null })()`)

    await press('ArrowRight', 'ArrowRight', 39)
    const afterStep = await evaluate(`(() => { const v = document.querySelector('video'); return v ? { time: v.currentTime, paused: v.paused } : null })()`)

    // focus the ? button: Space must still play/pause instead of activating it
    const helpButtonFocus = await evaluate(`(() => {
      const button = document.querySelector('.qtp-helpBtn')
      if (!button) return null
      button.focus()
      return document.activeElement === button
    })()`)
    const pausedBeforeSpace = await evaluate(`(() => { const v = document.querySelector('video'); return v ? v.paused : null })()`)
    await press(' ', 'Space', 32)
    const afterSpaceOnButton = await evaluate(`(() => {
      const v = document.querySelector('video')
      return {
        paused: v ? v.paused : null,
        layerOpened: document.querySelector('.qtp-helpLayer') !== null,
      }
    })()`)

    // the "?" button opens a layer that covers the whole stage; a second click closes it
    const helpClosedBefore = await evaluate(`(() => document.querySelector('.qtp-helpLayer') === null)()`)
    await evaluate(`(() => { const b = document.querySelector('.qtp-helpBtn'); if (b) b.click(); return true })()`)
    await sleep(200)
    const helpOpen = await evaluate(`(() => {
      const layer = document.querySelector('.qtp-helpLayer')
      if (!layer) return null
      const l = layer.getBoundingClientRect()
      const pane = document.querySelector('.qtp-pane').getBoundingClientRect()
      const button = document.querySelector('.qtp-helpBtn')
      const buttonBox = button ? button.getBoundingClientRect() : null
      return {
        covers: Math.abs(l.top - pane.top) < 2 && Math.abs(l.height - pane.height) < 2,
        clickThrough: getComputedStyle(layer).pointerEvents === 'none',
        buttonOnTop: button ? Number(getComputedStyle(button).zIndex) > Number(getComputedStyle(layer).zIndex) : false,
        buttonInLayer: buttonBox ? buttonBox.top >= l.top && buttonBox.top <= l.bottom : false,
        text: layer.textContent,
        glyph: (document.querySelector('.qtp-helpBtn') || {}).textContent || '',
      }
    })()`)
    // a real click in the middle of the layer must reach the video underneath
    const pausedBeforeThrough = await evaluate(`(() => { const v = document.querySelector('video'); return v ? v.paused : null })()`)
    const centre = await evaluate(`(() => { const r = document.querySelector('.qtp-stage').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
    if (centre.value) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: centre.value.x, y: centre.value.y, button: 'left', clickCount: 1 }, sessionId)
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: centre.value.x, y: centre.value.y, button: 'left', clickCount: 1 }, sessionId)
      await sleep(300)
    }
    const pausedAfterThrough = await evaluate(`(() => { const v = document.querySelector('video'); return v ? v.paused : null })()`)

    await evaluate(`(() => { const b = document.querySelector('.qtp-helpBtn'); if (b) b.click(); return true })()`)
    await sleep(200)
    const helpClosedAfter = await evaluate(`(() => document.querySelector('.qtp-helpLayer') === null)()`)

    interactions = {
      helpButtonFocus: helpButtonFocus.value,
      spaceOnButtonPaused: afterSpaceOnButton.value ? afterSpaceOnButton.value.paused : null,
      spaceOnButtonOpenedLayer: afterSpaceOnButton.value ? afterSpaceOnButton.value.layerOpened : null,
      pausedBeforeSpace: pausedBeforeSpace.value,
      helpCoversStage: helpOpen.value ? helpOpen.value.covers : null,
      helpButtonOnTop: helpOpen.value ? helpOpen.value.buttonOnTop : null,
      helpClickThrough: helpOpen.value ? helpOpen.value.clickThrough : null,
      clickThroughWorked: pausedBeforeThrough.value !== pausedAfterThrough.value,
      helpText: helpOpen.value ? helpOpen.value.text : null,
      helpGlyph: helpOpen.value ? helpOpen.value.glyph : null,
      helpClosedAfter: helpClosedAfter.value,
      timeBefore: before.value.time,
      frameText: frameText.value,
      buttonCount: before.value.buttons,
      hasFitButton: before.value.hasFit,
      volumePop: volumePop.value,
      rateAfterSlider: rateApplied.value,
      sliderFocused: sliderFocused.value ? sliderFocused.value.focused : null,
      rateRange: sliderFocused.value ? sliderFocused.value.range : null,
      spaceToggledPlayback: afterSpace.value ? afterSpace.value.paused === false : null,
      pausedAfterStep: afterStep.value ? afterStep.value.paused : null,
    }
  }

  // narrow the pane: the header must keep the tail, not the head
  let narrowHeader = null
  if (mode === 'tab') {
    await evaluate(`(() => {
      const root = document.getElementById('root')
      if (root) root.style.width = '240px'
      const pane = document.querySelector('.pane')
      if (pane) { pane.style.width = '240px'; pane.style.flex = '0 1 240px' }
      return true
    })()`)
    await sleep(350)
    const narrow = await evaluate(`(() => { const el = document.querySelector('.qtp-headerPath'); return el ? el.textContent : null })()`)
    narrowHeader = narrow.value
  }

  // wheel over the stage → zoom chip must change
  const localPlayback = options.feedLocal
    ? await evaluate(`(() => {
        const video = document.querySelector('video')
        return video ? { src: video.getAttribute('src'), ready: video.readyState, duration: video.duration } : null
      })()`)
    : null

  let zoomAfterWheel = null
  if (snapshot.value && snapshot.value.hasRoot) {
    const box = await evaluate(`(() => { const el = document.querySelector('.qtp-stage'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
    if (box.value) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: box.value.x, y: box.value.y, deltaX: 0, deltaY: -240, pointerType: 'mouse',
      }, sessionId)
      await sleep(400)
      const after = await evaluate(`(() => { const el = document.querySelector('.qtp-canvas'); return el ? getComputedStyle(el).transform : null })()`)
      zoomAfterWheel = after.value
    }
  }

  await cdp.send('Target.closeTarget', { targetId })
  return { mode, errors, responsive, snapshot: snapshot.value ?? snapshot, preFeed: preFeed && preFeed.value, zoomAfterWheel, localPlayback: localPlayback && localPlayback.value, narrowHeader, interactions }
}

;(async () => {
  const { server, port } = await startServer()
  const base = `http://127.0.0.1:${port}`
  const { child, cdp, profile } = await launchChrome()
  const report = {}
  try {
    report.tab = await runMode(cdp, base, 'tab')
    report.body = await runMode(cdp, base, 'body')
    report.empty = await runMode(cdp, base, 'empty', { feedLocal: true })
  } finally {
    cdp.close()
    child.kill('SIGKILL')
    server.close()
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch (error) { /* ignore */ }
  }
  console.log(JSON.stringify(report, null, 2))
  const bad = []
  if (report.tab && report.tab.interactions) {
    const i = report.tab.interactions
    if (i.hasFitButton) bad.push('toolbar: the fit button is still there')
    if (i.timeBefore && !i.timeBefore.includes('/')) bad.push(`clock: unexpected initial text (${i.timeBefore})`)
    if (!i.frameText || !String(i.frameText).startsWith('#')) bad.push(`clock: clicking did not switch to frames (${i.frameText})`)
    if (!i.volumePop) bad.push('volume: no popup slider on hover')
    else {
      if (i.volumePop.writingMode !== 'vertical-lr') bad.push(`volume: slider is not vertical (${i.volumePop.writingMode})`)
      if (i.volumePop.height <= i.volumePop.width) bad.push('volume: slider is not taller than wide')
    }
    if (Math.abs((i.rateAfterSlider ?? 0) - 2.4) > 0.01) bad.push(`rate: slider did not set playbackRate (${i.rateAfterSlider})`)
    if (i.sliderFocused !== true) bad.push('keys: could not focus the rate slider for the shortcut test')
    if (!i.rateRange || i.rateRange.min !== '0.2' || i.rateRange.max !== '5' || i.rateRange.step !== '0.2') {
      bad.push(`rate: wrong slider range ${JSON.stringify(i.rateRange)}`)
    }
    if (i.spaceToggledPlayback !== true) bad.push('keys: Space did not reach the player while a slider was focused')
    if (i.pausedAfterStep !== true) bad.push('keys: frame stepping should pause playback')
  }
  if (report.tab && report.tab.narrowHeader) {
    const narrow = report.tab.narrowHeader
    if (!narrow.startsWith('\u2026')) bad.push(`narrow header is not shortened (${narrow})`)
    if (!narrow.endsWith('sample.mp4')) bad.push(`narrow header lost the file name (${narrow})`)
  }
  if (report.empty) {
    const before = report.empty.preFeed
    if (!before || !before.hasEmpty) bad.push('empty: drop zone did not render for a file-less tab')
    if (before && before.hasVideo) bad.push('empty: a video was mounted before a file arrived')
    const local = report.empty.localPlayback
    if (!local || local.ready < 1) bad.push('empty: dropped file did not start playing')
  }
  for (const key of ['tab', 'body']) {
    const entry = report[key]
    if (!entry.snapshot.hasRoot) bad.push(`${key}: player root missing`)
    if (!entry.snapshot.hasVideo) bad.push(`${key}: no <video>`)
    if (entry.responsive === 'BLOCKED') bad.push(`${key}: main thread blocked`)
    if (entry.errors.length > 0) bad.push(`${key}: ${entry.errors.length} runtime error(s)`)
    if (!entry.zoomAfterWheel || entry.zoomAfterWheel === entry.snapshot.transform) bad.push(`${key}: wheel did not change the canvas transform`)
    const headerPath = entry.snapshot.headerPath
    if (headerPath) {
      if (!headerPath.endsWith('.mp4')) bad.push(`${key}: header path does not end with the file name (${headerPath})`)
      if (headerPath.startsWith('/') === false && headerPath.startsWith('\u2026') === false) {
        bad.push(`${key}: header path is neither absolute nor shortened (${headerPath})`)
      }
    }
  }
  if (bad.length > 0) {
    console.error('\nFAIL\n' + bad.join('\n'))
    process.exitCode = 1
  } else {
    console.log('\nOK')
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
