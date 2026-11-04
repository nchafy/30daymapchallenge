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
| `index.html` | The day index, in a window frame. |
| `days/00-base/` | The base map with nothing on it. Start here. |
| `days/_template/` | Copy this to start a day. |
| `assets/basemap.mjs` | `createBaseMap()`, the three basemaps, the switcher. |
| `assets/chrome.mjs` | Taskbar, Start menu, detail panel, group boxes and tables. |
| `assets/days.mjs` | The thirty themes. Set `dir` when a day gets a page. |
| `assets/xp.css` | The Luna theme. The only file that knows what decade this is. |
| `scripts/check.py` | Renders every page in Chrome and fails on a console error. |
| `docs/basemap.md` | Basemap sources, their licences, and how to write a day. |

## A day in four steps

```
cp -r days/_template days/07-ten-minute-map
```

Then replace `NN` and `THEME` in its two files, set `dir` on day 7's row in
`assets/days.mjs`, and write the overlay in `map.mjs`.

`draw(map, ctx)` is called once per basemap load, against a fresh empty style, so it can
add its sources unconditionally. State that must survive a basemap switch lives outside
it. `docs/basemap.md` has the rest, including the `styledata` trap that cost an
afternoon.

## The look

The window frame, the taskbar and the Start menu are Windows XP (Luna). The map inside
them is [OpenFreeMap](https://openfreemap.org/) `liberty`, Esri imagery, or OpenTopoMap,
each as published.

That split was a correction. The first version repainted the map itself into an
early-2000s satnav palette and stripped its roads, which read as neither one thing nor
the other and lost every park in the city. The chrome is the costume; the map underneath
should be a map.

Luna's own palette failed WCAG 2.2 AA in two places — its grey body text and the light
stop of its close box — and both are corrected in `xp.css`, with the measured ratio noted
where it was the reason for a value.

## Accessibility

Every control has a name, the basemap switcher is a real `aria-pressed` group, the status
line is a live region, and the detail panel's tables use `th[scope]` rather than a dash
between a label and its value. Targets are 24 px, which is why the title-bar boxes are
not the 21 px Luna drew.

The map needs WebGL 2. Without it the page says so rather than showing an empty box.

## Licences

MapLibre GL JS is vendored under `vendor/` (BSD-3-Clause, `vendor/LICENSE.txt`).

Basemap data is © OpenStreetMap contributors (ODbL) and others per basemap; the Esri
imagery endpoint is a commercial service whose licensing for this use is **unconfirmed**.
Read `docs/basemap.md` § Licensing before putting this anywhere public.
