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
     * The whole guide lives here: rows of `label / how to use it`, grouped by
     * what the reader is trying to do. Adding a feature means adding a row.
     */
    var HELP_GROUPS = [
      {
        title: '\u64ad\u653e',
        rows: [
          { label: '\u64ad\u653e / \u6682\u505c', keys: ['Space'], text: '\u6216\u70b9\u753b\u9762' },
          { label: '\u9010\u5e27', keys: ['\u2190', '\u2192'], text: '\u7cbe\u786e\u4e00\u5e27' },
          { label: '\u5feb\u9000 / \u5feb\u8fdb 1 \u79d2', keys: ['Shift', '\u2190\u2192'] },
          { label: '\u62d6\u52a8\u8fdb\u5ea6', text: '\u70b9\u6216\u62d6\u8fdb\u5ea6\u6761' },
        ],
      },
      {
        title: '\u89c6\u56fe',
        rows: [
          { label: '\u7f29\u653e', text: '\u6eda\u8f6e\uff081\u00d7\u20138\u00d7\uff09' },
          { label: '\u5e73\u79fb', text: '\u653e\u5927\u540e\u62d6\u62fd' },
          { label: '\u5168\u5c4f', icon: 'expand', keys: ['F'], text: '\u6216\u53cc\u51fb\u753b\u9762' },
          { label: '\u500d\u901f', icon: 'rate', text: '\u5f39\u7ad6\u6761\uff080.2\u00d7\u20135\u00d7\uff09' },
          { label: '\u97f3\u91cf', icon: 'volume', text: '\u60ac\u505c\u5f39\u51fa\u7ad6\u6761' },
        ],
      },
      {
        title: '\u5de5\u5177',
        rows: [
          { label: '\u526a\u8f91\u5207\u7247', icon: 'scissors', text: '\u70b9\u4e24\u4e0b\u6807\u8bb0\uff0c\u60ac\u505c\u53ef\u4fdd\u5b58' },
          { label: '\u590d\u5236\u5f53\u524d\u5e27', icon: 'camera', text: 'PNG \u8fdb\u526a\u8d34\u677f' },
          { label: '\u68c0\u67e5\u66f4\u65b0', icon: 'cloud', text: '\u70b9\u4e00\u4e0b\uff0c\u5f39\u7a97\u544a\u8bc9\u4f60\u6709\u6ca1\u6709\u65b0\u7248' },
          { label: '\u6253\u5f00\u6587\u4ef6', icon: 'external', text: '\u7528\u9ed8\u8ba4\u5e94\u7528\u64ad\u653e', needsOpener: true },
          { label: '\u663e\u793a\u4f4d\u7f6e', icon: 'folder', text: '\u5728\u6587\u4ef6\u7ba1\u7406\u5668\u4e2d\u5b9a\u4f4d', needsOpener: true },
        ],
      },
    ]

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

    /** Export glyph: an arrow leaving a tray. */
    function IconOpenExternal() {
      return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', xmlns: 'http://www.w3.org/2000/svg' }, [
        h('path', { key: 'a', d: 'M9.2 3.2h3.6v3.6', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { key: 'b', d: 'M12.6 3.4 L7.4 8.6', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
        h('path', { key: 'c', d: 'M11.2 9.8v2.2a.9.9 0 0 1-.9.9H4.1a.9.9 0 0 1-.9-.9V5.9a.9.9 0 0 1 .9-.9h2.3', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      ])
    }

    /** Reveal glyph: a folder. */
    function IconReveal() {
      return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', xmlns: 'http://www.w3.org/2000/svg' }, [
        h('path', { key: 'a', d: 'M2.6 5.2a1 1 0 0 1 1-1h2.5l1.2 1.4h4.1a1 1 0 0 1 1 1v4.6a1 1 0 0 1-1 1H3.6a1 1 0 0 1-1-1z', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }),
      ])
    }

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
      '.qtp-clip{position:relative;display:flex;align-items:center}',
      '.qtp-clipExtra{position:absolute;right:100%;top:0;display:flex;align-items:center;gap:2px;padding-right:2px;opacity:0;transform:translateX(8px);pointer-events:none;transition:opacity .16s ease,transform .16s ease}',
      '.qtp-clip[data-open=true] .qtp-clipExtra{opacity:1;transform:none;pointer-events:auto}',
      '.qtp-mark{position:absolute;top:-18px;bottom:0;width:0;pointer-events:none;z-index:3}',
      '.qtp-markLine{position:absolute;left:-0.75px;top:18px;bottom:0;width:1.5px;border-radius:1px;background:rgba(238,241,245,.75)}',
      '.qtp-markBadge{position:absolute;left:-9px;top:0;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(18,20,24,.92);border:.5px solid rgba(238,241,245,.36);color:#e6eaf0}',
      '.qtp-markBadge svg{width:11px;height:11px}',
      '.qtp-markRange{position:absolute;top:-9px;height:0;border-top:1.5px dashed rgba(238,241,245,.5);transform:translateY(-50%);pointer-events:none;z-index:2}',
      '.qtp-tip{position:absolute;bottom:18px;transform:translateX(-50%);background:rgba(16,18,22,.94);border:.5px solid rgba(255,255,255,.12);border-radius:6px;padding:2px 6px;font-size:11px;color:#dfe3ea;pointer-events:none;font-variant-numeric:tabular-nums}',
      '.qtp-row{display:flex;align-items:center;gap:6px;min-width:0}',
      '.qtp-btn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;border:0;background:transparent;color:#e8eaed;cursor:pointer;padding:0}',
      '.qtp-btn:hover{background:rgba(255,255,255,.10)}',
      '.qtp-btn[data-on=true]{color:#7fb2ff}',
      '.qtp-btn svg{width:18px;height:18px;display:block}',
      '.qtp-time{font-variant-numeric:tabular-nums;color:#c3c9d4;font-size:12px;white-space:nowrap;flex:none;background:transparent;border:0;height:32px;padding:0 9px;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center}',
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
      '.qtp-header{flex:none;display:flex;align-items:center;gap:8px;height:34px;padding:0 8px 0 12px;background:#0d0f12;border-bottom:.5px solid rgba(255,255,255,.07);min-width:0}',
      '.qtp-headerPath{flex:1 1 auto;min-width:0;font-size:11px;color:#9aa2af;white-space:nowrap;overflow:hidden;text-align:left;user-select:text;-webkit-user-select:text;cursor:text}',
      '.qtp-headerBtn{flex:none;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:#c7ccd6;cursor:pointer;font-size:13px;line-height:1}',
      '.qtp-headerBtn:hover{background:rgba(255,255,255,.09)}',
            '.qtp-helpBtn{position:absolute;right:12px;top:42px;width:30px;height:30px;border-radius:50%;border:.5px solid rgba(255,255,255,.18);background:rgba(16,18,22,.55);color:#cfd6df;font-size:15px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:.75;transition:opacity .16s ease,background .16s ease,color .16s ease,box-shadow .2s ease;z-index:10;padding:0}',
      '.qtp-helpBtn:hover{opacity:1;background:rgba(38,42,50,.92);color:#e8eaed}',
      '.qtp-helpBtn[data-open=true]{opacity:1;background:rgba(38,42,50,.92);color:#e8eaed}',
      // the copy button sits to its left and never carries the guide halo
      '.qtp-helpBtn.qtp-copyBtn{right:50px}',
      '.qtp-helpBtn.qtp-checkBtn{right:88px}',
      '.qtp-checkBtn[data-busy=true] svg{animation:qtp-spin .8s linear infinite}',
      '@keyframes qtp-spin{to{transform:rotate(360deg)}}',
      '@media (prefers-reduced-motion: reduce){.qtp-checkBtn[data-busy=true] svg{animation:none}}',
      '.qtp-dialogBackdrop{position:absolute;inset:0;z-index:12;display:flex;align-items:center;justify-content:center;background:rgba(6,7,9,.42);animation:qtp-help-in .12s ease-out}',
      '.qtp-dialog{min-width:220px;max-width:calc(100% - 32px);padding:16px 18px 14px;border-radius:12px;background:rgba(16,18,22,.98);border:.5px solid rgba(255,255,255,.16);box-shadow:0 24px 60px rgba(0,0,0,.6);text-align:center}',
      '.qtp-dialogTitle{font-size:12px;color:#9aa2ae;padding-bottom:8px}',
      '.qtp-dialogBody{padding-bottom:12px}',
      '.qtp-dialogLine{font-size:13.5px;color:#f2f5f9}',
      '.qtp-dialogSub{font-size:12px;color:#9aa2ae;padding-top:3px}',
      '.qtp-dialogBtn{height:28px;padding:0 14px;border-radius:8px;border:.5px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#e8ebf0;font-size:12px;cursor:pointer}',
      '.qtp-copyBtn svg{display:block}',
      // idle cyan halo: only on the guide button, present without hover
      '.qtp-helpBtn:not(.qtp-copyBtn):not(.qtp-checkBtn){border-color:rgba(34,211,238,.5);box-shadow:0 0 0 1px rgba(34,211,238,.22),0 0 11px rgba(34,211,238,.42)}',
      '.qtp-helpBtn:not(.qtp-copyBtn):not(.qtp-checkBtn):hover{box-shadow:0 0 0 1px rgba(34,211,238,.6),0 0 20px rgba(34,211,238,.75)}',
      '.qtp-toast{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:11;padding:9px 15px;border-radius:10px;background:rgba(12,14,18,.92);border:.5px solid rgba(255,255,255,.16);box-shadow:0 12px 34px rgba(0,0,0,.55);color:#eef1f5;font-size:12.5px;white-space:nowrap;pointer-events:none;animation:qtp-toast-in .16s ease-out}',
      '@keyframes qtp-toast-in{from{opacity:0;transform:translate(-50%,-46%) scale(.96)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}',
      '.qtp-helpLayer{position:absolute;inset:0;z-index:9;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:24px;background:rgba(7,8,10,.28);animation:qtp-help-in .14s ease-out;text-align:center}',
      '@keyframes qtp-help-in{from{opacity:0}to{opacity:1}}',
      '.qtp-guide{position:absolute;left:12px;top:44px;pointer-events:auto;width:min(340px,calc(100% - 24px));max-height:calc(100% - 136px);overflow:auto;box-sizing:border-box;padding:11px 13px;border-radius:12px;background:rgba(12,14,18,.9);border:.5px solid rgba(255,255,255,.14);box-shadow:0 18px 44px rgba(0,0,0,.55);color:#e8ebf0;font-size:11.5px;line-height:1.26;text-align:left}',
      '.qtp-guideHead{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding-bottom:4px;border-bottom:.5px solid rgba(255,255,255,.10)}',
      '.qtp-guideTitle{font-size:13px;font-weight:560;color:#f4f6f9}',
      '.qtp-guideHint{font-size:11px;color:#8f96a2;white-space:nowrap}',
      '.qtp-guideGroup{padding-top:4px}',
      '.qtp-guideGroupTitle{font-size:10.5px;letter-spacing:.04em;color:#9aa2ae;padding-bottom:3px}',
      '.qtp-guideRow{display:grid;grid-template-columns:96px 1fr;gap:10px;align-items:start;padding:1px 0}',
      '.qtp-guideLabel{color:#cfd5de;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.qtp-guideValue{display:flex;flex-wrap:wrap;align-items:center;gap:5px;min-width:0}',
      '.qtp-guideIcon{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 4px;box-sizing:border-box;border-radius:5px;background:rgba(255,255,255,.06);border:.5px solid rgba(255,255,255,.14);color:#dfe3ea}',
      '.qtp-guideIcon svg{width:12px;height:12px;display:block}',
      '.qtp-guideRate{font:10.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#dfe3ea}',
      '.qtp-guideKey{flex:none;font:10.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(255,255,255,.10);border:.5px solid rgba(255,255,255,.18);border-radius:4px;padding:0 5px;color:#dfe3ea}',
      '.qtp-guideText{color:#a8b0bc;font-size:12px}',
      '.qtp-guideFoot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:9px;padding-top:8px;border-top:.5px solid rgba(255,255,255,.10)}',
      '.qtp-guideFootText{font-size:11px;color:#8f96a2}',
      '.qtp-guideLink{flex:none;background:transparent;border:0;padding:0;color:#7fb7ff;font-size:11.5px;cursor:pointer}',
      '.qtp-guideLink:hover{color:#a9cfff;text-decoration:underline}',
      // the card is the one thing in the layer that takes the mouse
      '.qtp-helpLayer>*:not(.qtp-guide){pointer-events:none}',
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
      var restoredRef = useRef(false)
      var savedAtRef = useRef(0)
      var [loop, setLoop] = useState(false)
      var [chrome, setChrome] = useState(true)
      var [mediaError, setMediaError] = useState('')
      var [zoom, setZoom] = useState(1)
      var [pan, setPan] = useState({ x: 0, y: 0 })
      var [panning, setPanning] = useState(false)
      var [hover, setHover] = useState(null)
      var [timeMode, setTimeMode] = useState(0)
      var [rateOpen, setRateOpen] = useState(false)
      var [clipMarks, setClipMarks] = useState([])
      var [clipOpen, setClipOpen] = useState(false)

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

      // Where this file was left, keyed by its absolute path (blob files have none).
      var resumeKey = source && typeof source.absolutePath === 'string' ? source.absolutePath : ''
      var remember = function (video) {
        if (!video || !resumeKey || !video.duration || video.duration < 1) return
        if (!video.loop && video.currentTime > video.duration - 1) {
          resumeDrop(resumeKey)
          return
        }
        resumeSave(resumeKey, {
          t: Math.round(video.currentTime * 10) / 10,
          duration: Math.round(video.duration * 10) / 10,
          rate: video.playbackRate,
          loop: video.loop,
          volume: video.volume,
          muted: video.muted,
          playing: !video.paused,
          at: Date.now(),
        })
        savedAtRef.current = Date.now()
      }

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
          if (!restoredRef.current) {
            restoredRef.current = true
            var record = resumeLoad(resumeKey)
            if (record !== null) {
              var sameFile = typeof record.duration !== 'number' || Math.abs(record.duration - video.duration) < 1
              var inside = typeof record.t === 'number' && record.t > 0 && record.t < video.duration - 0.5
              if (sameFile && inside) {
                video.currentTime = record.t
                if (typeof record.rate === 'number' && record.rate >= 0.2 && record.rate <= 5) {
                  video.playbackRate = record.rate
                  setRate(record.rate)
                }
                if (record.loop === true) {
                  video.loop = true
                  setLoop(true)
                }
                if (typeof record.volume === 'number') {
                  video.volume = record.volume
                  setVolume(record.volume)
                }
                if (record.muted === true) {
                  video.muted = true
                  setMuted(true)
                }
                if (record.playing === true) {
                  var attempt = video.play()
                  if (attempt && typeof attempt.catch === 'function') {
                    attempt.catch(function () { setPlaying(false) })
                  }
                }
              } else {
                resumeDrop(resumeKey)
              }
            }
          }
          postDiag({ kind: 'meta', duration: video.duration, w: video.videoWidth, h: video.videoHeight, seekable: video.seekable.length > 0 ? [video.seekable.start(0), video.seekable.end(video.seekable.length - 1)] : [], transport: source.transport })
        }
        var onTime = function () {
          setCurrent(video.currentTime)
          if (Date.now() - savedAtRef.current > 1000) remember(video)
        }
        var onSeeked = function () { remember(video) }
        var onEnded = function () {
          if (!video.loop) resumeDrop(resumeKey)
        }
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
        video.addEventListener('seeked', onSeeked)
        video.addEventListener('ended', onEnded)
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
          video.removeEventListener('seeked', onSeeked)
          video.removeEventListener('ended', onEnded)
          remember(video)
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
        if (video.duration) remember(video)
      }, [volume, muted])

      useEffect(function () {
        var video = videoRef.current
        if (!video) return
        video.playbackRate = rate
        if (video.duration) remember(video)
      }, [rate])

      useEffect(function () {
        var video = videoRef.current
        if (!video) return
        video.loop = loop
        if (video.duration) remember(video)
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
            return clampPan(
              anchorX + ratio * (previousPan.x - anchorX),
              anchorY + ratio * (previousPan.y - anchorY),
              next,
            )
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

      // Keep the picture inside the stage: panning stops at the point where the
      // scaled video would expose empty space.
      var clampPan = function (x, y, zoomValue) {
        var stage = stageRef.current
        var video = videoRef.current
        if (!stage || !video || !video.clientWidth || !video.clientHeight) return { x: x, y: y }
        var rect = stage.getBoundingClientRect()
        var maxX = Math.max(0, (video.clientWidth * zoomValue - rect.width) / 2)
        var maxY = Math.max(0, (video.clientHeight * zoomValue - rect.height) / 2)
        return {
          x: Math.min(maxX, Math.max(-maxX, x)),
          y: Math.min(maxY, Math.max(-maxY, y)),
        }
      }

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
        try {
          stage.setPointerCapture(event.pointerId)
        } catch {
          // synthetic pointers and non-active ids cannot be captured
        }
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
          setPan(clampPan(drag.panX + dx, drag.panY + dy, zoom))
        }
      }, [zoom])

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
      var markRange = null
      if (clipMarks.length === 2 && duration > 0) {
        var ratios = clipMarks.map(function (mark) { return Math.min(1, Math.max(0, mark / duration)) })
        var from = Math.min.apply(null, ratios)
        var to = Math.max.apply(null, ratios)
        markRange = h('div', {
          key: 'markRange',
          className: 'qtp-markRange',
          style: { left: (from * 100) + '%', width: ((to - from) * 100) + '%' },
        })
      }

      // Feedback goes through the pane's toast, so one pill serves every action.
      var flash = function (text) {
        if (props.onToast) props.onToast(text)
      }

      var saveClip = function () {
        if (clipMarks.length < 2) {
          flash('\u5148\u7528\u526a\u5200\u6807\u4e24\u4e2a\u70b9')
          return
        }
        if (!props.canExport) {
          flash('\u5bbf\u4e3b\u4e0a\u6ca1\u6709 ffmpeg\uff0c\u6682\u4e0d\u652f\u6301\u5bfc\u51fa\u7247\u6bb5')
          return
        }
        if (!path) {
          flash('\u672c\u5730\u62d6\u5165\u7684\u6587\u4ef6\u4e0d\u80fd\u5bfc\u51fa')
          return
        }
        var from = Math.min.apply(null, clipMarks)
        var to = Math.max.apply(null, clipMarks)
        var stamp = function (seconds) {
          return Math.floor(seconds / 60) + 'm' + String(Math.round(seconds % 60)).padStart(2, '0') + 's'
        }
        var extension = (/\.[a-z0-9]+$/iu.exec(path) || ['.mp4'])[0]
        var name = basenameOf(path).replace(/\.[^.]+$/u, '') + '.trim-' + stamp(from) + '-' + stamp(to) + extension
        var query = new URLSearchParams({ sessionId: sessionId, path: path, from: String(from), to: String(to) })
        flash('\u6b63\u5728\u5bfc\u51fa\u7247\u6bb5\u2026')
        fetch(routePrefix() + '/clip?' + query.toString(), { credentials: 'same-origin' })
          .then(function (response) {
            if (!response.ok) return response.text().then(function (text) { throw new Error(text || ('HTTP ' + response.status)) })
            return response.blob()
          })
          .then(function (blob) {
            var url = URL.createObjectURL(blob)
            var link = document.createElement('a')
            link.href = url
            link.download = name
            link.click()
            setTimeout(function () { URL.revokeObjectURL(url) }, 6000)
            flash('\u5df2\u5bfc\u51fa ' + name)
          })
          .catch(function (error) {
            flash('\u5bfc\u51fa\u5931\u8d25\uff1a' + String(error && error.message ? error.message : error))
          })
      }

      var marks = clipMarks.map(function (mark, index) {
        var ratio = duration > 0 ? Math.min(1, Math.max(0, mark / duration)) : 0
        return h('div', {
          key: 'mark' + index,
          className: 'qtp-mark',
          'data-index': index,
          style: { left: (ratio * 100) + '%' },
          title: formatTime(mark),
        }, [
          h('span', { key: 'l', className: 'qtp-markLine' }),
          h('span', { key: 'b', className: 'qtp-markBadge' }, h(IconScissors)),
        ])
      })

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
                crossOrigin: 'anonymous',
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
              'data-qtp': 'progress',
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
              markRange,
              marks,
              hover ? h('div', { key: 'tip', className: 'qtp-tip', style: { left: hover.x + 'px' } }, formatTime(hover.time)) : null,
            ]),

            h('div', { key: 'row', className: 'qtp-row' }, [
              h('button', { key: 'play', className: 'qtp-btn', 'data-qtp': 'play', onClick: togglePlay, title: '播放 / 暂停 (空格)' }, playing ? h(IconPause) : h(IconPlay)),
              h('button', {
                key: 'time',
                'data-qtp': 'clock',
                className: 'qtp-time',
                onClick: function () { setTimeMode((timeMode + 1) % TIME_MODES.length) },
                title: '点击切换：时间 / 帧号',
              }, clockText()),
              h('div', { key: 'spacer', className: 'qtp-spacer' }),

              h('div', {
                key: 'clip',
                className: 'qtp-clip',
                'data-open': clipOpen ? 'true' : 'false',
                onPointerEnter: function () { setClipOpen(true) },
                onPointerLeave: function () { setClipOpen(false) },
              }, [
                h('div', { key: 'extra', className: 'qtp-clipExtra' }, [
                  h('button', {
                    key: 'save',
                    className: 'qtp-btn',
                    'data-qtp': 'clip-save',
                    title: '\u4fdd\u5b58\u8fd9\u4e00\u6bb5',
                    onClick: function (event) {
                      event.stopPropagation()
                      saveClip()
                    },
                  }, h(IconSave)),
                  h('button', {
                    key: 'clear',
                    className: 'qtp-btn',
                    'data-qtp': 'clip-clear',
                    title: '\u6e05\u9664\u6e38\u6807',
                    onClick: function (event) {
                      event.stopPropagation()
                      setClipMarks([])
                      flash('\u5df2\u6e05\u9664\u6e38\u6807')
                    },
                  }, h(IconClear)),
                ]),
                h('button', {
                  key: 'scissors',
                  className: 'qtp-btn',
                  'data-qtp': 'clip',
                  title: '\u6807\u8bb0\u7247\u6bb5\uff08\u8d77\u70b9 / \u7ec8\u70b9\uff09',
                  onClick: function (event) {
                    event.stopPropagation()
                    var video = videoRef.current
                    var at = video ? video.currentTime : current
                    setClipMarks(function (previous) {
                      return previous.concat([at]).slice(-2)
                    })
                    wake()
                  },
                }, h(IconScissors)),
              ]),

              h('div', {
                key: 'rate',
                className: 'qtp-anchor',
                onPointerEnter: function () { setRateOpen(true) },
                onPointerLeave: function () { setRateOpen(false) },
              }, [
                h('button', { key: 'b', className: 'qtp-btn qtp-rate', 'data-qtp': 'rate', title: '播放速度' }, formatRate(rate)),
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

              h('button', { key: 'loop', className: 'qtp-btn', 'data-qtp': 'loop', 'data-on': loop ? 'true' : 'false', onClick: function () { setLoop(!loop) }, title: '循环播放' }, h(IconLoop)),

              h('div', {
                key: 'vol',
                className: 'qtp-anchor',
                onPointerEnter: function () { setVolumeOpen(true) },
                onPointerLeave: function () { setVolumeOpen(false) },
              }, [
                h('button', { key: 'mute', className: 'qtp-btn', 'data-qtp': 'mute', onClick: toggleMute, title: '静音 (M)' }, IconVolume(!muted && volume > 0)),
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

              h('button', { key: 'pip', className: 'qtp-btn', 'data-qtp': 'pip', onClick: togglePip, title: '画中画' }, h(IconPip)),
              h('button', { key: 'fs', className: 'qtp-btn', 'data-qtp': 'fs', onClick: toggleFullscreen, title: '全屏 (F)' }, h(IconExpand)),
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
    /** Check glyph: a magnifier, so the button reads "look for updates". */
    function IconRefresh() {
      return h('svg', { viewBox: '0 0 16 16', width: 18, height: 18, fill: 'none', xmlns: 'http://www.w3.org/2000/svg' }, [
        h('circle', { key: 'a', cx: 6.9, cy: 6.9, r: 4.5, stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { key: 'b', d: 'M10.4 10.4 L14 14', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
      ])
    }

    /** Update glyph: a cloud with a downward arrow. */
    function IconCloudUpdate() {
      return h('svg', { viewBox: '0 0 16 16', width: 18, height: 18, fill: 'none', xmlns: 'http://www.w3.org/2000/svg' }, [
        h('path', {
          key: 'c',
          d: 'M5.1 10.1h5.7a2.3 2.3 0 0 0 .2-4.6 3.3 3.3 0 0 0-6.3-.7 2.6 2.6 0 0 0 .4 5.3z',
          stroke: 'currentColor', strokeWidth: 1.35, strokeLinejoin: 'round',
        }),
        h('path', { key: 'a', d: 'M8 11.6v2.4', stroke: 'currentColor', strokeWidth: 1.35, strokeLinecap: 'round' }),
        h('path', { key: 'b', d: 'M6.6 12.9 8 14.3 9.4 12.9', stroke: 'currentColor', strokeWidth: 1.35, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      ])
    }

    /** Busy glyph: an open ring that spins while the check is in flight. */
    function IconSpinner() {
      return h('svg', { viewBox: '0 0 16 16', width: 18, height: 18, fill: 'none', xmlns: 'http://www.w3.org/2000/svg' }, [
        h('circle', {
          key: 'a', cx: 8, cy: 8, r: 5.2, stroke: 'currentColor', strokeWidth: 1.5,
          strokeLinecap: 'round', strokeDasharray: '22 11',
        }),
      ])
    }

    /** Save glyph: an arrow into a tray. */
    function IconSave() {
      return h('svg', { viewBox: '0 0 16 16', width: 18, height: 18, fill: 'none', xmlns: 'http://www.w3.org/2000/svg' }, [
        h('path', { key: 'a', d: 'M8 2.6v7.1M5.1 7 L8 9.9 L10.9 7', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { key: 'b', d: 'M3.2 12.6h9.6', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      ])
    }

    /** Clear glyph: a small cross. */
    function IconClear() {
      return h('svg', { viewBox: '0 0 16 16', width: 18, height: 18, fill: 'none', xmlns: 'http://www.w3.org/2000/svg' }, [
        h('path', { key: 'a', d: 'M4.6 4.6 L11.4 11.4 M11.4 4.6 L4.6 11.4', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      ])
    }

    /** Scissors glyph: mark a clip in and out. */
    function IconScissors() {
      return h('svg', { viewBox: '0 0 16 16', width: 18, height: 18, fill: 'none', xmlns: 'http://www.w3.org/2000/svg' }, [
        h('circle', { key: 'a', cx: 3.4, cy: 11.6, r: 1.9, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('circle', { key: 'b', cx: 3.4, cy: 4.4, r: 1.9, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', { key: 'c', d: 'M5.1 5.5 L13.4 12.3 M5.1 10.5 L13.4 3.7', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
      ])
    }

    // ── resume: where each file was left, by absolute path ──────────────────
    var RESUME_KEY = 'qtp:resume:v1'
    var RESUME_LIMIT = 50
    var RESUME_MAX_AGE = 30 * 24 * 60 * 60 * 1000

    function resumeMap() {
      try {
        var raw = window.localStorage.getItem(RESUME_KEY)
        var parsed = raw ? JSON.parse(raw) : null
        return parsed !== null && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    function resumeWrite(map) {
      try {
        window.localStorage.setItem(RESUME_KEY, JSON.stringify(map))
        return true
      } catch {
        return false
      }
    }

    function resumeSave(key, record) {
      if (typeof key !== 'string' || key === '') return
      var map = resumeMap()
      map[key] = record
      var keys = Object.keys(map)
      if (keys.length > RESUME_LIMIT) {
        keys.sort(function (a, b) { return (map[a].at || 0) - (map[b].at || 0) })
        keys.slice(0, keys.length - RESUME_LIMIT).forEach(function (stale) { delete map[stale] })
      }
      if (!resumeWrite(map)) {
        var survivors = Object.keys(map)
        survivors.sort(function (a, b) { return (map[a].at || 0) - (map[b].at || 0) })
        survivors.slice(0, 20).forEach(function (stale) { delete map[stale] })
        resumeWrite(map)
      }
    }

    function resumeLoad(key) {
      if (typeof key !== 'string' || key === '') return null
      var record = resumeMap()[key]
      if (record === null || typeof record !== 'object') return null
      if (typeof record.at !== 'number' || Date.now() - record.at > RESUME_MAX_AGE) return null
      return record
    }

    function resumeDrop(key) {
      if (typeof key !== 'string' || key === '') return
      var map = resumeMap()
      if (map[key] === undefined) return
      delete map[key]
      resumeWrite(map)
    }

    /** Frame-copy glyph: a small screen with a lens. */
    function CopyGlyph() {
      return h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', xmlns: 'http://www.w3.org/2000/svg' }, [
        h('rect', { key: 'b', x: 1.8, y: 3.4, width: 10.4, height: 8.2, rx: 2, stroke: 'currentColor', strokeWidth: 1.4 }),
        h('circle', { key: 'l', cx: 7, cy: 7.5, r: 2.1, stroke: 'currentColor', strokeWidth: 1.4 }),
        h('path', { key: 't', d: 'M12.2 5.6h1.2a.8.8 0 0 1 .8.8v4.4a.8.8 0 0 1-.8.8h-1.2', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      ])
    }

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
      // Flat fallback when the Host icon route is unavailable: plate, ring, play.
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 32 32',
        xmlns: 'http://www.w3.org/2000/svg',
        className: props && props.className,
        'aria-label': 'QuickTime Player',
      }, [
        h('rect', { key: 'plate', x: 1, y: 1, width: 30, height: 30, rx: 7, fill: '#1b1c1f' }),
        h('circle', { key: 'ring', cx: 16, cy: 16, r: 10, fill: 'none', stroke: '#8b5cf6', strokeWidth: 2.2 }),
        h('path', { key: 'play', d: 'M14 11.6 L20.6 16 L14 20.4 Z', fill: '#f8f6ff', stroke: '#f8f6ff', strokeWidth: 1.6, strokeLinejoin: 'round' }),
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
      var [canOpen, setCanOpen] = useState(false)
      useEffect(function () {
        var alive = true
        fetch(routePrefix() + '/capabilities', { credentials: 'same-origin' })
          .then(function (response) { return response.ok ? response.json() : null })
          .then(function (info) {
            if (alive && info && info.opener) setCanOpen(info.opener.available === true)
          })
          .catch(function () {})
        return function () { alive = false }
      }, [])

      var handOff = function (action) {
        if (!props.sessionId || !props.requestPath) return
        var query = new URLSearchParams({ sessionId: props.sessionId, path: props.requestPath, action: action })
        fetch(routePrefix() + '/open?' + query.toString(), { credentials: 'same-origin' })
          .then(function (response) {
            if (!response.ok) props.onToast('打开失败')
          })
          .catch(function () { props.onToast('打开失败') })
      }

      var extra = []
      if (canOpen) {
        extra.push(h('button', {
          key: 'open',
          className: 'qtp-headerBtn',
          title: '用默认应用打开',
          onClick: function (event) { handOff('open'); event.currentTarget.blur() },
        }, h(IconOpenExternal)))
        extra.push(h('button', {
          key: 'reveal',
          className: 'qtp-headerBtn',
          title: '在文件管理器中显示',
          onClick: function (event) { handOff('reveal'); event.currentTarget.blur() },
        }, h(IconReveal)))
      }

      return h('div', { className: 'qtp-header' }, [
        h('span', { key: 'p', ref: pathRef, className: 'qtp-headerPath', title: props.path || '' }, shortenPath(props.path || '', budget)),
      ].concat(extra).concat([
        h('button', {
          key: 'r',
          className: 'qtp-headerBtn',
          onClick: function (event) {
            props.onReload()
            event.currentTarget.blur()
          },
          title: '重新加载',
        }, '\u21bb'),
      ]))
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
      var [canExport, setCanExport] = useState(false)
      var [canOpenFile, setCanOpenFile] = useState(false)
      var [checking, setChecking] = useState(false)
      var [checkResult, setCheckResult] = useState(null)
      var [toast, setToast] = useState('')
      var paneRef = useRef(null)
      var [resolved, setResolved] = useState('')

      useEffect(function () {
        postDiag({ kind: 'tab-mount', address: address, sessionId: sessionId || null, path: path || null })
      }, [])

      var hasFile = path !== undefined && path !== ''
      var headerPath = hasFile ? (resolved || path) : (local ? local.name : '')

      var showToast = function (text) {
        setToast(text)
        setTimeout(function () { setToast('') }, 1800)
      }

      // Copy the current frame as a PNG: clipboard first, download as a fallback.
      var copyFrame = function () {
        var video = paneRef.current ? paneRef.current.querySelector('video') : null
        if (!video || !video.videoWidth) {
          showToast('\u8fd8\u6ca1\u6709\u753b\u9762')
          setTimeout(function () { showToast('') }, 1800)
          return
        }
        var canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        canvas.getContext('2d').drawImage(video, 0, 0)
        var stamp = Math.round(video.currentTime * 1000)
        canvas.toBlob(function (blob) {
          if (!blob) {
            showToast('\u622a\u56fe\u5931\u8d25')
            setTimeout(function () { showToast('') }, 1800)
            return
          }
          var done = function (text) {
            showToast(text)
            setTimeout(function () { showToast('') }, 1800)
          }
          if (navigator.clipboard && typeof window.ClipboardItem === 'function') {
            navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]).then(function () {
              done('\u5df2\u590d\u5236\u5f53\u524d\u5e27\u5230\u526a\u5207\u677f')
            }).catch(function () { download(blob) })
          } else {
            download(blob)
          }
          function download(payload) {
            var url = URL.createObjectURL(payload)
            var link = document.createElement('a')
            link.href = url
            link.download = (basenameOf(path) || 'frame') + '-' + stamp + 'ms.png'
            link.click()
            setTimeout(function () { URL.revokeObjectURL(url) }, 4000)
            done('\u526a\u8d34\u677f\u4e0d\u53ef\u7528\uff0c\u5df2\u4e0b\u8f7d PNG')
          }
        }, 'image/png')
      }

      useEffect(function () {
        var aborted = false
        fetch(routePrefix() + '/capabilities', { credentials: 'same-origin' })
          .then(function (response) { return response.ok ? response.json() : null })
          .then(function (info) {
            if (aborted || !info) return
            if (info.ffmpeg) setCanExport(info.ffmpeg.available === true)
            if (info.opener) setCanOpenFile(info.opener.available === true)
          })
          .catch(function () {})
        return function () { aborted = true }
      }, [])

      var checkUpdate = function () {
        if (checking) return
        setChecking(true)
        fetch(routePrefix() + '/version', { credentials: 'same-origin' })
          .then(function (response) { return response.json() })
          .then(function (info) { setCheckResult(info && typeof info === 'object' ? info : { error: 'no answer' }) })
          .catch(function (error) { setCheckResult({ error: String((error && error.message) || error) }) })
          .then(function () { setChecking(false) })
      }

      var closeCheck = function () { setCheckResult(null) }

      var openFeedback = function () {
        fetch(routePrefix() + '/link?to=feedback', { credentials: 'same-origin' })
          .then(function (response) {
            if (response.ok) return
            throw new Error('HTTP ' + response.status)
          })
          .catch(function () {
            var fallback = 'https://github.com/rUrU516/dsh-quicktime-player/issues/new?template=feedback.yml'
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(fallback).catch(function () {})
              showToast('打不开浏览器，链接已复制')
              return
            }
            showToast('打开失败')
          })
      }

      var renderCheckDialog = function () {
        if (checkResult === null) return null
        var version = function (text) { return typeof text === 'string' && text !== '' ? text : '\u2014' }
        var newer = false
        if (checkResult.latest && checkResult.installed) {
          var split = function (value) { return String(value).split('.').map(function (part) { return parseInt(part, 10) || 0 }) }
          var a = split(checkResult.installed)
          var b = split(checkResult.latest)
          for (var i = 0; i < 3 && !newer; i += 1) {
            if ((b[i] || 0) !== (a[i] || 0)) newer = (b[i] || 0) > (a[i] || 0)
          }
        }
        var lines
        if (checkResult.error) lines = ['\u68c0\u67e5\u5931\u8d25\uff1a' + checkResult.error]
        else if (!checkResult.latest) lines = ['\u62ff\u4e0d\u5230\u6700\u65b0\u7248\u672c\u53f7']
        else if (newer) lines = ['\u53d1\u73b0\u65b0\u7248\u672c ' + version(checkResult.latest), '\u5f53\u524d ' + version(checkResult.installed)]
        else lines = ['\u5df2\u662f\u6700\u65b0\u7248\u672c ' + version(checkResult.installed)]
        return h('div', {
          key: 'checkDialog',
          className: 'qtp-dialogBackdrop',
          onClick: closeCheck,
        }, h('div', {
          key: 'card',
          className: 'qtp-dialog',
          onClick: function (event) { event.stopPropagation() },
        }, [
          h('div', { key: 't', className: 'qtp-dialogTitle' }, '\u66f4\u65b0\u68c0\u67e5'),
          h('div', { key: 'b', className: 'qtp-dialogBody' }, lines.map(function (line, index) {
            return h('div', { key: 'l' + index, className: index === 0 ? 'qtp-dialogLine' : 'qtp-dialogSub' }, line)
          })),
          h('button', { key: 'ok', className: 'qtp-dialogBtn', onClick: closeCheck }, '\u77e5\u9053\u4e86'),
        ]))
      }

      // The guide is plain content: a card in the top-left corner. No measuring,
      // no arrows, nothing to re-compute when the pane resizes.
      var renderGuide = function () {
        var content = [
          h('div', { key: 'head', className: 'qtp-guideHead' }, [
            h('span', { key: 't', className: 'qtp-guideTitle' }, '\u4f7f\u7528\u8bf4\u660e'),
            h('span', { key: 'h', className: 'qtp-guideHint' }, '\u518d\u70b9\u4e00\u6b21 ? \u6536\u8d77'),
          ]),
        ]
        HELP_GROUPS.forEach(function (group) {
          var rows = group.rows.filter(function (row) {
            return !row.needsOpener || canOpenFile
          }).map(function (row) {
            var value = []
            if (row.icon) {
              var glyph = { scissors: IconScissors, camera: CopyGlyph, volume: IconVolume, expand: IconExpand, cloud: IconCloudUpdate, external: IconOpenExternal, folder: IconReveal, rate: null }[row.icon]
              value.push(h('span', { key: 'i', className: 'qtp-guideIcon' }, row.icon === 'rate' ? h('span', { key: 'r', className: 'qtp-guideRate' }, '1\u00d7') : h(glyph, { key: 'g' })))
            }
            if (row.keys) {
              row.keys.forEach(function (key, index) {
                value.push(h('span', { key: 'k' + index, className: 'qtp-guideKey' }, key))
              })
            }
            if (row.text) value.push(h('span', { key: 'x', className: 'qtp-guideText' }, row.text))
            return h('div', { key: row.label, className: 'qtp-guideRow' }, [
              h('span', { key: 'l', className: 'qtp-guideLabel' }, row.label),
              h('span', { key: 'v', className: 'qtp-guideValue' }, value),
            ])
          })
          content.push(h('div', { key: group.title, className: 'qtp-guideGroup' },
            [h('div', { key: 't', className: 'qtp-guideGroupTitle' }, group.title)].concat(rows)))
        })
        content.push(h('div', { key: 'foot', className: 'qtp-guideFoot' }, [
          h('span', { key: 't', className: 'qtp-guideFootText' }, '有问题或想要的功能？'),
          h('button', {
            key: 'b',
            className: 'qtp-guideLink',
            onClick: function (event) { event.stopPropagation(); openFeedback() },
          }, '去 GitHub 提 issue \u2192'),
        ]))

        return h('div', { key: 'help', className: 'qtp-helpLayer' }, [
          h('div', { key: 'card', className: 'qtp-guide' }, content),
        ])
      }

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
          pinned: helpOpen,
          onToast: showToast,
          canExport: canExport,
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

      return h('div', { ref: paneRef, className: 'qtp-pane' }, [
        helpOpen ? renderGuide() : null,
        renderCheckDialog(),
        h('button', {
          key: 'checkBtn',
          className: 'qtp-helpBtn qtp-checkBtn',
          'data-qtp': 'check',
          'data-busy': checking ? 'true' : 'false',
          title: '\u68c0\u67e5\u66f4\u65b0',
          onClick: function (event) {
            event.stopPropagation()
            checkUpdate()
          },
        }, checking ? h(IconSpinner) : h(IconCloudUpdate)),
        h('button', {
          key: 'copyBtn',
          className: 'qtp-helpBtn qtp-copyBtn',
          'data-qtp': 'copy',
          title: '\u590d\u5236\u5f53\u524d\u5e27',
          onClick: function (event) {
            event.stopPropagation()
            copyFrame()
          },
        }, h(CopyGlyph)),
        toast ? h('div', { key: 'toast', className: 'qtp-toast' }, toast) : null,
        h('button', {
          key: 'helpBtn',
          className: 'qtp-helpBtn',
          'data-qtp': 'help',
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
          requestPath: path || '',
          sessionId: sessionId,
          onToast: showToast,
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
      pluginCtx = ctx
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
