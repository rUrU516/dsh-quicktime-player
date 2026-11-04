# 调研结论：怎么让侧边栏能播视频

状态：调研记录。最终实现**没有**采用下面的「两个插入点」方案，而是注册了自己的页签类型（见
`context-decisions.md` 与 `context-progress.md`）；这里保留的分析仍然是理解传输层与 Electron seek 限制的依据。

结论里的「已核实」都指读过本机 DSH 源码/配置，路径见 `context-runtime.md`。

---

## 1. 为什么现在看到的是「此文件类型不支持预览」

已核实的三条事实：

1. 用户侧边栏是 **dsh-better-sidebar 0.28.2**（`/Users/zhuoru/.dsh/profiles/desktop/node_modules/dsh-better-sidebar`）。
   截图里的「文件」面板是它的 explorer（`editorSearchPlaceholder: "按文件名搜索…"`，`lib/client-registry.js:2408`）。
2. 它的**内置 viewer 只有 4 个**：`markdown / html / jsonl / code`（`lib/client-registry.js:27707` `builtinViewers()`），
   **没有 video**；`code` 是 `exts: []`、`priority: -100` 的兜底。于是 `.mp4` 被 `code` 以 `fsRead` 认领，
   宿主读到的是二进制 → `planFsReadOutcome` 落到 `BinaryDownload`（`lib/client-registry.js` 约 4790 行，文案 `binaryNoPreview` / `downloadToView`）。截图与代码完全对上。
3. 社区里已有同类插件（`dsh-video-preview` 走 better-sidebar 的 viewer 注册，`dsh-media-preview` 走原生
   `documentPreviews`），两者都印证了：视频这类二进制没有内置渲染器，必须由插件接管。

顺带一个已核实的次要事实：DSH 原生文档预览把 `mp4/mov/avi/mkv/webm/flv/wmv/m4v` 以及音频后缀放进
`UNVIEWABLE_BINARY_EXTENSIONS`，无渲染器时直接显示「不支持预览」；**一旦有插件注册了这些后缀就优先用插件**
（`dsh-client-ui-sidebar-documentpreview/lib/client.js` 约 380 行）。这就是「官方留的扩展点」。

---

## 2. 两个可插入的位置

### A. better-sidebar 的 file viewer（对应用户现在的操作路径）

```js
// 客户端 bundle 里
export const inject = ['betterSidebar']
ctx.effect(() => ctx.betterSidebar.registerFileViewer({
  id: 'video',
  exts: ['mp4','webm','mov', ...],
  fetchStrategy: 'none',        // 不自带内容，body 自己拉流
  component: (props) => <video src={...} controls />
}))
```

- 类型定义：`dsh-better-sidebar/lib/types/client/service.d.ts`（`FileViewerDescriptor`、`FileViewerProps`、
  `FileFetchStrategy = 'none' | 'fsRead' | 'mediaUrl' | 'custom' | 'binary-download'`）。
- `FileViewerProps` 给到 `ctx / store / scope(sessionId, cwd) / path / title / viewerId / mediaUrl?` 等。
- 优点：**用户点文件的地方就是这里**，改完立刻在原来的 UI 里生效；`fetchStrategy: 'none'` 让组件完全自绘播放器。
- 缺点：绑死 better-sidebar（如果用户以后关掉它就没用了）。
- 这条路线 `dsh-video-preview` 已经走过：https://github.com/zemul/dsh-video-preview 。

### B. DSH 原生文档预览（`ctx.documentPreviews.register`）

```js
ctx.documentPreviews.register({
  id: 'dsh-xxx/video',
  extensions: ['mp4','webm','mov', ...],
  binaryExtensions: [...],      // 声明为二进制，于是不给「纯文本」兜底
  priority: 'extension',        // 外部插件默认档，比 builtin 高
  title: () => t('title'),
  loading: 'renderer',          // 插件自己负责加载，挂载时不读字节
})
// 正文注册到 keyed slot：
ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
  name: 'sidebar.right.tab.document',
  key: ID, locale: 'xxx', store, inject: (sessionId, actions) => ({ ... })
}, VideoBody))
```

- 已核实：注册表 `DocumentPreviewRegistry.register()`（`.../documentpreview/lib/client.js` 约 300–380 行），
  正文 slot 的写法照抄 image 那条（同文件 5240–5270 行）。
- 优点：不依赖 better-sidebar，属于「官方扩展点」，注册后原生预览 tab 里直接出播放器；
  `loading: 'renderer'` 让 body 自己决定怎么取字节，不用走 `bytes-complete` 的整文件内存拷贝。
- 缺点：**用户现在点文件的入口在 better-sidebar 里，不会进原生预览 tab**（better-sidebar 自己画编辑器页签，
  不把文件交给宿主 documentpreview）。要让这条路线被看见，得另外给 better-sidebar 注册一个「打开方式」入口，
  或者让用户从原生右侧栏/文件引用打开。
- 已有第三方实现走这条路：`dsh-media-preview`（视频 + 音频，Native documentpreview），
  README 说明了 route 怎么设计、桌面端 seek 怎么绕： https://dshbase.com/plugins/dsh-media-preview/

**两条可以同时支持**：同一个包里既注册 better-sidebar viewer，又注册 documentpreview；共享同一条宿主流式路由。

---

## 3. 传输层：为什么必须自建一条 Range 路由

| 通道 | 位置 | 现状（已核实） | 能不能给 `<video>` 用 |
|---|---|---|---|
| 宿主 `/api/file?path=…` | `dsh-api-session-controller/lib/index.js:2420+` | `fs.readBytes()` **整文件读入内存**，只有 `200`，上限是 `attachments.imageLimits.maxImageBytes` | ❌ 无 Range，大文件 413 |
| better-sidebar `/sidebar/file?…` | `dsh-better-sidebar/lib/index.js:9571+`，`streamFileToResponse` | `createReadStream` 流式，但**只有 200**，无 `accept-ranges` | ⚠️ 能播，**不能拖进度** |
| 插件自建 `ctx.webServer.register({kind:'prefix', path:'/xxx'})` | `dsh-host-webserver` | 完全可控，可回 206/416/HEAD | ✅ 推荐 |
| 整文件读成 Blob (`URL.createObjectURL`) | 客户端 | 一次性进内存；blob 上 seek 正常，但没有流式、大文件会爆内存 | ⚠️ 小文件可用的退路 |

要点：**浏览器拖动进度条要求服务端支持 `Range` 并回 `206 Partial Content` + `Content-Range`**，这不是可选项。

自建路由有两条子路线：

1. **挂在 `/api/` 下**（`dsh-media-preview` 的做法）：走 `connection` 服务的 FetchRegistry，
   Host/Origin 防线 + 浏览器 cookie 鉴权**免费**（`dsh-client-connection/lib/index.js:1040+` 的 `/api` 前缀路由
   先做 `connection.admit(req)` 再分发）。省掉手写信任围栏。
2. **自己判 Host/Origin + 自己限制路径**（`dsh-video-preview` 的做法）：把 `/video` 顶在根上，
   自己实现 `isTrustedApiRequest` 与 `isWithin(sessionCwd, path)`。

两者都要做**路径围栏**：只能读 session 工作目录之内的文件（`ctx.sessions.get(sessionId).header.cwd`）。
> 注意：截图里那个文件在 `/Users/zhuoru/fiture/argus-algorithms/harness/out/run366/stacked.mp4`，
> 若该会话 cwd 不是它的祖先，任何「限定 cwd」的路由都会 403，播放器就是黑的。这可能是「效果不行」的一种。

字节读取可以用 `ctx.fs.readByteRange(target, range, signal)`（`dsh-fs-local/lib/index.js:843`）按块读，
不用自己 `createReadStream`，并且自动继承宿主的 fs 策略（沙箱/观察策略）。

---

## 4. 桌面端专有的坑：`dsh-app://` 下 `<video>` 不能 seek

已核实的链路（`context-runtime.md` 第 2 节）：

- 桌面页面 origin 是 `dsh-app://app`，相对 URL 由 `protocol.handle` 代理到宿主 `127.0.0.1:54431`。
- 于是 `<video src="/video?…">` 实际是 `dsh-app://app/video?…` → 自定义协议响应。

未在我这里实测、但有两个独立来源指向同一个结论：

- Electron issue 标题即 `[Bug]: video files not seekable with protocol.handle`（https://github.com/electron/electron/issues/38749 ，另有 #51442）。
- `dsh-media-preview` README 明确写：「Chromium 的媒体栈无法对自定义协议处理器产生的响应做 seek（`video.seekable` 退化成 `[0,0]`），
  所以桌面端会出现『能播、但一拖进度就弹回开头』」，并因此**另开一个 127.0.0.1 的临时端口 + 一次性 token** 作为媒体源。

推论（需实测确认）：**`dsh-video-preview` 在桌面端「效果不行」高度可能就是这一条** —— 结构上它的 `<video>` 就是走 `dsh-app://` 的。
另外两个可疑点：路径被 cwd 围栏 403、以及播放器样式（`height:100%` + `flex` 在编辑器页签里可能被压扁/黑边）。

绕法（按推荐度）：

1. **回环媒体源**：插件在宿主里起一个只绑 `127.0.0.1` 的临时 http 服务，端口随机、路径里带一次性随机 token，
   支持 `Range`；浏览器半先请求 `/api/…?discover=1` 拿到这个地址再喂给 `<video>`。
   桌面端和浏览器端都能用，`127.0.0.1` 是可信源，不受混合内容拦截。（`dsh-media-preview` 的做法）
2. **让用户在普通浏览器里打开 `http://127.0.0.1:54431`**：那是真实 http origin，普通 Range 路由就能拖进度；
   代价是不用桌面壳了（这条只是「验证/退路」，不是产品方案）。
3. **Blob 方案**：客户端把整文件拉下来做 blob URL，seek 正常，但大文件不可接受。

---

## 5. 参考实现对照

| | dsh-video-preview | dsh-media-preview |
|---|---|---|
| 插入点 | better-sidebar `registerFileViewer` | 原生 `documentPreviews`（视频 + 音频） |
| 宿主路由 | 自建 `/video`，手写 Host/Origin 围栏 | `/api/media-preview`（走 connection 鉴权）+ 回环令牌源 |
| Range | 自己解析 `Range/If-Range/后缀 range`，206/416 | 自己解析，`ctx.fs.readByteRange` 分块（默认 1 MiB） |
| 桌面 seek | ❌ 没处理（推断） | ✅ 回环端口 |
| 播放器 UI | 原生 `<video controls>` + 文件名/下载 | 原生控件 + 倍速/循环/全屏/画中画，按浏览器记忆 |
| 大小上限 | 无（流式） | `maxBytes` 2 GiB |

两者都在 GitHub/npm 上可读到完整实现，可以作为「照抄骨架、重写体验」的起点。

---

## 6. 还没确认的事（问用户，别猜）

见 `context-open-questions.md`。最关键的一条：**用户说的「效果不行」到底指哪一层** ——
没显示/黑屏、能播但拖不动、样子难看、大文件卡、还是就想交给系统 QuickTime 播。
这直接决定我们是「重写一个更好的内联播放器」还是「换个插入点/换条路」。

## 7. 如果最后要写，最小骨架（只是结构，不含实现）

```
dsh-quickTime-Player/
  package.json          # name / type:module / exports{".","/client"} / dsh.client{inject,platform:web} / dsh.bundle.patch
  cordis.patch.yml      # insert: [{ id: quicktime-player, name: dsh-quickTime-Player }]
  index.js              # 宿主半：Config + 流式 Range 路由（+ 桌面回环源）+ 路径围栏
  client.js             # 浏览器半：手写 __ModuleLoader__ bundle，注册 viewer / documentpreview
```

- 无构建链也能跑（`window.__ModuleLoader__.load({ id, factory })`，只向模块表要 `react`），
  `dsh-video-preview` / `dsh-media-preview` 都是这么发的。
- 安装：`runtime/cli/bin/dsh plugin --profile desktop add link:/Users/zhuoru/dsh-quickTime-Player`，
  再把包名加进 profile `package.json` 的 `dsh.profile.bundles`，重启桌面应用。
