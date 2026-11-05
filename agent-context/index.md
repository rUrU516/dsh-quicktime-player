# dsh-quicktime-player — shadow context

Working notes for whoever picks this up next (human or agent). Read this file first, then only the file that
matches your task.

| File | What it holds | Read it when |
| --- | --- | --- |
| `context-runtime.md` | The DSH install this was built against, where its sources live, how to hot-reload a plugin | before touching code or believing anything about the environment |
| `context-research.md` | Why the design is what it is: tab-type auction, transport constraints, the Electron seek problem | before changing the registration or the streaming route |
| `context-progress.md` | What ships today, what was verified and how, where the seams are | at the start of any session |
| `context-decisions.md` | Questions that were asked and answered, so they are not re-litigated | when a design question comes up again |
| `context-backlog.md` | Ideas asked for but deliberately not built, with the open questions attached | before promising a feature that sounds familiar |

## Current shape (0.3.0)

- The plugin registers **its own right-sidebar tab type** and claims video addresses with per-suffix globs, so every
  video opened through DSH lands in it. No dependency on any other sidebar plugin.
- The Host half streams bytes with HTTP `Range` and exposes a tokenized `127.0.0.1` media source, because Chromium
  cannot seek a `<video>` served over the Electron shell's custom protocol.
- Published as `dsh-quicktime-player` on npm; source at https://github.com/rUrU516/dsh-quicktime-player.

## Conventions

- Unsure about a runtime fact? Verify it against the sources listed in `context-runtime.md`; do not guess.
- Keep the player a single React component in `client.js` and the Host half in `index.js`. No build step.
- `node test/smoke.cjs` (render) and `node test/browser.cjs` (real Chromium) must pass before shipping.
