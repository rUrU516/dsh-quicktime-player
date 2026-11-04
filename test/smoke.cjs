/**
 * Smoke test: loads the browser bundle the way the DSH module loader does,
 * runs apply() against a stub context, then renders both entry points with
 * react-dom/server. Catches the "element type is invalid" class of bugs
 * without opening the app.
 *
 *   node test/smoke.cjs
 */
const fs = require('node:fs')
const path = require('node:path')

// One matching react/react-dom pair (the profiles/ links point at two
// different copies, which makes every element look foreign to the renderer).
const PAIR = '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-trajectory/node_modules'
const React = require(PAIR + '/react')
const { renderToString } = require(PAIR + '/react-dom/server')

const bundle = fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8')

// ── minimal browser globals the bundle touches ──────────────────────────────
const headChildren = []
global.document = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, style: {}, textContent: '' }),
  head: { appendChild: (node) => headChildren.push(node) },
  fullscreenElement: null,
  activeElement: null,
  pictureInPictureEnabled: false,
  pictureInPictureElement: null,
}
global.window = {
  __DSH_BOOT__: { release: { version: 'test', commit: 'test' } },
  __ModuleLoader__: {
    load: (definition) => {
      global.__captured = definition
    },
  },
}
global.fetch = () => Promise.reject(new Error('no network in smoke test'))

// ── load the bundle ─────────────────────────────────────────────────────────
new Function('window', 'document', 'fetch', bundle)(global.window, global.document, global.fetch)
const definition = global.__captured
if (!definition) throw new Error('bundle did not register a factory')
if (definition.id !== 'dsh-quicktime-player') throw new Error('unexpected bundle id: ' + definition.id)

const mod = definition.factory((name) => {
  if (name === 'react') return React
  if (name === 'react/jsx-runtime') return require(PAIR + '/react/jsx-runtime')
  throw new Error('unexpected require: ' + name)
})

if (typeof mod.apply !== 'function') throw new Error('bundle exports no apply()')
console.log('inject:', JSON.stringify(mod.inject))

// ── stub host context ───────────────────────────────────────────────────────
const calls = { previews: [], slots: [], viewers: [], effects: [], tabTypes: [], tabBodies: [] }
const ctx = {
  effect: (factory, label) => {
    calls.effects.push(label)
    const disposer = factory()
    return typeof disposer === 'function' ? disposer : () => {}
  },
  documentPreviews: {
    register: (definition) => {
      calls.previews.push(definition)
      return () => {}
    },
  },
  slots: {
    inject: (name, factory) => factory(),
    register: (options, component) => {
      calls.slots.push({ options, component })
      return () => {}
    },
  },
  inject: (deps, callback) => {
    const sub = {
      effect: (factory, label) => {
        calls.effects.push('sub:' + label)
        const disposer = factory()
        return typeof disposer === 'function' ? disposer : () => {}
      },
      sidebarRightTabs: {
        register: (definition) => {
          calls.tabTypes.push(definition)
          return () => {}
        },
      },
      slots: {
        inject: (name, factory) => factory(),
        register: (options, component) => {
          calls.slots.push({ options, component })
          calls.tabBodies.push({ options, component })
          return () => {}
        },
      },
    }
    callback(sub)
  },
}

mod.apply(ctx)

console.log('previews:', calls.previews.map((entry) => entry.id + ' [' + entry.extensions.join(',') + '] loading=' + entry.loading))
console.log('slots:', calls.slots.map((entry) => entry.options.name + '#' + entry.options.key))
console.log('tab types:', calls.tabTypes.map((entry) => entry.id + ' kind=' + entry.kind + ' patterns=' + entry.patterns.length))
console.log('effects:', calls.effects.length)

if (calls.previews.length !== 1) throw new Error('expected one document preview registration')

// The pane calls `selected.title()` unconditionally while building the body
// slot fallback, so a string here throws and abdicates the shared pane entry.
const preview = calls.previews[0]
if (preview.title !== undefined && typeof preview.title !== 'function') {
  throw new Error(`documentPreviews.title must be a function, got ${typeof preview.title}`)
}
if (!Array.isArray(preview.extensions) || preview.extensions.length === 0) throw new Error('extensions must be a non-empty array')
for (const ext of preview.binaryExtensions ?? []) {
  if (!preview.extensions.includes(ext)) throw new Error(`binaryExtensions entry ${ext} is not declared in extensions`)
}
const documentBodies = calls.slots.filter((entry) => entry.options.name === 'sidebar.right.tab.document')
const paneBodies = calls.slots.filter((entry) => entry.options.name === 'sidebar.right.pane.tab')
if (documentBodies.length !== 1) throw new Error('expected one document body registration')
if (paneBodies.length !== 1) throw new Error('expected one pane body registration')
if (calls.tabTypes.length !== 1) throw new Error('expected one sidebar tab type registration')
const tabType = calls.tabTypes[0]
if (tabType.priority !== 'extension') throw new Error('tab type must sit in the extension band to win the auction')
if (typeof tabType.title !== 'function') throw new Error('tab type title must be a function(address)')
if (typeof tabType.canOpen !== 'function') throw new Error('tab type needs canOpen')
const GENERIC_FILE_GLOB = 'dsh-resource://file/**'
const declared = preview.extensions
for (const pattern of tabType.patterns) {
  if (pattern.length <= GENERIC_FILE_GLOB.length) {
    throw new Error(`pattern "${pattern}" must be longer than "${GENERIC_FILE_GLOB}" to outrank it`)
  }
  const suffix = pattern.slice(pattern.lastIndexOf('.') + 1)
  if (!declared.includes(suffix)) throw new Error(`pattern "${pattern}" is not one of the declared video suffixes`)
  if (!pattern.startsWith('dsh-resource://file/')) throw new Error(`pattern "${pattern}" is not a file address`)
}
if (tabType.patterns.length !== declared.length) throw new Error('every video suffix needs its own pattern')

if (!Array.isArray(tabType.guide) || tabType.guide.length !== 1) throw new Error('tab type needs exactly one guide entry')
const guide = tabType.guide[0]
if (typeof guide.id !== 'string' || !guide.id) throw new Error('guide entry needs an id')
if (typeof guide.order !== 'number') throw new Error('guide entry needs a numeric order')
for (const field of ['title', 'description']) {
  if (typeof guide[field] !== 'function') throw new Error(`guide entry ${field} must be a function`)
}
if (typeof guide.icon !== 'function') throw new Error('guide entry needs an icon component')

const tabBody = calls.tabBodies.find((entry) => entry.options.key === tabType.id)
if (tabBody === undefined) throw new Error('no pane body registered for the tab type id')

// ── render both entry points ────────────────────────────────────────────────
const Body = documentBodies[0].component
const Viewer = paneBodies[0].component

const content = {
  kind: 'renderer',
  revision: 1,
  loaded: () => {},
  failed: () => {},
  reload: () => {},
}

const bodyHtml = renderToString(
  React.createElement(Body, {
    resourceAddress: 'dsh-resource://file/session/session-1/tmp/clip.mp4',
    content,
    wrap: false,
    scrollportRef: () => {},
    addResource: () => {},
    setResources: () => {},
    sessionId: 'session-1',
  }),
)
console.log('body html length:', bodyHtml.length)
if (!bodyHtml.includes('qtp-root')) throw new Error('body did not render the player root')

const paneHtml = renderToString(
  React.createElement(tabBody.component, {
    sessionId: 'session-1',
    useTabInfo: () => ({ tab: { id: 'tab-1', contentId: 'dsh-resource://file/session/session-1/test/sample.mp4' } }),
  }),
)
console.log('pane html length:', paneHtml.length)

const emptyHtml = renderToString(
  React.createElement(tabBody.component, {
    sessionId: 'session-1',
    useTabInfo: () => ({ tab: { id: 'tab-2', contentId: 'dsh-pane://quicktime-player-video' } }),
  }),
)
console.log('empty html length:', emptyHtml.length)
if (!emptyHtml.includes('qtp-empty')) throw new Error('page address did not render the empty pane')
if (emptyHtml.includes('qtp-dropNote') === false) throw new Error('empty pane is missing its note')
if (!paneHtml.includes('qtp-pane')) throw new Error('pane body did not render')

const viewerHtml = renderToString(
  React.createElement(Viewer, {
    sessionId: 'session-1',
    useTabInfo: () => ({ tab: { id: 'tab-1', contentId: 'dsh-resource://file/session/session-1/test/clip.mp4' } }),
  }),
)
console.log('viewer html length:', viewerHtml.length)
if (!viewerHtml.includes('qtp-root')) throw new Error('pane body did not render the player root')
if (!viewerHtml.includes('qtp-header')) throw new Error('pane body did not render its header')

// the transport bar must contain every icon button without type errors
for (const label of ['播放 / 暂停 (空格)', '循环播放', '画中画', '全屏 (F)']) {
  if (!viewerHtml.includes(label)) throw new Error('missing control: ' + label)
}

console.log('OK')
