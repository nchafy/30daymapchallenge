# 30daymapchallenge

Thirty maps for the 30 Day Map Challenge, November 2026, on one shared base map.
Static files and one vendored library. No build step.

General coding rules live outside this repo, in `~/.claude/rules/`:
`code-design.md`, `verification.md`, `adversarial-review.md` and
`authoring-style.md`. This file is the project's own aesthetic and invariants,
which `code-design.md` requires each project to record.

## Run and check

```
python3 -m http.server 8077 --bind 127.0.0.1     # serve
.venv/bin/python scripts/check.py                # render in Chrome, fail on console error
```

The check needs `python3 -m venv .venv && .venv/bin/pip install websocket-client`.
Nothing the site serves needs Python.

## The aesthetic, and the split that holds it

**An early-2000s car satnav inside a Windows XP window.** The split is
load-bearing and MUST hold:

- **The chrome is Luna.** Window frame, title bar, taskbar, Start menu, cards,
  group boxes, bevels. It lives in `assets/xp.css` and nowhere else.
- **The map is a satnav.** Flat olive land, deep navy water, bright yellow
  arterials. It lives in `SATNAV` in `assets/basemap.mjs` and nowhere else.
- Neither theme may leak into the other. A map colour MUST NOT appear in the
  chrome; a Luna colour MUST NOT appear in the map.

Colours MUST come from the CSS custom properties at the top of `xp.css`, or from
`SATNAV`. A new value MUST be justified where it is introduced.

Luna's own palette fails WCAG 2.2 AA in two places — its grey body text and the
light stop of its close box — and both are corrected. Ratios are noted where they
were the reason for a value. A colour change MUST re-check what sits on it: navy
water once dropped liberty's water labels to about 1.5:1.

## Single sources of truth

| Fact | Its one definition |
| --- | --- |
| The thirty themes, and which have pages | `assets/days.mjs` |
| The three basemaps, their zoom caps and credits | `BASEMAPS` in `assets/basemap.mjs` |
| The satnav palette | `SATNAV` in `assets/basemap.mjs` |
| Luna's colours, bevels and control shapes | `:root` in `assets/xp.css` |
| The day index rows | `renderDayList` in `assets/chrome.mjs` |

The Start menu and the index page render the same list through the same function.
Two renderers of one list is how they drift, so a third call site MUST reuse it.

## Invariants that will bite

These were each a real bug. Changing them needs a reason, not a tidy-up.

- **`draw` runs once per basemap, not once per page.** `setStyle` discards every
  source and layer added to the previous style, so `draw(map, ctx)` is called
  again after each basemap change, always against a clean slate. It needs no
  "already added?" guard. State that must survive a switch lives *outside* it and
  is read back in.
- **Styles are stamped, not counted.** `styledata` fires repeatedly as sprites,
  glyphs and tiles arrive, and the *previous* style keeps firing it after
  `setStyle`. A counter bumped before `setStyle` gets consumed by a late event
  from the old style and the real one is skipped — which left satellite with no
  overlay and no error. `createBaseMap` writes a serial into the style's `name`
  and compares identity. MUST NOT be replaced by a flag or a timer.
- **`.window-body > .map` is specificity, not tidiness.** MapLibre puts
  `maplibregl-map` on the container and sets `position: relative`. A bare `.map`
  ties on specificity and loses on source order, `inset: 0` stops applying, and
  the container collapses to 0 px — every tile fetches 200 and draws nowhere.
- **The pitch gate reads the camera, never a button.** `building-3d` shows at
  ≥12° and hides below 8°. Two thresholds, because one cutoff strobes while a
  drag-pitch sits on it. Extrusion layers are found by
  `type === 'fill-extrusion'`, not by name. The gate is re-asserted after every
  style load.
- **The compass rose rotates by `-bearing`.** MapLibre's bearing is the direction
  that is up the screen. Rotated the other way the needle looks plausible and
  points at the wrong quarter of the sky.
- **Attribution lives in the status bar, outside the map.** It is a licence term
  for all three sources. Floated over the canvas at bottom-right it sat under the
  detail panel, which docks there one layer above, so the credit vanished whenever
  anything was selected. A sibling of the map cannot be covered and has no
  stacking order to get wrong. MUST NOT be moved back over the canvas, hidden,
  truncated at any viewport, or made dismissable.
- **Overlays go at `ctx.beforeId`.** That keeps place labels above the data. A
  layer added without it sits on top of every name on the map.
- **Nothing reaches the page as markup.** Panel and index content is built with
  DOM calls and `textContent`. The one `innerHTML` is the attribution string in
  `basemap.mjs`, a fixed literal the licences require links in.
- **Floating chrome stacks in `.overlays`, not at computed offsets.** A
  hand-computed `bottom` broke the moment the compass made the control stack
  taller.

## Settled — do not relitigate

- **`simple` is OpenFreeMap `liberty`, not `positron`.** positron draws the whole
  `park` source layer grey and ships no grass, pitch or cemetery layer, so the
  big city parks are invisible on it and no override can restore a layer that
  was never there. Re-measure with `scripts/inspect_style.py` before doubting
  this.
- **The palette is saturated, and removes no layer.** Muting it and stripping the
  roads were both tried. Muting read as pale; stripping the roads lost the look,
  because a GPS screen was mostly roads.
- **Vendored MapLibre is committed.** 1.1 MB buys a clone that serves with no
  build step.

A day needing a quiet backdrop uses `geography`, or passes `tilt: false`. It does
not mute the palette.

## Writing a day

1. `cp -r days/_template days/07-ten-minute-map`
2. Replace `NN` and `THEME` in both files.
3. Set `dir` on that day's row in `assets/days.mjs`.
4. Write the overlay in `map.mjs`.

`docs/basemap.md` carries the basemap sources, their licences, and what
`scripts/check.py` asserts.
