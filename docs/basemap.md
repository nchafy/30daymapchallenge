# The base map

Three basemaps, one shell, and a `draw` callback. Everything a day needs is in
`lib/basemap.mjs`; the era is in `vendor/webxp/theme.css` and
nowhere else.

## The three basemaps

| Name | Source | Max zoom | Licence |
| --- | --- | --- | --- |
| `simple` | [OpenFreeMap](https://openfreemap.org/) `liberty`, vector | 18 | Data ODbL, [OSM contributors](https://www.openstreetmap.org/copyright) |
| `satellite` | [Esri](https://www.esri.com/) ArcGIS Online `World_Imagery` + `World_Boundaries_and_Places`, raster | 19 | Esri terms — see Licensing |
| `geography` | [OpenTopoMap](https://opentopomap.org/), raster | 17 | Style [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), data ODbL + SRTM |

Adding a fourth is one object in `BASEMAPS` plus one button in the page's
`.layer-switch`. The object needs a `label`, a `maxZoom`, an `attribution`, a
`style()` returning a style object or a promise of one, and an `overlayBefore(style)`
returning the layer id a day's overlay is inserted before.

The reader's choice is remembered in `localStorage` under `30dmc:basemap`, so it
survives moving between days. A page MAY force one with `basemap: 'satellite'`.

## The camera: tilt, 3D and the compass

The `simple` basemap is an early-2000s car satnav, and those had two things a web map
usually does not: a bird's-eye lean and a heading you could turn.

- **Tilt** is on by default. Drag with ctrl held (or the right button), two-finger
  drag on touch, or press **Tilt**, which eases between pitch 0 and 55. A day that must
  stay flat and north-up passes `tilt: false`, which also hides the Tilt button and the
  compass — a compass that indicates something you cannot change is furniture.
- **Rotate** is the same gesture set, plus the compass: pressing it faces north, and the
  arrow keys turn the view 15° while it has focus. That keyboard path is the only
  rotation a keyboard can reach, since every other route is a drag.
- **3D buildings appear only from an angle.** liberty draws `building-3d` as a
  `fill-extrusion` from zoom 14. Seen at pitch 0 you are looking straight down the top of
  each block: the walls collapse and it reads as a smeared grey shape offset from its own
  footprint. So the extrusion layers are gated on camera pitch — visible at 12° and above,
  hidden below 8°. Two thresholds and not one, because a single cutoff makes the buildings
  strobe while a drag-pitch sits on it.

The gate is driven by the camera, never by the button: pressing **Tilt** and dragging to
the same angle give the same result by construction. It is re-asserted after every style
load, because `setStyle` brings a fresh style's layers back visible.

The extrusion layers are found by `type === 'fill-extrusion'` rather than by name, so a
basemap shipping more than one is covered. The flat `building` fill underneath is left
alone — in 3D the extrusions cover their own footprints, and toggling both would flicker
two layers instead of one.

### Why `liberty` and not `positron`

`positron` was the first choice and was wrong. Measured with
`scripts/inspect_style.py positron liberty`:

- positron draws the whole `park` source layer as `rgb(230, 233, 229)` — a grey.
- positron ships no `landcover_grass`, no `landuse_pitch`, no `landuse_cemetery`
  and no `park_outline` layer at all.
- Its `landcover_wood` starts at `minzoom: 10` and fades in across zoom 8–12.

So Central Park, Prospect Park and Flushing Meadows were not green on it, and no
paint override can put back a layer that was never in the style. positron is a
deliberately monochrome canvas style; it is the right basemap for a choropleth and
the wrong one for a general-purpose map.

`scripts/check.py` asserts that all three parks render green space, so this cannot
regress quietly.

### The satnav palette

`simple` is liberty with a paint-only override, `SATNAV` in `lib/basemap.mjs`: flat
olive land, deep navy water, arterials in a yellow that carries at arm's length. Every
key in it is a layer id measured out of liberty with `scripts/inspect_style.py` —
positron's ids are different, which is why a palette written against positron silently
did nothing here.

This took three passes, and the two failures are worth recording:

1. **Repainting positron, with its roads stripped.** Lost every park in the city, because
   positron has no park colour to override, and lost the look it was imitating, because a
   GPS screen was mostly roads.
2. **Muting the palette** to keep a data overlay readable. The verdict was that it had
   gone pale (2026-11-04). These screens were read at a glance in daylight through a
   windscreen; nothing on them was subtle.

So the palette is saturated, and no layer is removed. A day whose data needs a quiet
backdrop should pick `geography`, or empty `SATNAV`.

Navy water broke liberty's own water labels — `#495e91` on `#1b4b8f` measures about
1.5:1 — so `water_name_*` and `waterway_line_label` are re-coloured to light text on a
dark halo, about 12:1. A palette change that breaks a label is not finished.

## Licensing

Two of the three need reading before this goes anywhere public.

- **OpenFreeMap** publishes no SLA and asks for no key. It is free for any use with
  attribution. Because there is no SLA, `basemap.mjs` carries a `FALLBACK_STYLE`: when
  the style request fails the day's overlay still draws, on a flat background, and the
  status line says so.
- **Esri ArcGIS Online** is a commercial service. The keyless tile endpoints are widely
  used and ship as presets in Leaflet and MapLibre provider lists, but Esri's terms
  govern ArcGIS Online basemaps and generally contemplate an account for application
  use ([master agreement](https://www.esri.com/en-us/legal/terms/full-master-agreement)).
  **Nobody here has confirmed this use is licensed.** It is documented rather than
  assumed. Attribution to Esri is required and is set on the source and in the credit.
- **OpenTopoMap** is free for non-commercial use with attribution, under a tile usage
  policy that forbids bulk downloading
  ([usage](https://opentopomap.org/about#verwendung)). Panning a map is not bulk
  downloading; a scripted sweep of a city at zoom 17 would be.

Attribution is rendered by `basemap.mjs` into `.map-attrib`, not by MapLibre's own
control, and `.map-attrib` lives in the window's **status bar** — outside the map, as a
sibling of it rather than a layer over it.

That placement is the whole point. It used to float over the canvas at `bottom: 0;
right: 0; z-index: 4`, which is exactly where the detail panel docks at `z-index: 5`:
the credit disappeared the moment anything was selected, on every viewport, and nothing
caught it for a day. A status bar cannot be covered at any size and has no stacking order
to get wrong — and an XP window had one anyway.

`scripts/check.py` now asserts this with `elementFromPoint` at three points across the
strip, with the panel both shut and open. That question — "what would the reader's cursor
actually hit here?" — is the one a `visibility` or `z-index` comparison does not answer.

## Writing a day

The days moved to the webxp project; write one there, following `apps/day-02-lines/`.
To add one here anyway:

1. `cp -r days/_template days/07-ten-minute-map`
2. Replace `NN` and `THEME` in `program.mjs`.
3. Set `dir: '07-ten-minute-map'` on day 7's row in `days/themes.mjs`. Until you do,
   the index renders that day as plain text rather than a dead link.
4. Register it in `programs.mjs` and write the overlay's `draw`.

### `draw` is called once per basemap, not once per page

`map.setStyle()` discards every source and layer added to the previous style. So
`draw(map, ctx)` is called again after each basemap change, always against a fresh and
empty style — it may add its sources unconditionally and needs no "already added?"
guard.

Anything that has to survive a switch — a selection, a filter, a clicked point — lives
in a variable outside `draw` and is read back in. `days/00-base/map.mjs` does exactly
this with its clicked point, and that is the case `scripts/check.py` exercises.

`ctx.beforeId` is the insertion point that keeps place labels above the overlay.
`ctx.basemap` is the active preset's name, for a day that wants to paint differently
over imagery — the base map's own click ring switches its outline to white on
`satellite`, where a dark line disappears.

### The one subtlety worth knowing

`styledata` is not a reliable "the new style is ready" signal. It fires repeatedly as a
style's sprites, glyphs and tiles arrive, and the *previous* style keeps firing it for a
while after `setStyle` has been called. A counter bumped just before `setStyle` gets
consumed by a late event belonging to the old style, and the real event for the new one
is then skipped — which left the satellite basemap with no overlay at all and no error
to show for it. `createBaseMap` therefore stamps every style it installs with a serial in
the style's `name` and compares, which identifies the style rather than the moment.

## Checking it

```
.venv/bin/python scripts/check.py
```

Loads every page in the Chrome already on the machine, screenshots each at 500 px and
1280 px into `screenshots/`, and fails on a console error. What it asserts:

- the index lists 31 rows (the base map plus thirty days);
- the map container is larger than 200 px square — a collapsed container fetches every
  tile, reports the style loaded and draws nothing, which is what MapLibre's own
  `position: relative` did to `.map` until `lib/map.css` started winning on specificity;
- each basemap's button really switches it, and the choice survives a reload;
- the day's overlay layers exist after every switch, and the clicked point is still
  rendered — the `draw`-not-re-run regression;
- Central Park, Prospect Park and Flushing Meadows all render green space;
- `building-3d` is `none` at pitch 0 and `visible` at pitch 55, through the Tilt button,
  and survives a basemap round trip while still pitched;
- the compass rose is rotated by `-bearing` (a needle rotated the other way looks
  plausible and points at the wrong quarter of the sky), pressing it returns the bearing
  to 0, and ArrowRight on the focused compass turns the view;
- the basemap credit is on screen and nothing is on top of it, panel open and shut;
- clicking the map opens the panel with four rows in it.

It also refuses to start when something else is already listening on its port. That is
not politeness: `http.server` exits immediately when the port is taken, the readiness
probe then succeeds against whatever *was* listening, and the run silently measures
another checkout. It happened — a server left over from a second worktree made a real fix
look broken and a deliberately reintroduced bug look caught, in the same session. The
probe binds with `SO_REUSEADDR`, which clears a harmless `TIME_WAIT` socket from the
previous run but still refuses a live listener.

A harness MUST fail when it cannot test the thing it was pointed at. Silence there costs
more than the bug it was hiding.

`scripts/cdp.py` is copied from the author's Show Up NYC project. It drives the system
Chrome over the DevTools Protocol, because a check harness that installs its own browser
is a bigger dependency than the site it checks. Its one requirement:

```
python3 -m venv .venv && .venv/bin/pip install websocket-client
```

Nothing the site itself serves needs Python, a venv, or a build step.
