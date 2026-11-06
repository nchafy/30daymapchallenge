/* Day 02 — Lines.
 *
 * Every run is drawn twice: as the watch recorded it, and snapped to the OSM network. The
 * recording is longer, because receiver jitter is indistinguishable from movement and
 * gets counted as distance covered.
 *
 * The slider is the argument. It simplifies one recorded trace at a tolerance the reader
 * chooses, and the distance falls as the wobble comes out. There is no setting at which
 * the number is right — that is the point. A run has no single length, only a length at a
 * stated resolution, which is the coastline paradox
 * (https://doi.org/10.1126/science.156.3775.636) happening on a 10 km run.
 *
 * ## Why there are two resolutions
 *
 * A real history is 400-odd activities and over a million points. Handing a browser all
 * of it is 35 MB, and re-simplifying all of it per frame is seconds per frame. So:
 *
 * - `overview.json` holds every run simplified to a stated floor. It draws the map, and
 *   the floor is printed in the interface rather than hidden.
 * - A single run's full-resolution document is fetched when the reader selects it. That is
 *   the only geometry the slider ever touches, so the slider is exact and continuous.
 * - The aggregate distances come from `index.json`, which `prepare.py` computed at full
 *   resolution. The headline figures are never the simplified ones.
 *
 * `draw` is re-run against a fresh style on every basemap change, so it adds its sources
 * unconditionally. The tolerance and the selection live outside it and are read back in.
 */

import { createBaseMap } from '../../assets/basemap.mjs';
import { mountChrome, group } from '../../assets/chrome.mjs';
import { project, simplifyMask, simplifiedCoords, planeLength, ladder } from './geo.mjs';

const { panel } = mountChrome({ here: '02-lines' });

//: Every run, simplified. The map's backdrop.
const ALL = 'all';
//: The selected run, at full resolution, re-simplified live by the slider.
const FOCUS = 'focus';
//: Every run snapped to the network.
const MATCHED = 'matched';
//: A wide transparent line carrying the clicks. The drawn trace is 2 px, which is right
//: for a jittery line and wrong as a target: MapLibre hit-tests the rendered geometry, so
//: a 2 px line asks for pixel-exact aim.
const HIT = 'all-hit';

//: A hot magenta and a cyan, chosen against the satnav palette rather than from it. The
//: base map's own tokens are olive, navy and yellow, and an overlay in any of them reads
//: as part of the road network. Both carry over imagery, where the era's navy vanishes.
const INK_RECORDED = '#ff2e88';
const INK_MATCHED = '#39d0ff';
const CASING = 'rgba(8, 14, 32, 0.75)';

//: Line widths, in one place because they only work as a set. The snapped line has to be
//: wider than the recorded line's casing, not merely under it: at 3 px beneath a 2 px
//: trace with a 5 px casing it was covered completely, and the key named a cyan line that
//: was nowhere on the map.
const WIDTH = {
  focusCasing: 4,
  focus: 2,
  hit: 16,
};

/* Widths that follow the zoom, for the layers that draw every run at once.
 *
 * A fixed 8 px snapped line is right when you are looking at one run and far too heavy
 * when four hundred of them overlap: at city zoom the whole history merges into one cyan
 * mass and the recorded traces on top of it vanish. Interpolating keeps the overview
 * readable without making a single selected run look like a hairline.
 *
 * The stops are zoom 9 (a metropolitan area, where runs overlap) to zoom 15 (a few
 * streets, where they do not). */
function byZoom(wide, narrow) {
  return ['interpolate', ['linear'], ['zoom'], 9, narrow, 15, wide];
}

const ZOOM_WIDTH = {
  matchedCasing: byZoom(11, 2.4),
  matched: byZoom(8, 1.2),
  allCasing: byZoom(3, 1.4),
  all: byZoom(1.4, 0.7),
};

//: Opacity of a run that is not the selected one. One constant, because `draw` and the
//: click handler both build the expression and two numbers meant that switching basemap
//: with a run selected un-dimmed the rest.
const DIM = 0.3;
const FULL = 1;

//: Mirrors `gpsnoise.TOLERANCES_M`. Only used to cross-check this module's arithmetic
//: against the ladder `prepare.py` wrote; the slider is continuous and uses neither.
const LADDER_TOLERANCES = [0, 0.5, 1, 2, 3, 5, 8, 12, 20, 35, 60, 100];

//: Where the data might be, most private first. `private/` is what `prepare.py` writes by
//: default and is gitignored; `data/` holds the committed synthetic fixture, so this page
//: renders for someone with no Strava export.
const DATA_DIRS = ['./private', './data'];

const statusEl = document.getElementById('map-status');
const slider = document.getElementById('tolerance');
const sliderOut = document.getElementById('tolerance-out');
const readoutEl = document.getElementById('readout');
const matchedToggle = document.getElementById('toggle-matched');
const keyRecordedEl = document.getElementById('key-recorded');
const aggregateEl = document.getElementById('aggregate');
const clearButton = document.getElementById('clear-selection');

//: State that has to survive a basemap switch.
let tolerance = 0;
let showMatched = true;

let dataDir = null;
let summary = null;
let overview = null;
/** @type {{id: string, doc: object, projected: object}|null} */
let focus = null;

const docCache = new Map();

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function fmtKm(metres) {
  return `${(metres / 1000).toFixed(2)} km`;
}

function fmtBigKm(metres) {
  return `${Math.round(metres / 1000).toLocaleString()} km`;
}

/* ---------------------------------------------------------------------------
   Loading.
   --------------------------------------------------------------------------- */

async function fetchFirst(name) {
  const tried = [];
  for (const dir of dataDir ? [dataDir] : DATA_DIRS) {
    try {
      const response = await fetch(`${dir}/${name}`);
      if (!response.ok) {
        tried.push(`${dir}/${name}: HTTP ${response.status}`);
        continue;
      }
      dataDir = dir;
      return await response.json();
    } catch (err) {
      tried.push(`${dir}/${name}: ${err.message}`);
    }
  }
  // Names every path tried. "No data" without saying where it looked costs an afternoon.
  throw new Error(tried.join('; '));
}

async function loadFocus(id) {
  if (docCache.has(id)) return docCache.get(id);
  const doc = await fetchFirst(`${id}.json`);
  if (!Array.isArray(doc.recorded) || doc.recorded.length < 2) {
    throw new Error(`${id}: no usable geometry`);
  }
  const entry = { id, doc, projected: project(doc.recorded) };
  docCache.set(id, entry);
  return entry;
}

/* ---------------------------------------------------------------------------
   Geometry handed to MapLibre.
   --------------------------------------------------------------------------- */

const EMPTY = { type: 'FeatureCollection', features: [] };

function allData() {
  return overview ? overview.recorded : EMPTY;
}

function matchedGeometry() {
  return overview ? overview.matched : EMPTY;
}

/* The selected run at the current tolerance. One pass produces the geometry and the
 * length, because the simplification that makes the line is also what makes the number:
 * computing them separately is two chances to disagree. */
function focusData() {
  if (!focus) return { fc: EMPTY, length: 0, kept: 0, total: 0 };
  const keep = simplifyMask(focus.projected, tolerance);
  const coords = simplifiedCoords(focus.doc.recorded, keep);
  let kept = 0;
  for (let i = 0; i < keep.length; i += 1) kept += keep[i];
  return {
    fc: coords
      ? {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: coords },
              properties: { id: focus.id, name: focus.doc.name },
            },
          ],
        }
      : EMPTY,
    length: planeLength(focus.projected, keep),
    kept,
    total: keep.length,
  };
}

/* ---------------------------------------------------------------------------
   The two readouts.
   --------------------------------------------------------------------------- */

function aggregate() {
  const rows = (summary && summary.activities) || [];
  let recorded = 0;
  let matched = 0;
  let strava = 0;
  let matchedCount = 0;
  let stravaCount = 0;
  for (const row of rows) {
    recorded += row.recorded_m || 0;
    if (row.matched_m) {
      matched += row.matched_m;
      matchedCount += 1;
    }
    if (row.strava_m) {
      strava += row.strava_m;
      stravaCount += 1;
    }
  }
  return { count: rows.length, recorded, matched, strava, matchedCount, stravaCount };
}

/* The whole history, from figures `prepare.py` computed at full resolution. Never from the
 * simplified overview the map is drawing. */
function renderAggregate() {
  if (!aggregateEl) return;
  const a = aggregate();
  aggregateEl.replaceChildren();
  if (!a.count) return;

  const big = document.createElement('b');
  big.textContent = fmtBigKm(a.recorded);
  aggregateEl.append(big, ` recorded across ${a.count.toLocaleString()} activities`);

  const sub = document.createElement('span');
  sub.className = 'sub';
  const bits = [];
  if (a.matchedCount) {
    const gap = ((a.recorded / a.matched - 1) * 100).toFixed(1);
    bits.push(`snapped to the map ${fmtBigKm(a.matched)} — recording is +${gap}%`);
  }
  if (a.stravaCount) {
    bits.push(`Strava says ${fmtBigKm(a.strava)}`);
  }
  if (a.matchedCount !== a.count) {
    bits.push(`${a.count - a.matchedCount} did not snap`);
  }
  sub.textContent = bits.join(' · ');
  aggregateEl.append(sub);
}

function renderReadout(measured) {
  if (!readoutEl) return;
  readoutEl.replaceChildren();

  if (!focus) {
    const hint = document.createElement('span');
    hint.className = 'sub';
    hint.textContent = overview
      ? `Pick a run to measure it. The map is drawn at a ${overview.floor_m} m floor; a selected run is full resolution.`
      : '';
    readoutEl.append(hint);
    if (keyRecordedEl) keyRecordedEl.textContent = 'as recorded';
    return;
  }

  const d = focus.doc;
  const big = document.createElement('b');
  big.textContent = fmtKm(measured.length);
  readoutEl.append(big, ' ');

  const drop = d.recorded_m - measured.length;
  const delta = document.createElement('span');
  delta.className = 'delta';
  delta.textContent =
    drop > 0.5
      ? `−${fmtKm(drop)} (−${((drop / d.recorded_m) * 100).toFixed(1)}%)`
      : 'full resolution';
  readoutEl.append(delta);

  const sub = document.createElement('span');
  sub.className = 'sub';
  const bits = [`${measured.kept.toLocaleString()} of ${measured.total.toLocaleString()} points`];
  if (d.matched_m) bits.push(`snapped ${fmtKm(d.matched_m)}`);
  if (d.strava_m) bits.push(`Strava ${fmtKm(d.strava_m)}`);
  sub.textContent = `${d.name} · ${bits.join(' · ')}`;
  readoutEl.append(sub);

  if (keyRecordedEl) {
    keyRecordedEl.textContent = tolerance > 0 ? `simplified to ${tolerance} m` : 'as recorded';
  }
}

/* ---------------------------------------------------------------------------
   Applying the slider.
   --------------------------------------------------------------------------- */

//: Coalesce slider input into one update per frame. Dragging fires `input` far more often
//: than the display can change.
let pending = false;
function scheduleUpdate(map) {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    applyTolerance(map);
  });
}

function applyTolerance(map) {
  const measured = focusData();
  const source = map && map.getSource(FOCUS);
  if (source) source.setData(measured.fc);
  if (sliderOut) sliderOut.textContent = `${tolerance} m`;
  renderReadout(measured);
}

function setSliderEnabled(on) {
  if (!slider) return;
  slider.disabled = !on;
  if (!on) {
    slider.value = '0';
    tolerance = 0;
    if (sliderOut) sliderOut.textContent = '0 m';
  }
}

/* ---------------------------------------------------------------------------
   Selection.
   --------------------------------------------------------------------------- */

function boundsOfCoords(coords) {
  let west = 180;
  let south = 90;
  let east = -180;
  let north = -90;
  for (const [lon, lat] of coords) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return coords.length ? [[west, south], [east, north]] : null;
}

async function selectActivity(map, id, { fly = true } = {}) {
  let entry;
  try {
    entry = await loadFocus(id);
  } catch (err) {
    setStatus(`Could not load ${id}: ${err.message}`);
    return null;
  }
  focus = entry;
  setSliderEnabled(true);

  if (map.getLayer(ALL)) {
    map.setPaintProperty(ALL, 'line-opacity', [
      'case', ['==', ['get', 'id'], id], 0, DIM,
    ]);
  }
  for (const layer of [`${ALL}-casing`]) {
    if (map.getLayer(layer)) {
      map.setPaintProperty(layer, 'line-opacity', [
        'case', ['==', ['get', 'id'], id], 0, DIM,
      ]);
    }
  }
  applyTolerance(map);
  if (fly) {
    const box = boundsOfCoords(entry.doc.recorded);
    if (box) map.fitBounds(box, { padding: 70, duration: 700, maxZoom: 16 });
  }
  openPanel();
  if (clearButton) clearButton.hidden = false;
  return entry;
}

function clearSelection(map) {
  focus = null;
  setSliderEnabled(false);
  if (map.getSource(FOCUS)) map.getSource(FOCUS).setData(EMPTY);
  for (const layer of [ALL, `${ALL}-casing`]) {
    if (map.getLayer(layer)) map.setPaintProperty(layer, 'line-opacity', FULL);
  }
  renderReadout(focusData());
  if (clearButton) clearButton.hidden = true;
  if (panel && panel.isOpen) panel.close();
}

function openPanel() {
  if (!panel || !focus) return;
  const d = focus.doc;
  const keep = simplifyMask(focus.projected, tolerance);
  const atTolerance = planeLength(focus.projected, keep);

  const rows = [['As recorded', fmtKm(d.recorded_m)]];
  if (tolerance > 0) rows.push([`Simplified to ${tolerance} m`, fmtKm(atTolerance)]);
  if (d.matched_m) rows.push(['Snapped to the map', fmtKm(d.matched_m)]);
  if (d.strava_m) rows.push(['Strava’s own figure', fmtKm(d.strava_m)]);
  if (d.matched_m) {
    const gap = (d.recorded_m / d.matched_m - 1) * 100;
    rows.push(['Recorded over snapped', `${gap >= 0 ? '+' : ''}${gap.toFixed(1)}%`]);
  }

  const recording = [['Points', d.points.toLocaleString()]];
  if (d.step_m) recording.push(['Median step', `${d.step_m.toFixed(1)} m`]);
  if (d.duration_s) recording.push(['Elapsed', `${Math.round(d.duration_s / 60)} min`]);
  if (d.sport) recording.push(['Type', d.sport]);
  if (d.date) recording.push(['Date', d.date]);

  const groups = [
    group('Distance', { columns: ['Measure', 'Value'], rows }),
    group('Recording', { columns: ['Field', 'Value'], rows: recording }),
  ];
  if (d.match_note) groups.push(group('Matching', [d.match_note]));

  panel.open(
    d.name || d.id,
    groups,
    d.matched_m
      ? 'Neither figure is the truth. Jitter adds length to the recording; snapping to the map cuts corners off it.'
      : 'This trace did not snap to the map, so only the recorded length is known.'
  );
}

/* ---------------------------------------------------------------------------
   Boot.
   --------------------------------------------------------------------------- */

//: Loaded before the map so the camera can open on the data rather than panning to it. A
//: failure is reported and the base map still draws: a day whose data is missing should
//: say so, not show a blank window.
let loadError = null;
try {
  summary = await fetchFirst('index.json');
  overview = await fetchFirst('overview.json');
} catch (err) {
  loadError = err;
}

//: Where the camera opens. `home` is the densest cluster of activities, computed by
//: `build_overview.py`: a history spanning continents cannot be opened by fitting all of
//: it, because the camera goes to world zoom and every trace becomes a sub-pixel thread.
//: Falling back to fitting everything is right for a history that really is in one place.
const fitTo = overview
  ? overview.home ||
    boundsOfCoords(overview.recorded.features.flatMap((f) => f.geometry.coordinates))
  : null;

const base = await createBaseMap({
  container: 'map',
  center: [-73.95, 40.7],
  zoom: 11,

  draw(map, ctx) {
    map.addSource(ALL, { type: 'geojson', data: allData() });
    map.addSource(FOCUS, { type: 'geojson', data: focusData().fc });
    map.addSource(MATCHED, { type: 'geojson', data: matchedGeometry() });

    const dimmed = focus
      ? ['case', ['==', ['get', 'id'], focus.id], 0, DIM]
      : FULL;

    //: Matched first, so the recording sits on top of it. The recording is the subject;
    //: the snapped path is what it is being measured against.
    map.addLayer(
      {
        id: `${MATCHED}-casing`,
        type: 'line',
        source: MATCHED,
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: showMatched ? 'visible' : 'none' },
        paint: { 'line-color': CASING, 'line-width': ZOOM_WIDTH.matchedCasing },
      },
      ctx.beforeId
    );
    map.addLayer(
      {
        id: MATCHED,
        type: 'line',
        source: MATCHED,
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: showMatched ? 'visible' : 'none' },
        paint: { 'line-color': INK_MATCHED, 'line-width': ZOOM_WIDTH.matched },
      },
      ctx.beforeId
    );
    map.addLayer(
      {
        id: `${ALL}-casing`,
        type: 'line',
        source: ALL,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': CASING, 'line-width': ZOOM_WIDTH.allCasing, 'line-opacity': dimmed },
      },
      ctx.beforeId
    );
    map.addLayer(
      {
        id: ALL,
        type: 'line',
        source: ALL,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': INK_RECORDED, 'line-width': ZOOM_WIDTH.all, 'line-opacity': dimmed },
      },
      ctx.beforeId
    );
    map.addLayer(
      {
        id: `${FOCUS}-casing`,
        type: 'line',
        source: FOCUS,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': CASING, 'line-width': WIDTH.focusCasing },
      },
      ctx.beforeId
    );
    map.addLayer(
      {
        id: FOCUS,
        type: 'line',
        source: FOCUS,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': INK_RECORDED, 'line-width': WIDTH.focus },
      },
      ctx.beforeId
    );
    //: Last, so it sits above the drawn lines and takes the pointer first.
    map.addLayer(
      {
        id: HIT,
        type: 'line',
        source: ALL,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': INK_RECORDED, 'line-opacity': 0, 'line-width': WIDTH.hit },
      },
      ctx.beforeId
    );
  },
});

if (base) {
  const { map } = base;
  window.base = base;

  //: What `scripts/check.py` drives. Nothing on the page reads it.
  window.lines = {
    get tolerance() {
      return tolerance;
    },
    dataDir: () => dataDir,
    overviewFloor: () => (overview ? overview.floor_m : null),
    activities: () => ((summary && summary.activities) || []).map((a) => a.id),
    aggregate,
    selectedId: () => (focus ? focus.id : null),
    select: (id) => selectActivity(map, id, { fly: false }),
    clear: () => clearSelection(map),
    setTolerance: (t) => {
      tolerance = t;
      applyTolerance(map);
    },
    //: The ladder for the selected run, computed here, against the one `prepare.py`
    //: wrote into that run's document. The guard on two implementations of one
    //: calculation.
    ladder: () => (focus ? ladder(focus.doc.recorded, LADDER_TOLERANCES) : null),
    writtenLadder: () => (focus ? focus.doc.ladder : null),
    focusLengthAt: (t) => {
      if (!focus) return null;
      const was = tolerance;
      tolerance = t;
      const out = focusData().length;
      tolerance = was;
      return out;
    },
  };

  if (fitTo) map.fitBounds(fitTo, { padding: 60, duration: 0 });

  setSliderEnabled(false);
  renderAggregate();
  applyTolerance(map);

  if (loadError) {
    setStatus(`No activity data: ${loadError.message}. Run prepare.py, then build_overview.py.`);
  } else {
    const a = aggregate();
    setStatus(
      `${a.count.toLocaleString()} activities, ${a.matchedCount.toLocaleString()} snapped to the map. ` +
        `Click a run to measure it.`
    );
  }

  if (slider) {
    slider.addEventListener('input', () => {
      tolerance = Number(slider.value);
      scheduleUpdate(map);
    });
  }

  if (matchedToggle) {
    matchedToggle.addEventListener('click', () => {
      showMatched = !showMatched;
      matchedToggle.setAttribute('aria-pressed', String(showMatched));
      for (const id of [MATCHED, `${MATCHED}-casing`]) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, 'visibility', showMatched ? 'visible' : 'none');
        }
      }
    });
  }

  if (clearButton) {
    clearButton.hidden = true;
    clearButton.addEventListener('click', () => clearSelection(map));
  }

  map.on('click', HIT, (event) => {
    selectActivity(map, event.features[0].properties.id);
  });

  map.on('mouseenter', HIT, () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', HIT, () => {
    map.getCanvas().style.cursor = '';
  });

  if (panel) {
    panel.onClose = () => {
      if (focus) clearSelection(map);
    };
  }
}
