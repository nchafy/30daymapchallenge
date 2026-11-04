# The base map

Three basemaps, one shell, and a `draw` callback. Everything a day needs is in
`assets/basemap.mjs` and `assets/chrome.mjs`; the era is in `assets/xp.css` and
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

An earlier version also stripped liberty's road layers and repainted land, water and
parks into an early-2000s satnav palette, to match the XP chrome. The owner's verdict
(2026-11-04) was that it did not look right, with
[openfreemap.org](https://openfreemap.org/) — which is `liberty`, as published — given
as the reference. The style is now used unmodified.

**The chrome is the costume. The map underneath should be a map.**

`scripts/check.py` asserts that all three parks render green space, so this cannot
regress quietly.

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

Attribution is rendered by `basemap.mjs` into `#map-attrib`, not by MapLibre's own
control. It is a licence term, so the stylesheet gives it the highest `z-index` in the
window and nothing is allowed to cover it — including the detail panel on a phone.

## Writing a day

1. `cp -r days/_template days/07-ten-minute-map`
2. Replace `NN` and `THEME` in `index.html` (four places) and `map.mjs` (two).
3. Set `dir: '07-ten-minute-map'` on day 7's row in `assets/days.mjs`. Until you do,
   the index renders that day as plain text rather than a dead link.
4. Write the overlay in `map.mjs`.

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
  `position: relative` did to `.map` until `xp.css` started winning on specificity;
- each basemap's button really switches it, and the choice survives a reload;
- the day's overlay layers exist after every switch, and the clicked point is still
  rendered — the `draw`-not-re-run regression;
- Central Park, Prospect Park and Flushing Meadows all render green space;
- clicking the map opens the panel with four rows in it.

`scripts/cdp.py` is copied from the author's Show Up NYC project. It drives the system
Chrome over the DevTools Protocol, because a check harness that installs its own browser
is a bigger dependency than the site it checks. Its one requirement:

```
python3 -m venv .venv && .venv/bin/pip install websocket-client
```

Nothing the site itself serves needs Python, a venv, or a build step.
