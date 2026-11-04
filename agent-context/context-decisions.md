# Decisions

Questions that came up during design, with the answer that was chosen. Re-open only with new evidence.

## "Do we depend on another sidebar plugin?"

No. The first implementation adapted to `dsh-better-sidebar` (registered a file viewer there). That was dropped: the
plugin now owns a tab type, so it works with or without any other sidebar plugin, and the other plugin's file tree
defers to the registry ranking on its own.

## "Can we just raise our priority to take over?"

Not through the priorities we already set. Those live inside two *containers* (the native document preview's renderer
list, another plugin's viewer list). The address auction happens one level above, in `sidebarRightTabs.candidates()`:
band → pattern length → registration order. Winning there required registering a tab type of our own with longer,
video-only globs. That is what ships.

## "Player memory (resume position, rate)?"

Rejected: the videos in question are short clips watched start to finish, so the extra state bought nothing.

## "Should the UI keep a zoom chip, a transport badge and a file-info line?"

No. All three were removed; the stage stays clean and only the transport bar remains (auto-hides while idle).

## "Where does the icon come from?"

Recreated, not copied. The silhouette follows QuickTime Player's mark (measured off a reference image); the colourway
is ours. `scripts/make-icon.mjs` regenerates it in violet, teal, amber or rose. Apple's original artwork is
copyrighted and is deliberately not in the package.

## "Which name?"

`QuickTime Player` is used for the guide card because that is what was asked for. It is Apple's trademark, so
renaming is worth considering if the package is ever promoted publicly; the icon is already ours.
