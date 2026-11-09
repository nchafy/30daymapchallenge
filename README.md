# 30 Day Map Challenge 2026

Thirty maps for [the challenge](https://30daymapchallenge.com/), 1–30 November 2026,
on one shared base map wearing Windows XP.

No build step. It is static files and one vendored library.

> **The days now live in the webxp project.** The window manager this vendored became its
> own package, and the challenge moved in on top of it: the thirty days are apps under
> `apps/`, behind one `30DaysOfMaps` folder icon, and day 2 is `apps/day-02-lines/` with its
> write-up beside it. What remains here is the base map and the day template, which is where
> the shared map layer was worked out before it moved to `shared/map/`.
>
> Edit day 2 there, not here. Nothing in this repo is a second copy of it any more.

## Run it

```
python3 -m http.server 8077 --bind 127.0.0.1
```

Then <http://127.0.0.1:8077/>. The `--bind` is deliberate: nothing here is meant to be
reachable from another machine.

## What is here

Three layers. The OS does not know what a map is; the apps do not know how a window works.

| Path | What it is |
| --- | --- |
| **`os/`** | **The shell. Knows nothing about maps or days.** |
| `os/shell.mjs` | `mountShell()`. The one import a page needs. |
| `os/entries.mjs` | The whole contract: what the shell is given to show. |
| `os/desktop.mjs` | `renderDesktop()` — an icon per entry. |
| `os/taskbar.mjs` | Which windows are open, and the buttons in the bar. |
| `os/menu.mjs` | The Start menu. |
| `os/panel.mjs` | The detail panel, plus `group()` and `table()`. |
| `os/theme.css` | The Luna theme. The only file that knows what decade this is. |
| `os/desktop.css` | The wallpaper and the icon grid. |
| `os/conformance.html` | A fixture standing in for a host that is not this site. |
| **`lib/`** | **Libraries an app uses.** |
| `lib/basemap.mjs` | `createBaseMap()`, the three basemaps, the switcher. |
| **this site** | **The only files that know both halves.** |
| `apps.mjs` | Turns `days/themes.mjs` into OS entries. |
| `boot-desktop.mjs` | The desktop page's three lines. |
| `index.html` | The desktop. One icon per day; opening one puts it in the taskbar. |
| `days/themes.mjs` | The thirty themes. Set `dir` when a day gets a page. |
| `days/00-base/` | The base map with nothing on it. Start here. |
| — | Day 2 moved to the webxp project, as `apps/day-02-lines/`. Its write-up moved with it. |
| `days/_template/` | Copy this to start a day. |
| `scripts/check.py` | Renders every page in Chrome and fails on a console error. |
| `scripts/zoom_icon.py` | Captures the desktop icons at 8x, for judging 32 px art. |
| `scripts/measure_csp.py` | Measures whether icon art survives a strict Content-Security-Policy. |
| `scripts/measure_wallpaper.py` | Measures the wallpaper drawn and removed, to set `check.py`'s threshold from data. |
| `docs/basemap.md` | Basemap sources, their licences, and how to write a day. |

## A day in four steps

```
cp -r days/_template days/07-ten-minute-map
```

Then, in its two files, replace `NN` and `THEME` with the day and its theme, and
`NN-THEME-SLUG` with the folder name — `07-ten-minute-map`. Set `dir` to the same folder
name on day 7's row in `days/themes.mjs`, and write the overlay in `map.mjs`.

Those two have to agree. `dir` is what turns the desktop icon into a link; the `here`
passed to `mountShell` is what registers the window in the taskbar, and a `here` that is
not a `dir` in `days.mjs` is dropped, so the page gets no taskbar button and
`scripts/check.py` fails without saying why.

`draw(map, ctx)` is called once per basemap load, against a fresh empty style, so it can
add its sources unconditionally. State that must survive a basemap switch lives outside
it. `docs/basemap.md` has the rest, including the `styledata` trap that cost an
afternoon.

## The OS, and the things that run in it

`os/` is a Windows-like shell: a desktop of icons, a taskbar of open windows, a Start
menu, a window frame with a working close box, a sliding detail panel, a tray clock. It
has no idea what any of them contain.

A host hands it entries and nothing else:

```js
import { mountShell, renderDesktop } from './os/shell.mjs';

const APPS = [
  { id: 'trees', label: 'Street trees', href: '/trees/', kind: 'map', badge: '01' },
  { id: 'soon',  label: 'Not built yet' },           // no href: greyed, not a target
];

mountShell({ here: 'trees', entries: APPS, menu: APPS });
renderDesktop(document.getElementById('icons'), APPS);
```

Every piece is opt-in, and that is load-bearing rather than tidy:

- No `entries`, and **the taskbar is not touched**. A host that server-renders its own bar
  — so that its navigation works with no JavaScript — keeps its markup.
- No `menu`, and the Start menu is not wired, so no catalogue is imported and no file has
  to exist for the import graph to resolve.
- No `#clock` or `#detail` in the markup, and you simply do not get those.

An earlier version of this got all three wrong. `os/shell.mjs` imported this project's day
catalogue, built `/days/<dir>/` URLs by hand in three separate modules, and called
`renderTaskbar` unconditionally — which, because the open-window list was filtered against
that same catalogue, silently emptied the taskbar of any site that was not this one. "I
have no windows to show" and "I was not asked to manage this bar" are different states.

### Icon art, and a Content-Security-Policy

`kind` is cheap: `os/desktop.css` draws the art as a `data:image/svg+xml` background, so
thirty-one icons cost no requests.

It does not survive a strict CSP. `img-src` governs images loaded from CSS, not only from
markup, so under `img-src 'self'` with no `data:` the icons go blank — and the element is
present with a *correct* computed `background-image`, which is what makes it expensive to
diagnose. Measured by `scripts/measure_csp.py`: 0 pixels painted.

**Do not rely on the console to tell you.** Against this repo's fixture — a `<meta>` policy
with `default-src 'self'` — Chrome logs `Loading the image 'data:image/svg+xml,…' violates
the following Content Security Policy directive: "img-src 'self'"`. Another consumer of
this shell measured the same blank icon with **no** `Log.entryAdded` and no
`Runtime.consoleAPICalled` at all, under a header-delivered `default-src 'none'; img-src
'self'`. Both measurements stand; which factor causes the difference is not established.
So: blank always, silent under some policies.

So an entry may bring its own art instead:

```js
{ id: 'trees', label: 'Street trees', href: '/trees/', icon: () => buildSvgNode() }
```

A **Node**, or a function returning one — never a markup string. Nothing in this shell
reaches the page as markup, and an `<svg>` string from a host would be an injection vector
wearing a convenience API. A host holding a string can parse it itself and own that call.
`renderDesktop` puts the node in the art slot and sets `data-art="node"`, which is what
tells the stylesheet to paint nothing behind it.

### Everything above is a check

Not an intention:

- `check_os_independent` reads every module under `os/` and fails on an import that leaves
  the directory. Static, because an import that only fires on one page would otherwise
  pass every run until someone visited that page.
- `os/conformance.html` is a fixture standing in for a foreign host: it server-renders two
  taskbar buttons, calls `mountShell()` with no entries, and the harness requires both
  buttons to survive.
- `os/conformance-csp.html` sets `img-src 'self'` and draws one icon each way. The harness
  requires the node one to paint, and only prints what the stylesheet one did — pinning
  that to zero would be a check that the limitation still exists, and if the art is ever
  made policy-safe the right outcome is a passing run.

Each of the three was confirmed to fail when its defect was reintroduced.

## The look

An early-2000s car satnav in a Windows XP window, on an XP desktop.

The index is a desktop: 31 icons in columns that fill top-to-bottom, a numbered map-sheet
icon per day, and the days with no page yet greyed rather than hidden. Opening one puts a
button in the taskbar, and the button stays there while you open another — the list of
open windows lives in `localStorage`, because each day is a separate page and a navigation
throws every variable away. The close box on a window button, and the one on a window's
own title bar, both really close it.

One deliberate departure: an icon opens on a single activation, not a double click. A
target needing a double click is unreachable by keyboard and awkward on touch, so each
icon is a plain link.

**The wallpaper is not Bliss.** Bliss is a photograph owned by Microsoft, taken by Charles
O'Rear in 1996, and it is not licensed for redistribution — so it is not in this repo. The
desktop draws a CSS stand-in in the same place: a sky gradient, three soft clouds, and an
elliptical green hill. `scripts/check.py` counts sky and hill pixels, because a CSS
gradient that stops drawing produces no failed request and nothing in the console.

The frame, the taskbar and the Start menu are Luna. The `simple` basemap is
[OpenFreeMap](https://openfreemap.org/) `liberty` with a paint-only satnav palette over
it — flat olive land, deep navy water, bright yellow arterials — and no layer removed,
because a GPS screen was mostly roads. `satellite` is Esri imagery and `geography` is
OpenTopoMap, both as published.

Those screens also leaned. **Tilt** eases the camera to a bird's-eye, the compass turns
the heading and resets to north, and the 3D buildings appear *only* from an angle: at
pitch 0 you look straight down the top of each block and an extrusion reads as a smeared
blob beside its own footprint.

Luna's own palette failed WCAG 2.2 AA in two places — its grey body text and the light
stop of its close box — and both are corrected in `xp.css`, with the measured ratio noted
where it was the reason for a value. Navy water broke liberty's water labels the same way,
and those are re-coloured in `basemap.mjs`.

## Accessibility

Every control has a name, the basemap switcher and Tilt are real `aria-pressed` controls,
the status line is a live region, and the detail panel's tables use `th[scope]` rather
than a dash between a label and its value. Targets are 24 px, which is why the title-bar
boxes are not the 21 px Luna drew.

Every camera gesture is a drag, so the compass carries a keyboard path: focus it and the
arrow keys turn the view 15° at a time. Its accessible name carries the live bearing,
because the needle itself is `aria-hidden`.

The map needs WebGL 2. Without it the page says so rather than showing an empty box.

## Licences

MapLibre GL JS is vendored under `vendor/` (BSD-3-Clause, `vendor/LICENSE.txt`).

Basemap data is © OpenStreetMap contributors (ODbL) and others per basemap; the Esri
imagery endpoint is a commercial service whose licensing for this use is **unconfirmed**.
Read `docs/basemap.md` § Licensing before putting this anywhere public.
