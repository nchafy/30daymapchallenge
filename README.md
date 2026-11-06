# 30 Day Map Challenge 2026

Thirty maps for [the challenge](https://30daymapchallenge.com/), 1–30 November 2026,
on one shared base map wearing Windows XP.

No build step. It is static files and one vendored library.

## Run it

```
python3 -m http.server 8077 --bind 127.0.0.1
```

Then <http://127.0.0.1:8077/>. The `--bind` is deliberate: nothing here is meant to be
reachable from another machine.

## What is here

| Path | What it is |
| --- | --- |
| `index.html` | The desktop. One icon per day; opening one puts it in the taskbar. |
| `assets/taskbar.mjs` | Which days are open, and the window buttons in the bar. |
| `days/00-base/` | The base map with nothing on it. Start here. |
| `days/02-lines/` | Day 2. How much of a GPS trace is noise. `docs/gps-noise.md`. |
| `days/_template/` | Copy this to start a day. |
| `assets/basemap.mjs` | `createBaseMap()`, the three basemaps, the switcher. |
| `assets/chrome.mjs` | Taskbar, Start menu, detail panel, group boxes and tables. |
| `assets/days.mjs` | The thirty themes. Set `dir` when a day gets a page. |
| `assets/xp.css` | The Luna theme. The only file that knows what decade this is. |
| `scripts/check.py` | Renders every page in Chrome and fails on a console error. |
| `scripts/zoom_icon.py` | Captures the desktop icons at 8x, for judging 32 px art. |
| `scripts/measure_wallpaper.py` | Measures the wallpaper drawn and removed, to set `check.py`'s threshold from data. |
| `docs/basemap.md` | Basemap sources, their licences, and how to write a day. |
| `docs/gps-noise.md` | Day 2's method, what was verified against what, and the privacy rules for a Strava export. |

## A day in four steps

```
cp -r days/_template days/07-ten-minute-map
```

Then, in its two files, replace `NN` and `THEME` with the day and its theme, and
`NN-THEME-SLUG` with the folder name — `07-ten-minute-map`. Set `dir` to the same folder
name on day 7's row in `assets/days.mjs`, and write the overlay in `map.mjs`.

Those two have to agree. `dir` is what turns the desktop icon into a link; the `here`
passed to `mountChrome` is what registers the window in the taskbar, and a `here` that is
not a `dir` in `days.mjs` is dropped, so the page gets no taskbar button and
`scripts/check.py` fails without saying why.

`draw(map, ctx)` is called once per basemap load, against a fresh empty style, so it can
add its sources unconditionally. State that must survive a basemap switch lives outside
it. `docs/basemap.md` has the rest, including the `styledata` trap that cost an
afternoon.

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
