# Backlog — asked for, not built

Ideas the user raised that are deliberately parked. Each entry says what was asked, in their words where possible,
and what would have to be true before it is worth building.

## Feedback board

> "我希望提供一个这个留言板，然后 maybe 就会自动转成 pr 或者什么的，然后能够让我知道大家的反馈和希望修改的地方"

A place inside the player where a user can leave feedback, and a mechanism that turns that feedback into something the
maintainer sees — a GitHub issue/PR, or a digest.

Open questions (unanswered — do not assume):

- Where does the feedback land? A GitHub issue per message, a local file, a mailto, or an external service?
- Who is allowed to send it, and does it need consent/attribution?
- "Auto PR" is ambiguous: a PR against this repo (what would it change?), or an issue carrying the text?
- Does the plugin need network access for this, and what happens offline?

Cost is entirely downstream of those answers; the in-player form itself is trivial.

## Editable path in the pane header

> "顶部的这个路径我觉得可以支持编辑然后刷新 … 甚至我们可以支持用户在这个位置通过那个文件浏览器打开视频"

Two related asks:

1. **Editable path**: click the header path, type another path, Enter to load it in the same tab. Would need the Host to
   keep enforcing the session-cwd confinement (`resolveRequestedFile` already does), plus validation feedback for
   "outside the workspace" / "not a video".
2. **File browser entry**: pick a video through a file chooser right from the header, instead of only via the Files tab.

Notes:

- The protocol already accepts an arbitrary `path` query, so the Host side needs no new route; this is a client change.
- The tab's address is `dsh-resource://file/session/<id>/<path>`; changing the path in place means re-minting the tab
  address, not just swapping the `<video>` src (the address is what the sidebar restores on reopen).
- Ask first whether editing should mutate the current tab or open a new one.

## Theme / light backgrounds

> "有些人用的 deepseek 的底色比如说是白色的之类的，那我们这个可能会有点不友好"

The player chrome is hard-coded dark (`#08090a` root, translucent white-on-dark cards, `rgba(12,14,18,.9)` surfaces).
On a light DSH theme it will read as a black slab inside a white sidebar.

Not yet decided:

- Does the player follow the harness theme (a CSS custom property or a class on the host root), or carry its own
  explicit light variant?
- The video stage itself can stay dark (a dark stage is what players do); the question is the header, transport bar,
  guide card, toasts and dialogs.
- How is the current theme observable from a client plugin? Unknown — verify before designing anything.
