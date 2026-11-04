/* The base map for the 30 Day Map Challenge.
 *
 * One factory, three basemaps, and a `draw` callback that is re-run every time the basemap
 * changes — because `setStyle` discards every source and layer that was added to the old
 * one, so a day's overlay has to be rebuildable rather than built once.
 *
 * MapLibre is ~1.1 MB unminified and is imported dynamically after first paint, so the
 * page's chrome is interactive before a byte of it arrives.
 *
 * Usage:
 *
 *   import { createBaseMap } from '../../assets/basemap.mjs';
 *
 *   const base = await createBaseMap({
 *     container: 'map',
 *     center: [-73.95, 40.7],
 *     zoom: 10,
 *     draw(map, ctx) {
 *       map.addSource('thing', { type: 'geojson', data: '/days/01/thing.geo.json' });
 *       map.addLayer({ id: 'thing', type: 'circle', source: 'thing' }, ctx.beforeId);
 *     },
 *   });
 */

/* ---------------------------------------------------------------------------
   The basemaps.

   Each preset is: where the tiles come from, what the credit has to say, how far it zooms,
   and where a day's overlay is inserted into its layer stack.

   Adding a fourth is one object here plus one button in the page's `.layer-switch`.
   --------------------------------------------------------------------------- */

/* OpenFreeMap's `liberty` style, used as published.
 *
 * Not `positron`, and not a repaint of it. positron is a deliberately monochrome canvas
 * style: measured with `scripts/inspect_style.py`, it draws the whole `park` source layer
 * as `rgb(230,233,229)` — a grey — and ships no `landcover_grass`, no `landuse_pitch` and
 * no `landuse_cemetery` layer at all. So Central Park, Prospect Park and Flushing Meadows
 * are not green on it, and no paint override puts back a layer that was never in the style.
 * liberty draws `park` at `#d8e8c8` with a `park_outline`, plus grass, pitches, tracks and
 * cemeteries, which is what makes it read like a general-purpose map.
 *
 * liberty is also the style on openfreemap.org's own homepage, which is the reference the
 * owner asked for (2026-11-04).
 *
 * OpenFreeMap publishes no SLA, so `FALLBACK_STYLE` is not decoration: when this request
 * fails the day's overlay must still draw.
 */
const OPENFREEMAP = 'https://tiles.openfreemap.org/styles/liberty';

//: Esri's ArcGIS Online tiles. The keyless endpoints are widely used and ship as presets in
//: Leaflet and MapLibre provider lists, but Esri's terms govern ArcGIS Online basemaps and
//: generally contemplate an account for application use
//: (https://www.esri.com/en-us/legal/terms/full-master-agreement). Nobody here has confirmed
//: this use is licensed, so it is documented rather than assumed: docs/basemap.md §Licensing.
//: Attribution to Esri is required and is set on the source.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

//: OpenTopoMap, raster. Free for non-commercial use with attribution, under a tile usage
//: policy that forbids bulk downloading (https://opentopomap.org/about#verwendung). Style
//: CC-BY-SA 3.0; data OSM contributors (ODbL) plus SRTM elevation.
const OPENTOPO = ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`);

/* No paint overrides, and no layers removed.
 *
 * An earlier version of this file stripped liberty's road layers and repainted land, water
 * and parks into an early-2000s satnav palette, to sit beside the XP chrome. The owner's
 * verdict on 2026-11-04 was that it did not look right next to a general-purpose map, and
 * the reference given was openfreemap.org's own homepage — which is liberty, as published.
 * So the style is used as published, and the era lives in the window frame around it rather
 * than in the map.
 *
 * The chrome is the costume; the map underneath should be a map.
 */

export const BASEMAPS = {
  simple: {
    label: 'Simple',
    //: liberty's tiles go to z14 and MapLibre overzooms cleanly a few levels past that.
    maxZoom: 18,
    attribution:
      'Basemap <a href="https://openfreemap.org/" rel="noopener noreferrer">OpenFreeMap</a>, ' +
      'data &copy; <a href="https://www.openstreetmap.org/copyright" rel="noopener noreferrer">OpenStreetMap contributors</a>',
    //: Fetched rather than handed to MapLibre as a URL, and returned unchanged. Nothing in
    //: it is rewritten any more, but `createBaseMap` stamps every style it installs with a
    //: serial in `name` to tell a new style's `styledata` from the old one's, and that needs
    //: an object. The browser caches the request, so the fetch costs one round trip once.
    style: () => fetchJson(OPENFREEMAP),
    //: Above the land and roads, below the place labels — so town names draw on top of an
    //: overlay instead of under it. With a vector style this is one argument; it is the trick
    //: Esri's canvas basemaps get by shipping their labels as a second tile layer.
    overlayBefore: (style) => firstSymbolLayerId(style),
  },

  satellite: {
    label: 'Satellite',
    maxZoom: 19,
    attribution:
      'Imagery &copy; <a href="https://www.esri.com/" rel="noopener noreferrer">Esri</a>, ' +
      'Maxar, Earthstar Geographics, and the GIS User Community',
    style() {
      return {
        version: 8,
        //: Needed even for a raster basemap: a symbol layer added by a day would otherwise
        //: have no font to render with, and MapLibre discards the whole style for it.
        glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
        sources: {
          imagery: {
            type: 'raster',
            tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
            tileSize: 256,
            maxzoom: 19,
            attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
          },
          places: {
            type: 'raster',
            tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`],
            tileSize: 256,
            maxzoom: 19,
          },
        },
        layers: [
          //: Imagery with no labels is hard to navigate — you can see everything and name
          //: nothing — so Esri's reference layer goes on top, and a day's overlay between.
          { id: 'imagery', type: 'raster', source: 'imagery' },
          { id: 'places', type: 'raster', source: 'places' },
        ],
      };
    },
    overlayBefore: () => 'places',
  },

  geography: {
    label: 'Geography',
    //: OpenTopoMap's own ceiling. Past it the contours are interpolated rather than surveyed.
    maxZoom: 17,
    attribution:
      'Map data &copy; <a href="https://www.openstreetmap.org/copyright" rel="noopener noreferrer">OpenStreetMap contributors</a>, ' +
      'SRTM &middot; style <a href="https://opentopomap.org/" rel="noopener noreferrer">OpenTopoMap</a> ' +
      '(<a href="https://creativecommons.org/licenses/by-sa/3.0/" rel="noopener noreferrer">CC-BY-SA</a>)',
    style() {
      return {
        version: 8,
        glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
        sources: {
          topo: {
            type: 'raster',
            tiles: OPENTOPO,
            tileSize: 256,
            maxzoom: 17,
            attribution: 'OpenTopoMap (CC-BY-SA), data OpenStreetMap contributors + SRTM',
          },
        },
        layers: [{ id: 'topo', type: 'raster', source: 'topo' }],
      };
    },
    //: One raster layer and nothing above it, so an overlay simply goes on top. The contours
    //: underneath stay legible through a semi-transparent fill, which is the reason to pick
    //: this basemap in the first place.
    overlayBefore: () => undefined,
  },
};

export const DEFAULT_BASEMAP = 'simple';

//: Drawn when a basemap's own style could not be fetched. Flat, and deliberately not one of
//: the three palettes: a reader looking at it should be able to tell that something failed.
const FALLBACK_STYLE = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#dcdcd2' } }],
};

//: Which basemap was last chosen, so the choice survives moving between days. A failure here
//: is swallowed: private browsing throws on `localStorage` and that must not cost the map.
const STORAGE_KEY = '30dmc:basemap';

function rememberedBasemap() {
  try {
    const name = window.localStorage.getItem(STORAGE_KEY);
    return BASEMAPS[name] ? name : null;
  } catch {
    return null;
  }
}

function rememberBasemap(name) {
  try {
    window.localStorage.setItem(STORAGE_KEY, name);
  } catch {
    /* no storage, no memory. The map is unaffected. */
  }
}

/* ---------------------------------------------------------------------------
   Helpers.
   --------------------------------------------------------------------------- */

export function fetchJson(url) {
  return fetch(url).then((response) => {
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return response.json();
  });
}

/** The id of a style's first symbol layer, or undefined if it has none. */
function firstSymbolLayerId(style) {
  const label = (style.layers || []).find((layer) => layer.type === 'symbol');
  return label && label.id;
}

/** WebGL2 before MapLibre: a 1.1 MB download that can only fail is worth skipping. */
function hasWebgl2() {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

/** Resolve after first paint, so the map never delays the chrome above it. */
function afterFirstPaint() {
  return new Promise((resolve) => {
    if (document.readyState === 'complete') {
      requestAnimationFrame(() => resolve());
      return;
    }
    window.addEventListener('load', () => requestAnimationFrame(() => resolve()), { once: true });
  });
}

/* ---------------------------------------------------------------------------
   The factory.
   --------------------------------------------------------------------------- */

/**
 * Build the base map.
 *
 * @param {object} options
 * @param {string|HTMLElement} options.container  The map element, or its id.
 * @param {[number, number]} [options.center]     Starting centre, [lon, lat].
 * @param {number} [options.zoom]                 Starting zoom.
 * @param {[[number,number],[number,number]]} [options.bounds]
 *        Fit these bounds instead of using centre and zoom.
 * @param {string} [options.basemap]              Which preset to open with. Defaults to the
 *        reader's last choice, then to `simple`.
 * @param {boolean} [options.rotate=false]        Allow pitch and bearing. Off by default:
 *        tilting a thematic map helps nobody read one.
 * @param {(map: object, ctx: object) => void} [options.draw]
 *        Add the day's sources and layers. Called after every basemap load, so it MUST be
 *        idempotent-by-construction: it is always called against a fresh, empty style.
 *        `ctx.beforeId` is the insertion point that keeps place labels on top; `ctx.basemap`
 *        is the active preset name, for a day that wants to paint differently over imagery.
 * @returns {Promise<object|null>} The handle, or null if the map could not be built.
 */
export async function createBaseMap(options = {}) {
  const container =
    typeof options.container === 'string'
      ? document.getElementById(options.container)
      : options.container || document.getElementById('map');

  const status = document.getElementById('map-status');
  const say = (text) => {
    if (status) status.textContent = text;
  };

  if (!container) return null;
  if (!hasWebgl2()) {
    say('This browser has no WebGL 2, so the map cannot draw.');
    return null;
  }

  await afterFirstPaint();
  say('Loading the map…');

  let MapLibre;
  try {
    MapLibre = await import('../vendor/maplibre-gl.mjs');
  } catch (error) {
    say(`MapLibre could not load (${error.message}).`);
    return null;
  }

  let active = BASEMAPS[options.basemap] ? options.basemap : rememberedBasemap() || DEFAULT_BASEMAP;

  const loadStyle = async (name) => {
    try {
      return await BASEMAPS[name].style();
    } catch (error) {
      say(`The ${BASEMAPS[name].label.toLowerCase()} basemap did not load (${error.message}).`);
      return null;
    }
  };

  /* Which style is installed, stamped into the style's own `name`.
   *
   * `styledata` is not a reliable "the new style is ready" signal on its own: it fires
   * repeatedly as each of a style's sprites, glyphs and tiles arrive, and the previous
   * style keeps firing it for a while after `setStyle` has been called. A counter bumped
   * just before `setStyle` is therefore consumed by a late event belonging to the *old*
   * style, and the real event for the new one is then skipped — which left the satellite
   * basemap with no overlay at all and no error to show for it (measured 2026-11-04).
   *
   * Stamping the style and comparing identifies the style rather than the moment, so a
   * stale event cannot match. */
  let serial = 0;
  let wantedTag = null;
  let drawnTag = null;

  const stamp = (style) => {
    serial += 1;
    wantedTag = `30dmc-${serial}`;
    return { ...style, name: wantedTag };
  };

  const first = stamp(await loadStyle(active) || FALLBACK_STYLE);

  const map = new MapLibre.Map({
    container,
    style: first,
    center: options.center || [0, 20],
    zoom: options.zoom === undefined ? 2 : options.zoom,
    maxZoom: BASEMAPS[active].maxZoom,
    // Our own credit is rendered in `.map-attrib`, because MapLibre's control is styled by
    // the part of its stylesheet this project does not ship.
    attributionControl: false,
    pitchWithRotate: Boolean(options.rotate),
    dragRotate: Boolean(options.rotate),
    touchZoomRotate: Boolean(options.rotate),
  });

  if (options.bounds) map.fitBounds(options.bounds, { padding: 32, animate: false });

  /* `setStyle` discards everything added to the previous style, so `draw` is bound to the
     style rather than to the map: once per installed style, against a fresh empty one. */
  const runDraw = () => {
    if (!options.draw) return;
    const style = map.getStyle() || { layers: [] };
    const ctx = {
      basemap: active,
      beforeId: BASEMAPS[active].overlayBefore(style),
      library: MapLibre,
    };
    try {
      options.draw(map, ctx);
    } catch (error) {
      // Named, not swallowed: a reader who sees an empty basemap should be told whose
      // fault it is, and the basemap itself still works.
      say(`The overlay failed to draw (${error.message}).`);
    }
  };

  map.on('styledata', () => {
    const current = map.getStyle();
    // A stale event from the style being replaced: its `name` is the previous stamp.
    if (!current || current.name !== wantedTag) return;
    if (drawnTag === wantedTag) return;
    drawnTag = wantedTag;
    runDraw();
  });

  // A style that 404s or times out surfaces here rather than at `load`, so the fallback is
  // armed before the first paint instead of after a reader has stared at nothing.
  let failed = false;
  map.on('error', (event) => {
    const message = (event && event.error && event.error.message) || 'unknown error';
    // Tile-level 404s are normal at the edge of a raster pyramid and must not trip the
    // fallback; only a style, sprite or glyph failure means the basemap itself is gone.
    if (!failed && /style|sprite|glyph/i.test(message)) {
      failed = true;
      say('The basemap did not load, so the data is drawn on its own.');
      map.setStyle(stamp(FALLBACK_STYLE));
      return;
    }
    if (!failed && !/tile|Failed to fetch|403|404/i.test(message)) {
      say(`The map reported an error (${message}).`);
    }
  });

  const attrib = document.getElementById('map-attrib');
  const paintAttribution = () => {
    // innerHTML, and the only place in this project that uses it: the credit is a fixed
    // string in this file with no reader input anywhere near it, and the licences require
    // specific links. Nothing fetched is ever put through here.
    if (attrib) attrib.innerHTML = BASEMAPS[active].attribution;
  };
  paintAttribution();

  /** Switch basemaps, keeping the camera and rebuilding the day's overlay. */
  const setBasemap = async (name) => {
    if (!BASEMAPS[name] || name === active) return;
    const style = await loadStyle(name);
    if (!style) return;
    active = name;
    rememberBasemap(name);
    failed = false;
    map.setMaxZoom(BASEMAPS[name].maxZoom);
    map.setStyle(stamp(style));
    paintAttribution();
    syncSwitch();
    say(`${BASEMAPS[name].label} basemap.`);
  };

  /* The switcher. Every `[data-basemap]` button in the document drives it, so a page can put
     the control wherever it likes — or leave it out, and the map still works. */
  const buttons = [...document.querySelectorAll('[data-basemap]')];

  function syncSwitch() {
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.basemap === active));
    }
  }

  for (const button of buttons) {
    button.addEventListener('click', () => setBasemap(button.dataset.basemap));
  }
  syncSwitch();

  const zoomIn = document.getElementById('map-zoom-in');
  const zoomOut = document.getElementById('map-zoom-out');
  if (zoomIn) zoomIn.addEventListener('click', () => map.zoomIn());
  if (zoomOut) zoomOut.addEventListener('click', () => map.zoomOut());

  map.once('idle', () => {
    // Cleared rather than left saying "Loading": an empty status line hides itself, and the
    // next real event is what should put text back in it.
    if (status && /^Loading/.test(status.textContent)) say('');
  });

  return {
    map,
    library: MapLibre,
    /** The active preset's name. */
    get basemap() {
      return active;
    },
    setBasemap,
    /** Put a line in the status region. Announced, because it is `aria-live="polite"`. */
    say,
    /** Rebuild the day's overlay against the current style, without changing basemaps. */
    redraw() {
      runDraw();
    },
  };
}
