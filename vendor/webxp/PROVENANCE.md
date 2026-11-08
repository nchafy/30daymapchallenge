# webxp, vendored

The Windows XP shell and its window manager. This directory is `src/` from the `webxp`
repository, copied verbatim.

| | |
| --- | --- |
| Commit | `fb0aa4753f4a9310ec98991acdc8aee455b726fa` |
| Subject | `fix seven defects found by review` |
| Branch | `main` |
| Source | `~/claude/webxp` — **local only, no remote** |
| Copied | 2026-11-07 |

## Why vendored rather than referenced

That repository has no remote, so there is no URL to pin against and no submodule to add.
A relative path out of this repository would break the moment anyone cloned this one on its
own. Vendoring is the same bargain the project already takes with MapLibre: a clone serves
with no build step and no network.

The files here MUST NOT be edited. A change belongs upstream, after which this directory is
re-copied and the commit above updated. Local edits would make the sha a lie, and the sha is
the only thing saying what this code is.

## What came across

`src/` only. The upstream `demo/`, `docs/`, `scripts/` and `index.html` are that project's
own harness and examples; this repository has its own.

Three stylesheets, because they have three subjects — `theme.css` is the Luna palette and
controls, `shell.css` is the desktop and taskbar, `window.css` is the frame. Upstream's
`docs/windows.md` carries the window model and its deliberate departures from XP, including
the measured contrast corrections; it is worth reading before changing anything that sits in
a window.
