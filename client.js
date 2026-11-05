/**
 * dsh-quicktime-player — browser half.
 *
 * Two entry points, one player:
 *  - a document preview implementation, so the native right sidebar plays
 *    videos instead of showing "this file type cannot be previewed";
 *  - an optional file viewer for dsh-better-sidebar (registered only when that
 *    service is mounted), so the Files tab plays them too.
 *
 * The player itself is a self-contained React component: streaming <video>,
 * wheel zoom around the pointer, drag to pan, custom transport bar with seek,
 * speed, loop, mute, picture-in-picture and fullscreen.
 *
 * Bundle format: the DSH lazy-CJS closure (`window.__ModuleLoader__.load`).
 * Only `react` is requested from the shell's module table.
 */
window.__ModuleLoader__.load({
  id: 'dsh-quicktime-player',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    var h = React.createElement
    var useState = React.useState
    var useRef = React.useRef
    var useEffect = React.useEffect
    var useCallback = React.useCallback
    var useMemo = React.useMemo

    /** Suffixes the player claims. */
    var VIDEO_EXTS = [
      'mp4', 'm4v', 'mov', 'qt', 'webm', 'ogv', 'ogg', 'mkv', 'avi',
      'wmv', 'flv', 'mpeg', 'mpg', 'ts', 'm2ts', 'mts', '3gp', '3g2',
    ]

    /** Document preview implementation id (metadata + body share it). */
    var IMPL_ID = 'dsh-quicktime-player/video'

    /**
     * Our own sidebar tab type. This is what makes "any video, from anywhere,
     * opens here" work without adapting to any other plugin: the right sidebar
     * ranks tab types by band, then by the length of the pattern that matched,
     * then by registration order. A video-only glob is longer than the generic
     * `dsh-resource://file/**` that other sidebar plugins claim, so we win the
     * auction at the same `extension` band — and an opener that probes the
     * registry (better-sidebar does) hands the file straight to us.
     */
    var TAB_ID = 'dsh-quicktime-player/video-tab'
    var TAB_KIND = 'quicktime-player-video'

    /** Video-only address patterns: one per suffix, each longer than `dsh-resource://file/**`. */
    var TAB_PATTERNS = VIDEO_EXTS.map(function (extension) { return 'dsh-resource://file/**/*.' + extension })

    var ZOOM_MIN = 1
    var ZOOM_MAX = 8

    function routePrefix() {
      var injected = typeof window !== 'undefined' ? window.__DSH_QUICKTIME_PLAYER__ : undefined
      return injected && typeof injected.routePrefix === 'string' ? injected.routePrefix : '/quicktime'
    }

    // ── css ────────────────────────────────────────────────────────────────
    var CSS = [
      '.qtp-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:320px;min-width:0;background:#08090a;color:#e8eaed;font-size:12px;user-select:none}',
      '.qtp-stage{position:relative;flex:1 1 auto;min-height:0;min-width:0;overflow:hidden;background:radial-gradient(circle at 50% 45%, #14161a 0%, #08090a 70%);touch-action:none;outline:none;cursor:grab}',
      '.qtp-stage[data-panning=true]{cursor:grabbing}',
      '.qtp-stage[data-zoomed=true]{background:#050506}',
      '.qtp-canvas{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transform-origin:50% 50%;will-change:transform}',
      '.qtp-video{max-width:100%;max-height:100%;display:block;background:#000;box-shadow:0 18px 60px rgba(0,0,0,.55);border-radius:2px}',
      '.qtp-video[data-fit=false]{border-radius:0;box-shadow:none}',
      '.qtp-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}',
      '.qtp-spinner{width:28px;height:28px;border-radius:50%;border:2px solid rgba(255,255,255,.18);border-top-color:rgba(255,255,255,.85);animation:qtp-spin .9s linear infinite}',
      '@keyframes qtp-spin{to{transform:rotate(360deg)}}',
      '.qtp-error{max-width:min(420px,86%);pointer-events:auto;background:rgba(24,26,30,.94);border:.5px solid rgba(255,255,255,.12);border-radius:12px;padding:16px 18px;display:flex;flex-direction:column;gap:8px;line-height:1.6}',
      '.qtp-errorTitle{font-size:13px;font-weight:600}',
      '.qtp-errorBody{color:#a6acb8;font-size:12px}',
      '.qtp-bar{position:absolute;left:0;right:0;bottom:0;padding:28px 12px 10px;display:flex;flex-direction:column;gap:8px;background:linear-gradient(to top, rgba(6,7,9,.92) 0%, rgba(6,7,9,.55) 55%, rgba(6,7,9,0) 100%);transform:translateY(8px);opacity:0;transition:opacity .18s ease, transform .18s ease;pointer-events:none}',
      '.qtp-root[data-chrome=true] .qtp-bar{opacity:1;transform:none;pointer-events:auto}',
      '.qtp-progress{position:relative;height:14px;display:flex;align-items:center;cursor:pointer;touch-action:none}',
      '.qtp-track{position:relative;height:4px;width:100%;border-radius:999px;background:rgba(255,255,255,.20);overflow:hidden;transition:height .12s ease}',
      '.qtp-progress[data-hover=true] .qtp-track{height:6px}',
      '.qtp-buffered{position:absolute;left:0;top:0;bottom:0;background:rgba(255,255,255,.26)}',
      '.qtp-played{position:absolute;left:0;top:0;bottom:0;background:#5b9dff}',
      '.qtp-thumb{position:absolute;top:0;bottom:0;width:2px;background:#fff;border-radius:2px;opacity:0}',
      '.qtp-progress[data-hover=true] .qtp-thumb{opacity:1}',
      '.qtp-tip{position:absolute;bottom:18px;transform:translateX(-50%);background:rgba(16,18,22,.94);border:.5px solid rgba(255,255,255,.12);border-radius:6px;padding:2px 6px;font-size:11px;color:#dfe3ea;pointer-events:none;font-variant-numeric:tabular-nums}',
      '.qtp-row{display:flex;align-items:center;gap:6px;min-width:0}',
      '.qtp-btn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:7px;border:0;background:transparent;color:#e8eaed;cursor:pointer;padding:0}',
      '.qtp-btn:hover{background:rgba(255,255,255,.10)}',
      '.qtp-btn[data-on=true]{color:#7fb2ff}',
      '.qtp-btn svg{width:16px;height:16px;display:block}',
      '.qtp-time{font-variant-numeric:tabular-nums;color:#c3c9d4;font-size:11px;white-space:nowrap;flex:none;background:transparent;border:0;padding:2px 6px;border-radius:6px;cursor:pointer}',
      '.qtp-time:hover{background:rgba(255,255,255,.10);color:#e8eaed}',
      '.qtp-spacer{flex:1 1 auto}',
      '.qtp-rate{font-size:11px;font-variant-numeric:tabular-nums;min-width:34px}',
      '.qtp-anchor{position:relative;display:flex;align-items:center}',
      '.qtp-pop{position:absolute;bottom:32px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 6px;background:rgba(16,18,22,.97);border:.5px solid rgba(255,255,255,.12);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.55);z-index:6}',
      '.qtp-pop::after{content:"";position:absolute;left:0;right:0;bottom:-12px;height:12px}',
      '.qtp-vslider{writing-mode:vertical-lr;direction:rtl;width:16px;height:92px;margin:0;accent-color:#5b9dff;cursor:pointer}',
      '.qtp-popValue{font-size:11px;color:#c3c9d4;font-variant-numeric:tabular-nums}',
      '.qtp-hit{position:absolute;inset:0}',
      '.qtp-pane{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;background:#08090a}',
      '.qtp-pane .qtp-root{flex:1 1 auto;min-height:0}',
      '.qtp-header{flex:none;display:flex;align-items:center;gap:8px;height:32px;padding:0 8px 0 12px;background:#0d0f12;border-bottom:.5px solid rgba(255,255,255,.07);min-width:0}',
      '.qtp-headerPath{flex:1 1 auto;min-width:0;font-size:11px;color:#9aa2af;white-space:nowrap;overflow:hidden;text-align:left;user-select:text;-webkit-user-select:text;cursor:text}',
      '.qtp-headerBtn{flex:none;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:#c7ccd6;cursor:pointer;font-size:13px;line-height:1}',
      '.qtp-headerBtn:hover{background:rgba(255,255,255,.09)}',
      '.qtp-helpBtn{position:absolute;right:10px;top:40px;width:26px;height:26px;border-radius:50%;border:.5px solid rgba(255,255,255,.16);background:rgba(16,18,22,.55);color:#c9cfd8;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:.6;transition:opacity .16s ease,background .16s ease,color .16s ease;z-index:10;padding:0}',
      '.qtp-helpBtn:hover{opacity:1;background:rgba(38,42,50,.92);color:#e8eaed}',
      '.qtp-helpBtn[data-open=true]{opacity:1;background:rgba(38,42,50,.92);color:#e8eaed}',
      '.qtp-helpLayer{position:absolute;inset:0;z-index:9;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:24px;background:rgba(7,8,10,.28);animation:qtp-help-in .14s ease-out;text-align:center}',
      '@keyframes qtp-help-in{from{opacity:0}to{opacity:1}}',
      '.qtp-helpLayerTitle{font-size:14px;color:#f4f6f9;text-shadow:0 1px 10px rgba(0,0,0,.85),0 0 2px rgba(0,0,0,.9)}',
      '.qtp-helpLayer>*{pointer-events:none}',
      '.qtp-helpLayerNote{font-size:11px;color:#c6ccd6;line-height:1.6;max-width:280px;text-shadow:0 1px 8px rgba(0,0,0,.85)}',
      '.qtp-empty{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;min-height:0}',
      '.qtp-drop{width:min(420px,100%);display:flex;flex-direction:column;align-items:center;gap:10px;padding:28px 22px;border:1px dashed rgba(255,255,255,.18);border-radius:14px;background:rgba(255,255,255,.02);transition:border-color .15s ease,background .15s ease}',
      '.qtp-drop[data-dragging=true]{border-color:#5b9dff;background:rgba(91,157,255,.08)}',
      '.qtp-dropGlyph{color:#8f96a3;display:flex}',
      '.qtp-dropTitle{font-size:13px;color:#e8eaed}',
      '.qtp-dropHint{font-size:11px;color:#8f96a3;text-align:center;line-height:1.6;max-width:320px}',
      '.qtp-dropBtn{margin-top:4px;height:28px;padding:0 14px;border-radius:8px;border:.5px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#e8eaed;font-size:12px;cursor:pointer}',
      '.qtp-dropBtn:hover{background:rgba(255,255,255,.12)}',
      '.qtp-dropNote{font-size:11px;color:#6f7683;text-align:center;max-width:360px;line-height:1.6}',
    ].join('')

    var CSS_TAG = 'dsh-quicktime-player/player.css'

    function ensureCss() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG) + ']')) return
      var tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-quicktime-player'
      tag.dataset.pluginCss = CSS_TAG
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    // ── helpers ────────────────────────────────────────────────────────────
    function formatTime(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
      var total = Math.floor(seconds)
      var hours = Math.floor(total / 3600)
      var minutes = Math.floor((total % 3600) / 60)
      var secs = total % 60
      var mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)
      return (hours > 0 ? String(hours) + ':' : '') + mm + ':' + String(secs).padStart(2, '0')
    }

    function formatRate(rate) {
      var text = Number(rate).toFixed(2).replace(/0+$/u, '').replace(/\.$/u, '')
      return text + '\u00d7'
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return ''
      var units = ['B', 'KB', 'MB', 'GB', 'TB']
      var value = bytes
      var index = 0
      while (value >= 1024 && index < units.length - 1) {
        value /= 1024
        index += 1
      }
      return (value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)) + ' ' + units[index]
    }

    /** Parse a `dsh-resource://file/session/<id>/<path>` address. */
    function parseFileAddress(address) {
      try {
        if (typeof address !== 'string' || !address.startsWith('dsh-resource://file/')) return undefined
        var end = address.search(/[?#]/u)
        var body = address.slice('dsh-resource://file/'.length, end === -1 ? undefined : end)
        var parts = body.split('/')
        var scope = parts.shift()
        if (scope === 'session') {
          var id = parts.shift()
          if (id === undefined || id === '' || parts.length === 0) return undefined
          return { sessionId: decodeURIComponent(id), path: parts.map(decodeURIComponent).join('/') }
        }
        if (scope === 'absolute') {
          var segments = parts.map(decodeURIComponent)
          if (segments.length === 0 || segments[0] === '') return undefined
          return { path: '/' + segments.join('/') }
        }
        return undefined
      } catch {
        return undefined
      }
    }

    /**
     * Shorten a path from the head while keeping its trailing segments whole.
     * Done in JS on purpose: CSS `direction: rtl` reorders the leading slash to
     * the end (bidi), which reads like a trailing slash.
     */
    function shortenPath(path, budget) {
      if (typeof path !== 'string' || path === '') return ''
      if (path.length <= budget) return path
      const keep = Math.max(8, budget - 1)
      let tail = path.slice(-keep)
      const cut = tail.search(/[\\/]/u)
      if (cut > 0 && cut < tail.length - 1) tail = tail.slice(cut)
      return '\u2026' + tail
    }

    function basenameOf(path) {
      var normalized = String(path || '').replace(/\\/gu, '/')
      return normalized.slice(normalized.lastIndexOf('/') + 1)
    }

    /** Common delivery rates; a measured value within 3% snaps to one of these. */
    var KNOWN_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120]

    /**
     * Estimate the video's frame rate from presented frames.
     * Only runs while frames are actually delivered (i.e. during playback), so
     * the default 30 stands in until the first playback.
     * @param videoRef - the mounted <video>.
     * @param active - whether a source is loaded.
     * @returns the best-known frame rate.
     */
    function useVideoFps(videoRef, active) {
      var [fps, setFps] = useState(30)
      useEffect(function () {
        var video = videoRef.current
        if (!video || !active || typeof video.requestVideoFrameCallback !== 'function') return
        var times = []
        var handle = 0
        var stopped = false
        var onFrame = function (now, meta) {
          if (stopped) return
          times.push(meta.mediaTime)
          if (times.length >= 12) {
            var deltas = []
            for (var index = 1; index < times.length; index += 1) deltas.push(times[index] - times[index - 1])
            deltas.sort(function (left, right) { return left - right })
            var median = deltas[Math.floor(deltas.length / 2)]
            if (median > 0) {
              var guess = 1 / median
              var nearest = KNOWN_FPS.reduce(function (best, value) {
                return Math.abs(value - guess) < Math.abs(best - guess) ? value : best
              }, KNOWN_FPS[0])
              setFps(Math.abs(nearest - guess) / nearest < 0.03 ? nearest : Math.round(guess * 100) / 100)
            }
            times = []
          }
          handle = video.requestVideoFrameCallback(onFrame)
        }
        handle = video.requestVideoFrameCallback(onFrame)
        return function () {
          stopped = true
          if (typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(handle)
        }
      }, [active, videoRef])
      return fps
    }

    function postDiag(payload) {
      try {
        var prefix = routePrefix()
        fetch(prefix + '/diag', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch(function () {})
      } catch {
        // ignore
      }
    }

    // ── icons (16px, currentColor) ─────────────────────────────────────────
    function svg(children, extra) {
      return h('svg', Object.assign({ viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' }, extra || {}), children)
    }
    function IconPlay() {
      return svg([h('path', { key: 'p', d: 'M5 3.5v9l7-4.5z', fill: 'currentColor' })])
    }
    function IconPause() {
      return svg([
        h('rect', { key: 'a', x: 4.5, y: 3.5, width: 2.4, height: 9, rx: 1, fill: 'currentColor' }),
        h('rect', { key: 'b', x: 9.1, y: 3.5, width: 2.4, height: 9, rx: 1, fill: 'currentColor' }),
      ])
    }
    function IconVolume(on) {
      return svg([
        h('path', { key: 'a', d: 'M3 6.2h2.2L8.4 3.6v8.8L5.2 9.8H3z', fill: 'currentColor' }),
        on
          ? h('path', { key: 'b', d: 'M10.4 5.4a3.4 3.4 0 0 1 0 5.2', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' })
          : h('path', { key: 'c', d: 'M10.6 6.1l3 3.8M13.6 6.1l-3 3.8', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
      ])
    }
    function IconLoop() {
      return svg([h('path', { key: 'a', d: 'M3 8a5 5 0 0 1 8.5-3.5M13 8a5 5 0 0 1-8.5 3.5', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }), h('path', { key: 'b', d: 'M11.6 2.4v2.4H9.2M4.4 13.6v-2.4h2.4', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' })])
    }
    function IconPip() {
      return svg([h('rect', { key: 'a', x: 1.8, y: 3, width: 12.4, height: 10, rx: 1.6, stroke: 'currentColor', strokeWidth: 1.3 }), h('rect', { key: 'b', x: 8.4, y: 7.4, width: 4.8, height: 4.2, rx: 1, fill: 'currentColor' })])
    }
    function IconExpand() {
      return svg([h('path', { key: 'a', d: 'M6 2.6H2.6V6M10 2.6h3.4V6M6 13.4H2.6V10M10 13.4h3.4V10', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' })])
    }

    // ── the player ─────────────────────────────────────────────────────────
    /**
     * @param props.sessionId - session that owns the file.
     * @param props.path - absolute file path.
     * @param props.title - display name fallback.
     * @param props.onLoaded - called once playable metadata (or the source) is known.
     * @param props.onFailed - called when the source or the decoder fails.
     */
    function Player(props) {
      var sessionId = props.sessionId
      var path = props.path

      var rootRef = useRef(null)
      var stageRef = useRef(null)
      var videoRef = useRef(null)
      var frameRef = useRef(0)

      var [source, setSource] = useState(null)
      var [sourceError, setSourceError] = useState('')
      var [duration, setDuration] = useState(0)
      var [current, setCurrent] = useState(0)
      var [buffered, setBuffered] = useState(0)
      var [playing, setPlaying] = useState(false)
      var [waiting, setWaiting] = useState(true)
      var [muted, setMuted] = useState(false)
      var [volume, setVolume] = useState(1)
      var [volumeOpen, setVolumeOpen] = useState(false)
      var [rate, setRate] = useState(1)
      var [loop, setLoop] = useState(false)
      var [chrome, setChrome] = useState(true)
      var [mediaError, setMediaError] = useState('')
      var [zoom, setZoom] = useState(1)
      var [pan, setPan] = useState({ x: 0, y: 0 })
      var [panning, setPanning] = useState(false)
      var [hover, setHover] = useState(null)
      var [timeMode, setTimeMode] = useState(0)
      var [rateOpen, setRateOpen] = useState(false)

      var fps = useVideoFps(videoRef, source !== null)
      var TIME_MODES = ['time', 'frame']
      var popupOpenRef = useRef(false)
      popupOpenRef.current = volumeOpen || rateOpen || props.pinned === true

      var onLoadedRef = useRef(props.onLoaded)
      onLoadedRef.current = props.onLoaded
      var onFailedRef = useRef(props.onFailed)
      onFailedRef.current = props.onFailed

      // 1. resolve the source: a local blob (dropped file) or a Host stream
      useEffect(function () {
        if (props.blobUrl) {
          setSource({ url: props.blobUrl, transport: 'local', size: props.blobSize || 0, name: props.blobName || '' })
          setSourceError('')
          if (props.onSource) props.onSource({ transport: 'local', name: props.blobName || '' })
          if (onLoadedRef.current) onLoadedRef.current()
          return
        }
        if (!sessionId || !path) {
          setSourceError('缺少会话或文件路径')
          if (onFailedRef.current) onFailedRef.current('missing session or path')
          return
        }
        var aborted = false
        var query = new URLSearchParams({ sessionId: sessionId, path: path })
        fetch(routePrefix() + '/source?' + query.toString(), { credentials: 'same-origin' })
          .then(function (response) {
            if (!response.ok) return response.text().then(function (text) { throw new Error(text || ('HTTP ' + response.status)) })
            return response.json()
          })
          .then(function (info) {
            if (aborted) return
            setSource(info)
            if (props.onSource) props.onSource(info)
            if (onLoadedRef.current) onLoadedRef.current()
          })
          .catch(function (error) {
            if (aborted) return
            setSourceError(String(error && error.message ? error.message : error))
            if (onFailedRef.current) onFailedRef.current(String(error && error.message ? error.message : error))
          })
        return function () { aborted = true }
      }, [sessionId, path, props.blobUrl])

      // 2. media events
      useEffect(function () {
        var video = videoRef.current
        if (!video || !source) return
        video.volume = volume
        video.muted = muted
        video.playbackRate = rate
        video.loop = loop

        var onMeta = function () {
          setDuration(video.duration || 0)
          setWaiting(false)
          postDiag({ kind: 'meta', duration: video.duration, w: video.videoWidth, h: video.videoHeight, seekable: video.seekable.length > 0 ? [video.seekable.start(0), video.seekable.end(video.seekable.length - 1)] : [], transport: source.transport })
        }
        var onTime = function () { setCurrent(video.currentTime) }
        var onDuration = function () { setDuration(video.duration || 0) }
        var onProgress = function () {
          try {
            if (video.buffered.length > 0) setBuffered(video.buffered.end(video.buffered.length - 1))
          } catch {
            // ignore
          }
        }
        var onPlay = function () { setPlaying(true) }
        var onPause = function () { setPlaying(false) }
        var onWaiting = function () { setWaiting(true) }
        var onPlaying = function () { setWaiting(false) }
        var onCanPlay = function () { setWaiting(false) }
        var onError = function () {
          var code = video.error ? video.error.code : 0
          var text = code === 4 || code === 3
            ? '浏览器无法解码这个视频（mkv / avi 常见）。建议转成 mp4（H.264）或 webm 后再试。'
            : code === 2
              ? '读取视频数据失败，请重新打开预览。'
              : '视频加载失败。'
          setMediaError(text)
          setWaiting(false)
          postDiag({ kind: 'error', code: code, message: video.error ? video.error.message : '', transport: source.transport })
          if (onFailedRef.current) onFailedRef.current('code ' + code)
        }

        video.addEventListener('loadedmetadata', onMeta)
        video.addEventListener('durationchange', onDuration)
        video.addEventListener('timeupdate', onTime)
        video.addEventListener('progress', onProgress)
        video.addEventListener('play', onPlay)
        video.addEventListener('pause', onPause)
        video.addEventListener('waiting', onWaiting)
        video.addEventListener('playing', onPlaying)
        video.addEventListener('canplay', onCanPlay)
        video.addEventListener('error', onError)
        return function () {
          video.removeEventListener('loadedmetadata', onMeta)
          video.removeEventListener('durationchange', onDuration)
          video.removeEventListener('timeupdate', onTime)
          video.removeEventListener('progress', onProgress)
          video.removeEventListener('play', onPlay)
          video.removeEventListener('pause', onPause)
          video.removeEventListener('waiting', onWaiting)
          video.removeEventListener('playing', onPlaying)
          video.removeEventListener('canplay', onCanPlay)
          video.removeEventListener('error', onError)
        }
      }, [source])

      useEffect(function () {
        var video = videoRef.current
        if (!video) return
        video.volume = volume
        video.muted = muted
      }, [volume, muted])

      useEffect(function () {
        var video = videoRef.current
        if (!video) return
        video.playbackRate = rate
      }, [rate])

      useEffect(function () {
        var video = videoRef.current
        if (!video) return
        video.loop = loop
      }, [loop])

      // 3. auto-hide chrome
      var idleTimer = useRef(0)
      var wake = useCallback(function () {
        setChrome(true)
        clearTimeout(idleTimer.current)
        idleTimer.current = setTimeout(function () {
          var video = videoRef.current
          if (video && !video.paused && !popupOpenRef.current) setChrome(false)
        }, 2400)
      }, [])
      useEffect(function () {
        wake()
        return function () { clearTimeout(idleTimer.current) }
      }, [wake])

      // 4. transport actions
      var togglePlay = useCallback(function () {
        var video = videoRef.current
        if (!video) return
        if (video.paused) {
          video.play().catch(function () {})
        } else {
          video.pause()
        }
        wake()
      }, [wake])

      var seekTo = useCallback(function (seconds) {
        var video = videoRef.current
        if (!video || !Number.isFinite(seconds)) return
        var max = Number.isFinite(video.duration) ? video.duration : seconds
        video.currentTime = Math.max(0, Math.min(seconds, max))
        setCurrent(video.currentTime)
      }, [])

      /** Step exactly one frame (paused), using the estimated delivery rate. */
      var stepFrames = useCallback(function (delta) {
        var video = videoRef.current
        if (!video) return
        video.pause()
        var step = 1 / (fps > 0 ? fps : 30)
        seekTo(video.currentTime + delta * step)
      }, [fps, seekTo])

      var nudge = useCallback(function (delta) {
        var video = videoRef.current
        if (!video) return
        seekTo(video.currentTime + delta)
      }, [seekTo])

      var toggleMute = useCallback(function () {
        setMuted(function (value) {
          var next = !value
          if (!next && volume === 0) setVolume(1)
          return next
        })
        wake()
      }, [volume, wake])

      var toggleFullscreen = useCallback(function () {
        var stage = stageRef.current
        if (!stage) return
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(function () {})
          return
        }
        stage.requestFullscreen().then(function () {
          wake()
        }).catch(function () {})
      }, [wake])

      var togglePip = useCallback(function () {
        var video = videoRef.current
        if (!video || !document.pictureInPictureEnabled) return
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture().catch(function () {})
          return
        }
        video.requestPictureInPicture().catch(function () {})
      }, [])

      // 5. zoom / pan gestures
      var applyZoom = useCallback(function (factor, clientX, clientY) {
        var stage = stageRef.current
        if (!stage) return
        setZoom(function (previous) {
          var next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, previous * factor))
          if (Math.abs(next - previous) < 1e-4) return previous
          if (next === ZOOM_MIN) {
            setPan({ x: 0, y: 0 })
            return next
          }
          var rect = stage.getBoundingClientRect()
          var centerX = rect.left + rect.width / 2
          var centerY = rect.top + rect.height / 2
          var cursorX = clientX === undefined ? centerX : clientX
          var cursorY = clientY === undefined ? centerY : clientY
          setPan(function (previousPan) {
            var ratio = next / previous
            var anchorX = cursorX - centerX
            var anchorY = cursorY - centerY
            return {
              x: anchorX + ratio * (previousPan.x - anchorX),
              y: anchorY + ratio * (previousPan.y - anchorY),
            }
          })
          return next
        })
        wake()
      }, [wake])

      useEffect(function () {
        var stage = stageRef.current
        if (!stage) return
        var onWheel = function (event) {
          event.preventDefault()
          var factor = Math.exp(-event.deltaY * 0.0018)
          applyZoom(factor, event.clientX, event.clientY)
        }
        stage.addEventListener('wheel', onWheel, { passive: false })
        return function () { stage.removeEventListener('wheel', onWheel) }
      }, [applyZoom])

      var dragRef = useRef(null)
      /** Pointer events inside the transport bar / zoom HUD must not reach the stage gesture layer. */
      var fromChrome = function (event) {
        var target = event.target
        return !!(target && typeof target.closest === 'function' && target.closest('.qtp-bar, .qtp-error, .qtp-helpLayer, .qtp-helpBtn'))
      }
      var onPointerDown = useCallback(function (event) {
        if (event.button !== 0 || fromChrome(event)) return
        var stage = stageRef.current
        if (!stage) return
        stage.focus()
        dragRef.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          panX: pan.x,
          panY: pan.y,
          moved: false,
          zoomed: zoom > 1,
        }
        stage.setPointerCapture(event.pointerId)
        wake()
      }, [pan.x, pan.y, zoom, wake])

      var onPointerMove = useCallback(function (event) {
        var drag = dragRef.current
        if (!drag || drag.id !== event.pointerId) return
        var dx = event.clientX - drag.x
        var dy = event.clientY - drag.y
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) {
          drag.moved = true
          if (drag.zoomed) setPanning(true)
        }
        if (drag.moved && drag.zoomed) {
          setPan({ x: drag.panX + dx, y: drag.panY + dy })
        }
      }, [])

      var onPointerUp = useCallback(function (event) {
        var drag = dragRef.current
        dragRef.current = null
        setPanning(false)
        if (!drag || drag.id !== event.pointerId) return
        if (!drag.moved && !drag.zoomed) togglePlay()
      }, [togglePlay])

      // 6. keyboard: owned by the whole pane, so a focused control (rate or
      // volume slider, a toolbar button) can never swallow Space or the arrows
      useEffect(function () {
        var root = rootRef.current
        if (!root) return
        var onKey = function (event) {
          var target = event.target
          if (target && target.tagName === 'INPUT' && (target.type === 'text' || target.type === 'file')) return
          var fullscreen = document.fullscreenElement === root || document.fullscreenElement === stageRef.current
          var active = document.activeElement
          // Siblings of the player (the help button sits on the pane, not in the
          // player) must not swallow Space either: accept anything inside the pane.
          var pane = typeof root.closest === 'function' ? root.closest('.qtp-pane') : null
          var scope = pane || root
          if (!fullscreen && (!active || !scope.contains(active))) return
          var handled = true
          switch (event.key) {
            case ' ':
            case 'k':
            case 'K':
              togglePlay()
              break
            case 'ArrowLeft':
              if (event.shiftKey) nudge(-1)
              else stepFrames(-1)
              break
            case 'ArrowRight':
              if (event.shiftKey) nudge(1)
              else stepFrames(1)
              break
            case 'ArrowUp':
              setVolume(function (value) { return Math.min(1, value + 0.05) })
              setMuted(false)
              break
            case 'ArrowDown':
              setVolume(function (value) { return Math.max(0, value - 0.05) })
              break
            case 'm':
            case 'M':
              toggleMute()
              break
            case 'f':
            case 'F':
            case 'Enter':
              toggleFullscreen()
              break
            case '0':
              setZoom(1)
              setPan({ x: 0, y: 0 })
              break
            case '+':
            case '=':
              applyZoom(1.25)
              break
            case '-':
            case '_':
              applyZoom(1 / 1.25)
              break
            default:
              handled = false
          }
          if (handled) {
            event.preventDefault()
            event.stopPropagation()
            wake()
          }
        }
        // The pane, not the player, is the keyboard surface: the help button is a
        // sibling of the player, and keys pressed on it belong to playback too.
        var surface = typeof root.closest === 'function' ? (root.closest('.qtp-pane') || root) : root
        surface.addEventListener('keydown', onKey, true)
        return function () { surface.removeEventListener('keydown', onKey, true) }
      }, [applyZoom, nudge, stepFrames, toggleFullscreen, toggleMute, togglePlay, wake])

      // 7. progress bar scrubbing
      var progressRef = useRef(null)
      var scrubbing = useRef(false)
      var ratioAt = function (clientX) {
        var bar = progressRef.current
        if (!bar) return 0
        var rect = bar.getBoundingClientRect()
        if (rect.width === 0) return 0
        return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      }
      var onProgressDown = function (event) {
        if (duration <= 0) return
        scrubbing.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
        seekTo(ratioAt(event.clientX) * duration)
        wake()
      }
      var onProgressMove = function (event) {
        var ratio = ratioAt(event.clientX)
        if (duration > 0) setHover({ ratio: ratio, time: ratio * duration, x: event.clientX - (progressRef.current ? progressRef.current.getBoundingClientRect().left : 0) })
        if (scrubbing.current && duration > 0) seekTo(ratio * duration)
      }
      var onProgressUp = function (event) {
        scrubbing.current = false
        if (event.currentTarget.hasPointerCapture && event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }

      var clockText = function () {
        if (TIME_MODES[timeMode] === 'frame') {
          var total = duration > 0 ? Math.round(duration * fps) : 0
          return '#' + Math.round(current * fps) + (total > 0 ? ' / #' + total : '')
        }
        return formatTime(current) + ' / ' + formatTime(duration)
      }

      var displayPath = source && source.absolutePath
        ? source.absolutePath
        : (source && source.transport === 'local' ? (source.name || '本地文件') : path)
      var progress = duration > 0 ? Math.min(1, current / duration) : 0
      var bufferedRatio = duration > 0 ? Math.min(1, buffered / duration) : 0
      var zoomed = zoom > 1.0001
      var canvasStyle = {
        transform: 'translate(' + pan.x + 'px,' + pan.y + 'px) scale(' + zoom + ')',
      }

      return h('div', {
        ref: rootRef,
        className: 'qtp-root',
        tabIndex: -1,
        'data-chrome': (chrome || props.pinned) ? 'true' : 'false',
        onPointerMove: wake,
        onPointerEnter: wake,
        onPointerUp: function () {
          var active = document.activeElement
          var root = rootRef.current
          if (!root || !active || active === root || !root.contains(active)) return
          if (active.tagName === 'BUTTON' || active.tagName === 'INPUT') root.focus({ preventScroll: true })
        },
      }, [
        h('div', {
          key: 'stage',
          ref: stageRef,
          className: 'qtp-stage',
          tabIndex: 0,
          'data-panning': panning ? 'true' : 'false',
          'data-zoomed': zoomed ? 'true' : 'false',
          onPointerDown: onPointerDown,
          onPointerMove: onPointerMove,
          onPointerUp: onPointerUp,
          onPointerCancel: onPointerUp,
          onDoubleClick: function (event) {
            if (fromChrome(event)) return
            toggleFullscreen()
          },
          onPointerLeave: function () { setHover(null) },
        }, [
          h('div', { key: 'canvas', className: 'qtp-canvas', style: canvasStyle },
            source
              ? h('video', {
                ref: videoRef,
                className: 'qtp-video',
                'data-fit': zoomed ? 'false' : 'true',
                src: source.url,
                preload: 'metadata',
                playsInline: true,
                controls: false,
                onClick: function (event) { event.stopPropagation() },
              })
              : null),

          waiting && !mediaError && !sourceError
            ? h('div', { key: 'spin', className: 'qtp-overlay' }, h('div', { className: 'qtp-spinner' }))
            : null,

          (sourceError || mediaError)
            ? h('div', { key: 'error', className: 'qtp-overlay' },
              h('div', { className: 'qtp-error' }, [
                h('div', { key: 't', className: 'qtp-errorTitle' }, '无法播放'),
                h('div', { key: 'm', className: 'qtp-errorBody' }, mediaError || sourceError),
                h('div', { key: 'p', className: 'qtp-errorBody', style: { wordBreak: 'break-all', opacity: 0.65 } }, displayPath || ''),
              ]))
            : null,

          h('div', { key: 'bar', className: 'qtp-bar' }, [
            h('div', {
              key: 'progress',
              ref: progressRef,
              className: 'qtp-progress',
              'data-hover': hover ? 'true' : 'false',
              onPointerDown: onProgressDown,
              onPointerMove: onProgressMove,
              onPointerUp: onProgressUp,
              onPointerCancel: onProgressUp,
              onPointerLeave: function () { setHover(null) },
            }, [
              h('div', { key: 'track', className: 'qtp-track' }, [
                h('div', { key: 'b', className: 'qtp-buffered', style: { width: (bufferedRatio * 100) + '%' } }),
                h('div', { key: 'p', className: 'qtp-played', style: { width: (progress * 100) + '%' } }),
                h('div', { key: 't', className: 'qtp-thumb', style: { left: (progress * 100) + '%' } }),
              ]),
              hover ? h('div', { key: 'tip', className: 'qtp-tip', style: { left: hover.x + 'px' } }, formatTime(hover.time)) : null,
            ]),

            h('div', { key: 'row', className: 'qtp-row' }, [
              h('button', { key: 'play', className: 'qtp-btn', onClick: togglePlay, title: '播放 / 暂停 (空格)' }, playing ? h(IconPause) : h(IconPlay)),
              h('button', {
                key: 'time',
                className: 'qtp-time',
                onClick: function () { setTimeMode((timeMode + 1) % TIME_MODES.length) },
                title: '点击切换：时间 / 帧号',
              }, clockText()),
              h('div', { key: 'spacer', className: 'qtp-spacer' }),

              h('div', {
                key: 'rate',
                className: 'qtp-anchor',
                onPointerEnter: function () { setRateOpen(true) },
                onPointerLeave: function () { setRateOpen(false) },
              }, [
                h('button', { key: 'b', className: 'qtp-btn qtp-rate', title: '播放速度' }, formatRate(rate)),
                rateOpen ? h('div', { key: 'p', className: 'qtp-pop' }, [
                  h('input', {
                    key: 's',
                    className: 'qtp-vslider',
                    type: 'range', min: 0.2, max: 5, step: 0.2,
                    value: rate,
                    onChange: function (event) { setRate(Number(event.target.value)) },
                    'aria-label': '播放速度',
                  }),
                  h('span', { key: 'v', className: 'qtp-popValue' }, formatRate(rate)),
                ]) : null,
              ]),

              h('button', { key: 'loop', className: 'qtp-btn', 'data-on': loop ? 'true' : 'false', onClick: function () { setLoop(!loop) }, title: '循环播放' }, h(IconLoop)),

              h('div', {
                key: 'vol',
                className: 'qtp-anchor',
                onPointerEnter: function () { setVolumeOpen(true) },
                onPointerLeave: function () { setVolumeOpen(false) },
              }, [
                h('button', { key: 'mute', className: 'qtp-btn', onClick: toggleMute, title: '静音 (M)' }, IconVolume(!muted && volume > 0)),
                volumeOpen ? h('div', { key: 'p', className: 'qtp-pop' }, [
                  h('input', {
                    key: 's',
                    className: 'qtp-vslider',
                    type: 'range', min: 0, max: 1, step: 0.02,
                    value: muted ? 0 : volume,
                    onChange: function (event) {
                      var next = Number(event.target.value)
                      setVolume(next)
                      setMuted(next === 0)
                    },
                    'aria-label': '音量',
                  }),
                  h('span', { key: 'v', className: 'qtp-popValue' }, Math.round((muted ? 0 : volume) * 100) + '%'),
                ]) : null,
              ]),

              h('button', { key: 'pip', className: 'qtp-btn', onClick: togglePip, title: '画中画' }, h(IconPip)),
              h('button', { key: 'fs', className: 'qtp-btn', onClick: toggleFullscreen, title: '全屏 (F)' }, h(IconExpand)),
            ]),
          ]),
        ]),
      ])
    }

    // ── native document preview body ───────────────────────────────────────
    /** Body registered into `sidebar.right.tab.document` for {@link IMPL_ID}. */
    function DocumentBody(props) {
      var request = props.content && props.content.kind === 'renderer' ? props.content : undefined
      var address = parseFileAddress(props.resourceAddress)
      var sessionId = (address && address.sessionId) || props.sessionId
      var path = address && address.path

      useEffect(function () {
        postDiag({
          kind: 'body-mount',
          address: props.resourceAddress || null,
          content: props.content ? props.content.kind : null,
          sessionId: sessionId || null,
          path: path || null,
          keys: Object.keys(props).filter(function (key) { return key.length < 24 }).slice(0, 40).join(','),
        })
      }, [])

      var settledRef = useRef(false)
      useEffect(function () {
        settledRef.current = false
      }, [request && request.revision])

      var onLoaded = useCallback(function () {
        if (request && !settledRef.current) {
          settledRef.current = true
          request.loaded(undefined)
        }
      }, [request])

      var onFailed = useCallback(function (message) {
        if (request && !settledRef.current) {
          settledRef.current = true
          request.failed()
        }
        if (message) postDiag({ kind: 'failed', message: String(message), path: path || '' })
      }, [request, path])

      if (request === undefined) {
        return h('div', { className: 'qtp-root' }, h('div', { className: 'qtp-stage' }, h('div', { className: 'qtp-overlay' }, h('div', { className: 'qtp-spinner' }))))
      }

      return h(Player, {
        sessionId: sessionId,
        path: path,
        title: path ? basenameOf(path) : undefined,
        onLoaded: onLoaded,
        onFailed: onFailed,
      })
    }

    /**
     * Mark for the guide card. The Host serves `icon.svg` at `<prefix>/icon`
     * (generated by scripts/make-icon.mjs); this flat fallback only paints when
     * that request fails.
     */
    function QuickTimeGlyph(props) {
      var size = (props && props.size) || 16
      var [failed, setFailed] = useState(false)
      if (!failed) {
        return h('img', {
          src: routePrefix() + '/icon',
          width: size,
          height: size,
          alt: 'QuickTime Player',
          className: props && props.className,
          draggable: false,
          onError: function () { setFailed(true) },
          style: { borderRadius: Math.round(size * 0.225) + 'px', display: 'block' },
        })
      }
      var rotate = function (degrees, cx, cy) {
        return 'rotate(' + degrees + ' ' + cx + ' ' + cy + ')'
      }
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 32 32',
        xmlns: 'http://www.w3.org/2000/svg',
        className: props && props.className,
        'aria-label': 'QuickTime Player',
      }, [
        h('rect', { key: 'bg', x: 1, y: 1, width: 30, height: 30, rx: 7, fill: '#1b1c1f' }),
        h('path', { key: 'tail', d: 'M25.1 22.2 L26.2 26.3 L22.2 25.1 Z', fill: '#d9dde3', stroke: '#d9dde3', strokeWidth: 0.8, strokeLinejoin: 'round' }),
        h('circle', { key: 'ring', cx: 16, cy: 16, r: 10.4, fill: 'none', stroke: '#d9dde3', strokeWidth: 3 }),
        h('circle', { key: 'disc', cx: 16, cy: 16, r: 7.6, fill: '#6a2bf0' }),
        h('rect', { key: 'band', x: 14.5, y: 8.4, width: 3, height: 15.2, rx: 1.5, transform: rotate(-44, 16, 16), fill: '#efe9ff' }),
      ])
    }

    // ── our own tab body ──────────────────────────────────────────────────
    /** Slim header above the player: full path, reload. */
    function PaneHeader(props) {
      var pathRef = useRef(null)
      var [budget, setBudget] = useState(120)
      useEffect(function () {
        var el = pathRef.current
        if (!el || typeof ResizeObserver === 'undefined') return
        var measure = function () {
          var width = el.getBoundingClientRect().width
          if (width > 0) setBudget(Math.max(16, Math.floor(width / 6.1)))
        }
        measure()
        var observer = new ResizeObserver(measure)
        observer.observe(el)
        return function () { observer.disconnect() }
      }, [])
      return h('div', { className: 'qtp-header' }, [
        h('span', { key: 'p', ref: pathRef, className: 'qtp-headerPath', title: props.path || '' }, shortenPath(props.path || '', budget)),
        h('button', {
          key: 'r',
          className: 'qtp-headerBtn',
          onClick: function (event) {
            props.onReload()
            event.currentTarget.blur()
          },
          title: '重新加载',
        }, '\u21bb'),
      ])
    }

    /** Drop / pick a local video when the tab carries no file address (the guide entry). */
    function EmptyPane(props) {
      var inputRef = useRef(null)
      var [dragging, setDragging] = useState(false)
      var pick = function (files) {
        if (!files || files.length === 0) return
        var file = files[0]
        if (!file.type.startsWith('video/') && !/\.(mp4|m4v|mov|qt|webm|ogv|ogg|mkv|avi|wmv|flv|mpeg|mpg|ts|m2ts|mts|3gp|3g2)$/iu.test(file.name)) return
        props.onPick(file)
      }
      return h('div', { className: 'qtp-empty' }, [
        h('div', {
          key: 'zone',
          className: 'qtp-drop',
          'data-dragging': dragging ? 'true' : 'false',
          onDragOver: function (event) { event.preventDefault(); setDragging(true) },
          onDragLeave: function () { setDragging(false) },
          onDrop: function (event) {
            event.preventDefault()
            setDragging(false)
            pick(event.dataTransfer && event.dataTransfer.files)
          },
        }, [
          h('div', { key: 'g', className: 'qtp-dropGlyph' }, h(QuickTimeGlyph, { size: 40 })),
          h('div', { key: 't', className: 'qtp-dropTitle' }, '把视频拖进来'),
          h('div', { key: 'd', className: 'qtp-dropHint' }, '也可以从左侧文件树点一个视频，或直接粘贴文件的完整路径给对话'),
          h('button', {
            key: 'b',
            className: 'qtp-dropBtn',
            onClick: function () { if (inputRef.current) inputRef.current.click() },
          }, '选择本地文件'),
          h('input', {
            key: 'i',
            ref: inputRef,
            type: 'file',
            accept: 'video/*',
            style: { display: 'none' },
            onChange: function (event) {
              pick(event.target.files)
              event.target.value = ''
            },
          }),
        ]),
        h('div', { key: 'note', className: 'qtp-dropNote' }, '浏览器不给本地文件的真实路径，所以拖进来的文件能播但不能记忆进度；从文件树打开的可以。'),
      ])
    }

    /** Body of the {@link TAB_KIND} pane tab. */
    function VideoPane(props) {
      var info
      try {
        info = props.useTabInfo ? props.useTabInfo() : undefined
      } catch (error) {
        info = undefined
      }
      var tab = info && info.tab
      var address = (tab && tab.contentId) || props.resourceAddress || ''
      var file = parseFileAddress(address)
      var sessionId = (file && file.sessionId) || props.sessionId
      var path = file && file.path
      var [nonce, setNonce] = useState(0)
      var [local, setLocal] = useState(null)
      var [helpOpen, setHelpOpen] = useState(false)
      var [resolved, setResolved] = useState('')

      useEffect(function () {
        postDiag({ kind: 'tab-mount', address: address, sessionId: sessionId || null, path: path || null })
      }, [])

      var hasFile = path !== undefined && path !== ''
      var headerPath = hasFile ? (resolved || path) : (local ? local.name : '')

      var body
      if (local) {
        body = h(Player, {
          key: 'local' + local.url,
          blobUrl: local.url,
          blobName: local.name,
          blobSize: local.size,
          title: local.name,
        })
      } else if (hasFile) {
        body = h(Player, {
          key: 'v' + nonce,
          sessionId: sessionId,
          path: path,
          title: basenameOf(path),
          onSource: function (info) {
            if (info && typeof info.absolutePath === 'string' && info.absolutePath !== '') setResolved(info.absolutePath)
          },
        })
      } else {
        body = h(EmptyPane, {
          key: 'empty',
          onPick: function (file) {
            if (local) URL.revokeObjectURL(local.url)
            setLocal({ url: URL.createObjectURL(file), name: file.name, size: file.size })
          },
        })
      }

      return h('div', { className: 'qtp-pane' }, [
        helpOpen ? h('div', { key: 'help', className: 'qtp-helpLayer' }, [
          h('div', { key: 't', className: 'qtp-helpLayerTitle' }, '\u4f7f\u7528\u8bf4\u660e'),
          h('div', { key: 'n', className: 'qtp-helpLayerNote' }, '\u5185\u5bb9\u5f85\u5b9a'),
        ]) : null,
        h('button', {
          key: 'helpBtn',
          className: 'qtp-helpBtn',
          'data-open': helpOpen ? 'true' : 'false',
          title: helpOpen ? '\u5173\u95ed\u4f7f\u7528\u8bf4\u660e' : '\u4f7f\u7528\u8bf4\u660e',
          onClick: function (event) {
            event.stopPropagation()
            setHelpOpen(!helpOpen)
          },
        }, helpOpen ? '\u00d7' : '?'),
        h(PaneHeader, {
          key: 'h',
          path: headerPath,
          onReload: function () {
            if (local) {
              URL.revokeObjectURL(local.url)
              setLocal(null)
              return
            }
            setNonce(nonce + 1)
          },
        }),
        body,
      ])
    }

    // ── plugin body ────────────────────────────────────────────────────────
    function apply(ctx) {
      ensureCss()
      postDiag({ kind: 'client-boot', version: '0.1.0', release: (window.__DSH_BOOT__ && window.__DSH_BOOT__.release) || null })
      var mark = function (name, error) {
        postDiag({ kind: 'step', step: name, error: error ? String((error && error.message) || error) : null })
      }

      try {
        ctx.effect(function () {
          return ctx.documentPreviews.register({
            id: IMPL_ID,
            extensions: VIDEO_EXTS,
            binaryExtensions: VIDEO_EXTS,
            priority: 'extension',
            title: function () { return '视频' },
            loading: 'renderer',
            wrap: false,
          })
        }, 'quicktime-player: document preview metadata')
        mark('metadata-ok')
      } catch (error) {
        mark('metadata-failed', error)
      }

      try {
        ctx.effect(function () {
          return ctx.slots.inject('sidebar.right.tab.document', function () {
            postDiag({ kind: 'body-factory-enter' })
            var dispose = ctx.slots.register({
              name: 'sidebar.right.tab.document',
              key: IMPL_ID,
            }, DocumentBody)
            postDiag({ kind: 'body-register-ok' })
            return dispose
          })
        }, 'quicktime-player: document preview body')
        mark('body-ok')
      } catch (error) {
        mark('body-failed', error)
      }

      // Our own sidebar tab type: wins the address auction for video files, so
      // every opener (native Files tab, chat references, better-sidebar's tree,
      // the sidebar_open tool) lands here without any per-plugin adaptation.
      if (typeof ctx.inject === 'function') {
        try {
          ctx.inject(['sidebarRightTabs', 'slots'], function (sub) {
            sub.effect(function () {
              return sub.sidebarRightTabs.register({
                id: TAB_ID,
                kind: TAB_KIND,
                priority: 'extension',
                patterns: TAB_PATTERNS,
                canOpen: function (address) {
                  var file = parseFileAddress(address)
                  return file !== undefined && typeof file.path === 'string' && file.path !== ''
                },
                title: function (address) {
                  var file = parseFileAddress(address)
                  return file !== undefined ? basenameOf(file.path) : '\u89c6\u9891'
                },
                guide: [{
                  id: 'quicktime-player',
                  order: 60,
                  title: function () { return 'QuickTime Player' },
                  description: function () { return '\u64ad\u653e\u89c6\u9891\u6587\u4ef6' },
                  icon: QuickTimeGlyph,
                }],
              })
            }, 'quicktime-player: video tab type')
            mark('tab-type-ok')

            sub.effect(function () {
              return sub.slots.inject('sidebar.right.pane.tab', function () {
                return sub.slots.register({
                  name: 'sidebar.right.pane.tab',
                  key: TAB_ID,
                }, VideoPane)
              })
            }, 'quicktime-player: video tab body')
            mark('tab-body-ok')
          })
          mark('tab-pending')
        } catch (error) {
          mark('tab-failed', error)
        }
      } else {
        mark('no-inject-api')
      }

      // Dev probe: which sidebar tab kinds are registered right now? A pane tab
      // whose kind is missing renders nothing (e.g. a tab left behind by an
      // uninstalled sidebar plugin).
      try {
        var tabs = typeof ctx.get === 'function' ? ctx.get('sidebarRightTabs') : ctx.sidebarRightTabs
        var kinds = tabs && tabs.kinds ? Array.from(tabs.kinds.keys()) : null
        postDiag({ kind: 'tab-kinds', kinds: kinds, ids: tabs && tabs.ids ? Array.from(tabs.ids) : null })
      } catch (error) {
        postDiag({ kind: 'tab-kinds-error', error: String(error) })
      }
    }

    exports.apply = apply
    exports.inject = ['slots', 'documentPreviews']
    return module.exports
  },
})
