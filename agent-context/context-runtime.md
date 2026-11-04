# 运行时事实（已核实）

采样时间：2026-11-04 18:30 左右，机器 macOS / arm64。

## DSH 本体

- 应用：`/Applications/DeepSeek Harness.app`，DSH 包版本 **0.2.1-rc.5**（`app.asar` 内 `dsh/package.json`）。
- 源码在 **asar 里**，不是普通目录：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`（182 MB）。
  - Electron 外壳在 `/lib/main.js`、`/renderer/*`（注意：**不是** `/dsh/lib`）。
  - harness 包在 `/dsh/node_modules/@deepseek-ai/*`。
- 读取方法（本次调研用过的脚本，可复用）：解析 asar 头 →
  - 头部布局：file[4..8]=headerPickleSize，file[12..16]=JSON 字符串长度，JSON 从 file[16] 开始；
  - 数据区起点 `base = 8 + headerPickleSize`；每个文件在 `base + offset` 处。
  - 生成过 `/tmp/asarprobe/files.tsv`（path / offset / size / unpacked），抽出 `@deepseek-ai/*` 到 `/tmp/dshsrc/all`（55 MB）。
  - `/tmp` 会被清掉，需要时照上面规则重写十行脚本即可。

## 运行形态

- 用户用的是 **Desktop（Electron）**：`/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness`，宿主进程
  `--expose-internals .../dsh-desktop-host/lib/index.js <app.asar/dsh> ~/.dsh/profiles/desktop ...`。
- 宿主 HTTP 监听：`127.0.0.1:54431`（PID 85377）；运行时上下文给的 Web GUI URL 就是它。
- **渲染进程的 origin 不是 http**：页面来自 `dsh-app://app`（`protocol.registerSchemesAsPrivileged`，privileges 含
  `standard/secure/supportFetchAPI/corsEnabled/stream/codeCache`）。
  `protocol.handle(SCHEME)`（`/lib/main.js` 约 12406 行）的分流：
  - `dsh-app://shell/*` → 本地 `renderer/` 静态文件；
  - `dsh-app://app/`、`/index.html`、`/assets/*`、`/favicon.svg`、`/manifest.webmanifest` → `dsh-web-frontend/dist`；
  - **其他任何路径 → `forwardWebRequest()` 代理到宿主 `hostUrl`，并注入宿主 cookie**（约 8268 行）。
    它只剥掉 `host/origin/cookie/sec-fetch-site` 请求头与 `set-cookie/content-encoding/content-length/...` 响应头，
    **`content-range`、`accept-ranges`、`206` 状态、流式 body 都保留**。
  - 结论：插件注册的宿主路由（例如 `/video?...`、`/api/...`）在桌面端**能通过相对 URL 访问到**，走的是宿主 127.0.0.1 端口。
- 普通浏览器打开 `http://127.0.0.1:54431` 是另一条路径（真实 HTTP origin），行为与桌面端在 Range 上不同，见 `context-research.md`。

## Profile（插件装在哪）

- Profile 名：`desktop`，目录 `~/.dsh/profiles/desktop/`。
  - `package.json`：`dependencies` + `dsh.profile.bundles`（顺序即组合优先级）。**只有在 bundles 里的包才会被加载**；
    仅列为 dependency 不会生效。`dsh plugin add` 会读包里的 `dsh.bundle.patch` 自动补上。
  - `cordis.patch.yml`：profile 补丁层（覆盖 config / disabled / insert 行）。
  - `node_modules/`：本 profile 的依赖（better-sidebar 0.28.2、dsh-context、dshmarket…）。
- 当前 bundles：`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`dshmarket`、`dsh-context`、
  `@local/dsh-cursor-ripples`、`dsh-better-sidebar`。
- 安装 CLI（用应用自带的，不要用 `/opt/homebrew/bin/dsh`，那是 0.1.0-rc.7 的另一套）：
  `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh plugin --profile desktop add <spec>`
  （它把参数原样转发给 profile 目录里的 pnpm；本地开发用 `link:/abs/path`）。
- 客户端 bundle 由 `dsh-client-modules` 从包的 `dsh.client` 声明组装，经 `/plugins/<pkg>/client.js` 提供给浏览器；
  **必须是构建产物**（本插件手写 `window.__ModuleLoader__.load({id, factory})`，不需要构建链）。
- 页面/宿主刷新：改宿主代码通常要重启应用；客户端 bundle 变了至少要硬刷新页面（HMR 只对启用 HMR 的 profile 生效，`desktop` 未验证）。

## 相关源码位置（asar 内路径）

| 用途 | 路径 |
|---|---|
| Electron 主进程（协议代理、窗口、IPC） | `/lib/main.js` |
| Electron preload | `/lib/preload-app.cjs` |
| 原生文档预览（`documentPreviews` 服务、mp4 在「不可预览」清单里） | `/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-documentpreview/lib/client.js` |
| `documentPreviews.register` 实现与匹配顺序 | 同上，约 250–400 行（注册表）、5150–5270 行（image 定义 + body 注册示例） |
| `/api/file` 路由（整文件读入内存，无 Range） | `.../dsh-api-session-controller/lib/index.js` 约 2420–2490 行 |
| `/api` 前缀路由 + 鉴权（Host/Origin + 浏览器 cookie） | `.../dsh-client-connection/lib/index.js` 约 1040–1070 行 |
| `ctx.webServer.register` / index 注入 | `.../dsh-host-webserver`（README.zh.md 很全） |
