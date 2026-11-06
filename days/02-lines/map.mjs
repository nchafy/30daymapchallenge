/* Day 02 — Lines.
 *
 * Every activity is drawn twice: the trace as the watch recorded it, and the same trace
 * snapped to the OSM network. The recorded one is longer, because receiver jitter is
 * indistinguishable from movement and gets counted as distance covered.
 *
 * The slider is the argument. It simplifies the recorded trace at a tolerance the reader
 * chooses, and the total distance falls as the wobble comes out. There is no tolerance at
 * which the number is "right" — that is the point. A run has no single length, only a
 * length at a stated resolution, which is the coastline paradox at 5 km
 * (https://doi.org/10.1126/science.156.3775.636).
 *
 * `draw` is re-run against a fresh style on every basemap change, so it adds its sources
 * unconditionally. The tolerance and which activity is selected live outside it and are
 * read back in, because a basemap switch must not reset the reader's slider.
 */

import { createBaseMap } from '../../assets/basemap.mjs';
import { mountChrome, group } from '../../assets/chrome.mjs';
import { project, simplifyMask, simplifiedCoords, planeLength, ladder } from './geo.mjs';

const { panel } = mountChrome({ here: '02-lines' });

const RECORDED = 'recorded';
const MATCHED = 'matched';
//: A wide transparent line over the visible one, carrying the clicks.
//:
//: The drawn trace is 2 px, which is right for a jittery line drawn 30 times over and
//: wrong as a target: MapLibre hit-tests the rendered geometry, so a 2 px line asks for
//: pixel-exact aim and misses more often than it hits. `scripts/check.py` caught this by
//: finding a pixel that queried back to the line and still opened no panel.
const HIT = 'recorded-hit';
const HIT_WIDTH = 16;

//: A hot magenta and a cyan, chosen against the satnav palette rather than from it: the
//: base map's own tokens are olive, navy and yellow, and an overlay in any of them would
//: read as part of the road network. Both carry over imagery too, which the era's navy
//: does not.
const INK_RECORDED = '#ff2e88';
const INK_MATCHED = '#39d0ff';
//: Dark casing under each line. Over satellite a 2px bright line on a busy photograph
//: disappears; a casing gives it an edge at no cost on the flat basemaps.
const CASING = 'rgba(8, 14, 32, 0.75)';

//: Line widths, in one place because they are a stack and only work as a set.
//:
//: The snapped line has to be *wider* than the recorded line's casing, not merely under
//: it. Drawn at 3 px beneath a 2 px trace with a 5 px casing it was covered completely:
//: the key named a cyan line that was nowhere on the map. So the snapped path reads as a
//: band and the recorded trace runs along the top of it, which also says the right thing
//: -- the snapped line is the route, the jitter is what sits on it.
//: Opacity of a trace that is not the selected one. Used by `draw` and by the click
//: handler, which both build the same expression -- so it is a constant, not two numbers.
//: They were 0.85 and 0.35, which meant selecting a trace and then switching basemap
//: un-dimmed the other five while the panel still named one as selected.
const DIM = 0.4;
const FULL = 1;

const WIDTH = {
  matchedCasing: 11,
  matched: 8,
  recordedCasing: 4,
  recorded: 2,
};

//: Mirrors `gpsnoise.TOLERANCES_M`. Only used to cross-check this module's arithmetic
//: against the ladder `prepare.py` wrote; the slider is continuous and uses neither.
const LADDER_TOLERANCES = [0, 0.5, 1, 2, 3, 5, 8, 12, 20, 35, 60, 100];

const statusEl = document.getElementById('map-status');
const slider = document.getElementById('tolerance');
const sliderOut = document.getElementById('tolerance-out');
const readoutEl = document.getElementById('readout');
const matchedToggle = document.getElementById('toggle-matched');
const keyRecordedEl = document.getElementById('key-recorded');

//: State that has to survive a basemap switch.
let tolerance = 0;
let showMatched = true;
let selectedId = null;

/** @type {{id:string, doc:object, projected:object, baseLength:number}[]} */
let activities = [];

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function fmtKm(metres) {
  return `${(metres / 1000).toFixed(2)} km`;
}

/* Build the recorded lines at the current tolerance, and total their length.
 *
 * One pass does both, because the simplification that produces the geometry is also what
 * produces the number: computing them separately is two chances to disagree. */
function recordedData() {
  const features = [];
  let total = 0;
  let keptPoints = 0;
  let allPoints = 0;
  for (const act of activities) {
    const keep = simplifyMask(act.projected, tolerance);
    const coords = simplifiedCoords(act.doc.recorded, keep);
    total += planeLength(act.projected, keep);
    for (let i = 0; i < keep.length; i += 1) keptPoints += keep[i];
    allPoints += keep.length;
    if (coords) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { id: act.id, name: act.doc.name },
      });
    }
  }
  return { fc: { type: 'FeatureCollection', features }, total, keptPoints, allPoints };
}

function matchedData() {
  return {
    type: 'FeatureCollection',
    features: activities
      .filter((a) => a.doc.matched && a.doc.matched.length >= 2)
      .map((a) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: a.doc.matched },
        properties: { id: a.id, name: a.doc.name },
      })),
  };
}

function totals() {
  const recordedTotal = activities.reduce((s, a) => s + a.baseLength, 0);
  const matchedTotal = activities.reduce((s, a) => s + (a.doc.matched_m || 0), 0);
  const matchedCount = activities.filter((a) => a.doc.matched_m).length;
  return { recordedTotal, matchedTotal, matchedCount };
}

function renderReadout(measured) {
  if (!readoutEl) return;
  const { recordedTotal, matchedTotal, matchedCount } = totals();
  const drop = recordedTotal - measured.total;
  const pct = recordedTotal > 0 ? (drop / recordedTotal) * 100 : 0;
  const deltaText = drop > 0.5 ? `−${fmtKm(drop)} (−${pct.toFixed(1)}%)` : 'full resolution';
  const matchedText = matchedCount
    ? `snapped to the map: ${fmtKm(matchedTotal)}`
    : 'nothing matched to the map';
  readoutEl.innerHTML = '';
  const big = document.createElement('b');
  big.textContent = fmtKm(measured.total);
  readoutEl.append(big, ' ');
  const delta = document.createElement('span');
  delta.className = 'delta';
  delta.textContent = deltaText;
  readoutEl.append(delta);
  const sub = document.createElement('span');
  sub.className = 'sub';
  sub.textContent =
    `${measured.keptPoints.toLocaleString()} of ${measured.allPoints.toLocaleString()} points kept · ${matchedText}`;
  readoutEl.append(sub);
  if (keyRecordedEl) {
    keyRecordedEl.textContent = tolerance > 0 ? `simplified to ${tolerance} m` : 'as recorded';
  }
}

//: Coalesce slider input into one update per frame. Dragging fires `input` far more often
//: than the display can change, and re-simplifying every trace per event is wasted work
//: that shows up as lag on a long export.
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
  const measured = recordedData();
  const source = map && map.getSource(RECORDED);
  if (source) source.setData(measured.fc);
  if (sliderOut) sliderOut.textContent = `${tolerance} m`;
  renderReadout(measured);
}

function openActivity(id) {
  if (!panel) return;
  const act = activities.find((a) => a.id === id);
  if (!act) return;
  selectedId = id;
  const d = act.doc;

  const keep = simplifyMask(act.projected, tolerance);
  const atTolerance = planeLength(act.projected, keep);

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
  if (d.duration_s) {
    const mins = Math.round(d.duration_s / 60);
    recording.push(['Elapsed', `${mins} min`]);
  }
  if (d.sport) recording.push(['Type', d.sport]);
  if (d.date) recording.push(['Date', d.date]);

  const groups = [
    group('Distance', { columns: ['Measure', 'Value'], rows }),
    group('Recording', { columns: ['Field', 'Value'], rows: recording }),
  ];
  if (d.match_note) {
    groups.push(group('Matching', [d.match_note]));
  }

  panel.open(
    d.name || d.id,
    groups,
    d.matched_m
      ? 'Neither figure is the truth. Jitter adds length to the recording; snapping to the map cuts corners off it.'
      : 'This trace did not snap to the map, so only the recorded length is known.'
  );
}

/* Ease to one activity's extent.
 *
 * Six activities spread across a city fit the window at a zoom where each is a few
 * millimetres of line, and the wobble the page is about is smaller than a pixel. Opening
 * one has to go and look at it, or the detail panel is describing something the reader
 * cannot see. */
function flyToActivity(map, act) {
  const box = boundsOf([act]);
  if (!box) return;
  map.fitBounds(box, { padding: 80, duration: 700, maxZoom: 16 });
}

function boundsOf(acts) {
  let west = 180;
  let south = 90;
  let east = -180;
  let north = -90;
  let any = false;
  for (const act of acts) {
    for (const [lon, lat] of act.doc.recorded) {
      any = true;
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  return any ? [[west, south], [east, north]] : null;
}

//: Where the activity data might be, most private first.
//:
//: `private/` is what `prepare.py` writes by default and is gitignored; `data/` holds the
//: synthetic fixture and is committed so this page renders for someone with no Strava
//: export. Preferring `private/` means running the pipeline on a real export just works,
//: and the real data has nowhere to go that could be committed by accident.
const DATA_DIRS = ['./private', './data'];

async function loadActivities() {
  let base = null;
  let index = null;
  const tried = [];
  for (const dir of DATA_DIRS) {
    try {
      const response = await fetch(`${dir}/index.json`);
      if (!response.ok) {
        tried.push(`${dir}: HTTP ${response.status}`);
        continue;
      }
      index = await response.json();
      base = dir;
      break;
    } catch (err) {
      tried.push(`${dir}: ${err.message}`);
    }
  }
  if (!index) {
    // Names every path that was tried. "No data" with no list of where it looked is the
    // kind of error message that costs an afternoon.
    throw new Error(tried.join('; '));
  }

  const rows = index.activities || [];
  const docs = await Promise.all(
    rows.map((row) =>
      fetch(`${base}/${row.id}.json`).then((r) => {
        if (!r.ok) throw new Error(`${base}/${row.id}.json: HTTP ${r.status}`);
        return r.json();
      })
    )
  );
  return docs
    .filter((doc) => Array.isArray(doc.recorded) && doc.recorded.length >= 2)
    .map((doc) => {
      const projected = project(doc.recorded);
      return { id: doc.id, doc, projected, baseLength: planeLength(projected) };
    });
}

//: Loaded before the map so the camera can open on the data rather than panning to it.
//: A failure here is reported and the page still draws the base map: a day whose data is
//: missing should say so, not show a blank window.
let loadError = null;
try {
  activities = await loadActivities();
} catch (err) {
  loadError = err;
}

const fitTo = boundsOf(activities);

const base = await createBaseMap({
  container: 'map',
  center: [-73.95, 40.7],
  zoom: 11,

  draw(map, ctx) {
    map.addSource(RECORDED, { type: 'geojson', data: recordedData().fc });
    map.addSource(MATCHED, { type: 'geojson', data: matchedData() });

    //: Matched first, so the recorded trace sits on top of it. The recorded line is the
    //: subject; the snapped one is what it is being measured against.
    map.addLayer(
      {
        id: `${MATCHED}-casing`,
        type: 'line',
        source: MATCHED,
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: showMatched ? 'visible' : 'none' },
        paint: { 'line-color': CASING, 'line-width': WIDTH.matchedCasing },
      },
      ctx.beforeId
    );
    map.addLayer(
      {
        id: MATCHED,
        type: 'line',
        source: MATCHED,
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: showMatched ? 'visible' : 'none' },
        paint: { 'line-color': INK_MATCHED, 'line-width': WIDTH.matched },
      },
      ctx.beforeId
    );
    map.addLayer(
      {
        id: `${RECORDED}-casing`,
        type: 'line',
        source: RECORDED,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': CASING, 'line-width': WIDTH.recordedCasing },
      },
      ctx.beforeId
    );
    map.addLayer(
      {
        id: RECORDED,
        type: 'line',
        source: RECORDED,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': INK_RECORDED,
          'line-width': WIDTH.recorded,
          //: The selected activity is widened rather than recoloured: a second colour
          //: would compete with the two the key already explains.
          'line-opacity': selectedId
            ? ['case', ['==', ['get', 'id'], selectedId], FULL, DIM]
            : FULL,
        },
      },
      ctx.beforeId
    );
    //: Last, so it sits above the drawn trace and takes the pointer first.
    map.addLayer(
      {
        id: HIT,
        type: 'line',
        source: RECORDED,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': INK_RECORDED, 'line-opacity': 0, 'line-width': HIT_WIDTH },
      },
      ctx.beforeId
    );
  },
});

if (base) {
  const { map } = base;
  window.base = base;

  //: What `scripts/check.py` drives to hold this module's arithmetic against the ladder
  //: `prepare.py` wrote. Nothing on the page reads it.
  window.lines = {
    get tolerance() {
      return tolerance;
    },
    activities: () => activities.map((a) => a.id),
    ladderFor: (id) => {
      const act = activities.find((a) => a.id === id);
      return act ? ladder(act.doc.recorded, LADDER_TOLERANCES) : null;
    },
    writtenLadderFor: (id) => {
      const act = activities.find((a) => a.id === id);
      return act ? act.doc.ladder : null;
    },
    totalAt: (t) => {
      const was = tolerance;
      tolerance = t;
      const out = recordedData().total;
      tolerance = was;
      return out;
    },
  };

  if (fitTo) {
    map.fitBounds(fitTo, { padding: 60, duration: 0 });
  }

  if (loadError) {
    setStatus(`No activity data: ${loadError.message}. Run prepare.py to build days/02-lines/data.`);
  } else if (!activities.length) {
    setStatus('No activities in days/02-lines/data. Run prepare.py.');
  } else {
    const { matchedCount } = totals();
    setStatus(
      `${activities.length} activit${activities.length === 1 ? 'y' : 'ies'}, ` +
        `${matchedCount} snapped to the map. Drag Detail to simplify.`
    );
  }

  applyTolerance(map);

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

  map.on('click', HIT, (event) => {
    const id = event.features[0].properties.id;
    openActivity(id);
    if (map.getLayer(RECORDED)) {
      map.setPaintProperty(RECORDED, 'line-opacity', [
        'case', ['==', ['get', 'id'], id], FULL, DIM,
      ]);
    }
    const act = activities.find((a) => a.id === id);
    if (act) flyToActivity(map, act);
  });

  map.on('mouseenter', HIT, () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', HIT, () => {
    map.getCanvas().style.cursor = '';
  });

  if (panel) {
    panel.onClose = () => {
      selectedId = null;
      if (map.getLayer(RECORDED)) {
        map.setPaintProperty(RECORDED, 'line-opacity', FULL);
      }
    };
  }
}
