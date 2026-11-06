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

import { createBaseMap } from '../../lib/basemap.mjs';
import { mountShell, group } from '../../os/shell.mjs';
import { APPS } from '../../apps.mjs';
import { project, simplifyMask, simplifiedCoords, planeLength, ladder } from './geo.mjs';

const { panel } = mountShell({ here: '02-lines', entries: APPS, menu: APPS });

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

/* ---------------------------------------------------------------------------
   The noise-by-area choropleth.
   --------------------------------------------------------------------------- */

const NOISE = 'noise';
const NOISE_SCRIM = 'noise-scrim';

/* A scrim between the basemap and the cells, so the choropleth has a surface.
 *
 * Not decoration. A classed ramp has to be validated against the colour behind it, and
 * the satnav basemap has no single colour behind anything -- olive land, navy water,
 * yellow arterials. The scrim makes the surface deterministic whichever basemap is
 * showing, which is what let the ramp below be computed rather than guessed. The project's
 * own `docs/basemap.md` reaches the same conclusion from the other direction: "a day whose
 * data needs a quiet backdrop should pick `geography`, or empty `SATNAV`."
 *
 * At this alpha the composited surface runs about #181a1e over water to #2e2e2e over the
 * palest road fill, and the ramp was validated against #2e2e2e -- the worst case, because
 * a lighter surface is what costs a light mark its contrast. */
const SCRIM = 'rgba(16, 18, 22, 0.88)';

/* Diverging, blue to red, neutral grey midpoint. Signed data gets a diverging ramp and a
 * diverging ramp gets a grey middle, never a hue.
 *
 * Away from zero is *lighter*, because the surface is dark: the step nearest the midpoint
 * is the one at risk of vanishing, so it is the one that had to clear contrast. Measured
 * against #2e2e2e with the palette validator:
 *
 *   each arm as an ordinal ramp     monotone L, step gaps >= 0.06, PASS
 *   innermost steps vs surface      3.08:1 blue, 3.09:1 red
 *   across the midpoint, CVD        worst pair dE 17.2 protan, 27.3 tritan (>= 8 target)
 *   across the midpoint, normal     worst pair dE 28.9 (>= 15 floor)
 *
 * The midpoint is deliberately recessive at 1.15:1 -- "nothing notable here" should not
 * compete. The validator flags that as needing relief, and the relief is `NOISE_OUTLINE`:
 * every cell is outlined, so a cell's *existence* never depends on its fill. Without it a
 * midpoint cell and a cell with too few passes to report would look identical. */
const NOISE_RAMP = ['#9ec5f4', '#5598e7', '#2a78d6', '#383835', '#d6453f', '#ef6a5e', '#f9a79c'];

/* Class edges in percentage points of speed-adjusted inflation.
 *
 * Fixed rather than derived from the data, so two exports are comparable and the legend
 * means the same thing twice. Symmetric about zero because the quantity is. */
const NOISE_BREAKS = [-1.0, -0.5, -0.2, 0.2, 0.5, 1.0];

//: Light enough to read against every step including the recessive midpoint.
const NOISE_OUTLINE_INK = 'rgba(223, 232, 245, 0.45)';

const PROP = 'adjusted_pts';
//: The one crossing being shown, drawn over its own run.
const PASS = 'pass';

/* Every crossing of the open segment, overlaid. The worm.
 *
 * This is the point of the whole drill-down, and it needs no number to read. The same
 * street, run thirty times, traced thirty times: where the ghosts lie on top of each
 * other the receiver agreed with itself, and where they fan apart it did not. The width
 * of the bundle *is* the noise being measured everywhere else on this page as a
 * percentage.
 *
 * It is also the era's own failure mode. A Windows window dragged faster than the
 * compositor could repaint left a smear of copies behind it, and that is what a noisy
 * segment looks like here. The real artifact usually left one trailing shadow rather than
 * a dense bundle, which is the argument for `GHOST_CAP`: past about a dozen the overlay
 * stops being a smear and becomes a blob. */
const GHOSTS = 'ghosts';

//: How many crossings the worm draws. A cap, not a sample of convenience: the panel still
//: lists the extremes, and the ghosts are there to be *looked* at.
const GHOST_CAP = 12;

//: Low enough that one ghost is a hint and a dozen stacked is solid, so the overlay
//: encodes how many passes agreed as well as where they did.
const GHOST_INK = 'rgba(255, 255, 255, 0.3)';

/* The step expression MapLibre wants, built from the two constants above so the fill and
 * the legend cannot disagree about where a class starts. */
function noiseFillExpression() {
  const stops = [];
  NOISE_BREAKS.forEach((edge, i) => stops.push(edge, NOISE_RAMP[i + 1]));
  return ['step', ['get', PROP], NOISE_RAMP[0], ...stops];
}

/** Legend rows, in the same order the map paints them. */
function noiseLegendRows() {
  const fmt = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
  return NOISE_RAMP.map((colour, i) => {
    const lo = NOISE_BREAKS[i - 1];
    const hi = NOISE_BREAKS[i];
    let label;
    if (lo === undefined) label = `below ${fmt(hi)}`;
    else if (hi === undefined) label = `above ${fmt(lo)}`;
    else label = `${fmt(lo)} to ${fmt(hi)}`;
    return { colour, label };
  });
}

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
//: The noise grid, or null when `noise_by_area.py` has not been run. Optional throughout:
//: the page is useful without it and must not fail for its absence.
let noise = null;
let showNoise = false;
//: The segment being drilled into, by cell id.
let selectedCell = null;
//: One crossing of one segment by one run: `{activity, i0, i1, ...}`. The drill-down's
//: leaf, and what `PASS` draws.
let passSpan = null;
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

/* The one crossing being shown, as a line over its own run's full-resolution geometry.
 *
 * Needs the run loaded, which `showPass` guarantees before setting `passSpan`. Returns
 * empty rather than throwing when it is not, because `draw` runs on every basemap change
 * and must not care what order things happened in. */
//: The crossings currently drawn as ghosts: `[{activity, i0, i1}]`, already loaded.
let ghostSpans = [];

/* The worm: one line per loaded crossing of the open segment. */
function ghostData() {
  const features = [];
  for (const span of ghostSpans) {
    const entry = docCache.get(span.activity);
    if (!entry) continue;
    const coords = entry.doc.recorded.slice(span.i0, span.i1 + 1);
    if (coords.length < 2) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: { activity: span.activity },
    });
  }
  return { type: 'FeatureCollection', features };
}

//: How far the traces recede when the choropleth is the subject.
//:
//: With the grid on, four hundred magenta and cyan lines sit on top of the cells they are
//: supposed to be explaining, and the cells lose. Figure and ground swap when the layer
//: does: the traces stay as context, because a cell with no road under it is a square in
//: the dark, but they stop competing.
const TRACE_UNDER_NOISE = 0.22;

/** Set the whole-history traces' weight according to what the reader is looking at. */
function applyTraceEmphasis(map) {
  const base = showNoise ? TRACE_UNDER_NOISE : FULL;
  for (const id of [ALL, `${ALL}-casing`]) {
    if (!map.getLayer(id)) continue;
    map.setPaintProperty(
      id,
      'line-opacity',
      focus ? ['case', ['==', ['get', 'id'], focus.id], 0, showNoise ? TRACE_UNDER_NOISE : DIM] : base
    );
  }
  for (const id of [MATCHED, `${MATCHED}-casing`]) {
    if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', base);
  }
}

/* Put the camera where the cells are, clear of the controls.
 *
 * Turning the layer on used to leave it off screen: the grid only covers the places with
 * enough repeat passes to measure, which is a fraction of the extent the page opens at,
 * and the little that did show sat behind the control cards. A layer you switch on and
 * cannot see reads as a broken layer.
 *
 * The left padding is measured off the overlay column rather than guessed, so it stays
 * right at both viewports and after a card changes size. */
function goToCells(map) {
  if (!noise || !noise.features.length) return;

  // Only the cells in the home cluster. Fitting *all* of them spans every city the runner
  // has ever visited -- here, 50 degrees of longitude -- so the camera went continental
  // and all 190 cells came out sub-pixel. Same reasoning as the page's opening camera.
  const home = overview && overview.home;
  const inHome = home
    ? noise.features.filter((f) => {
        const [lon, lat] = f.geometry.coordinates[0][0];
        return (
          lon >= home[0][0] && lon <= home[1][0] && lat >= home[0][1] && lat <= home[1][1]
        );
      })
    : noise.features;
  const chosen = inHome.length ? inHome : noise.features;

  const box = boundsOfCoords(chosen.flatMap((f) => f.geometry.coordinates[0]));
  if (!box) return;
  const overlays = document.querySelector('.overlays > *');
  const gutter = overlays ? Math.ceil(overlays.getBoundingClientRect().width) + 24 : 24;
  const canvas = map.getCanvas();
  // On a narrow viewport the cards take most of the width, so a left gutter would leave
  // nothing to draw in; there, pad evenly and accept the overlap.
  const roomy = canvas.clientWidth > gutter * 2.2;
  map.fitBounds(box, {
    padding: roomy
      ? { left: gutter, right: 24, top: 24, bottom: 48 }
      : { left: 12, right: 12, top: 12, bottom: 48 },
    duration: 600,
    maxZoom: 15,
  });
}

/* Load the runs the worm needs and draw it.
 *
 * Geometry comes from each run's own full-resolution document rather than being copied
 * into the grid file. The grid would have had to carry a few thousand short line strings,
 * and they would be a second copy of coordinates that already exist -- fine until the grid
 * is rebuilt against changed data and the two disagree. `docCache` makes a revisit free. */
async function drawGhosts(map, passes) {
  const wanted = passes.slice(0, GHOST_CAP);
  const results = await Promise.allSettled(wanted.map((p) => loadFocus(p.activity)));
  ghostSpans = wanted.filter((_p, i) => results[i].status === 'fulfilled');
  const source = map.getSource(GHOSTS);
  if (source) source.setData(ghostData());
  const failed = results.length - ghostSpans.length;
  if (failed) {
    // Named rather than swallowed: a worm quietly missing half its ghosts would read as a
    // quiet segment, which is the opposite of the truth.
    setStatus(`${failed} of ${results.length} crossings could not be loaded for the overlay.`);
  }
  return ghostSpans.length;
}

function passData() {
  if (!passSpan || !focus || focus.id !== passSpan.activity) return EMPTY;
  const coords = focus.doc.recorded.slice(passSpan.i0, passSpan.i1 + 1);
  if (coords.length < 2) return EMPTY;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { activity: passSpan.activity },
      },
    ],
  };
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

async function selectActivity(map, id, { fly = true, openPanel: showPanel = true } = {}) {
  let entry;
  try {
    entry = await loadFocus(id);
  } catch (err) {
    setStatus(`Could not load ${id}: ${err.message}`);
    return null;
  }
  focus = entry;
  setSliderEnabled(true);

  applyTraceEmphasis(map);
  applyTolerance(map);
  if (fly) {
    const box = boundsOfCoords(entry.doc.recorded);
    if (box) map.fitBounds(box, { padding: 70, duration: 700, maxZoom: 16 });
  }
  if (showPanel) openPanel();
  if (clearButton) clearButton.hidden = false;
  return entry;
}

function clearSelection(map) {
  focus = null;
  passSpan = null;
  setSliderEnabled(false);
  if (map.getSource(FOCUS)) map.getSource(FOCUS).setData(EMPTY);
  if (map.getSource(PASS)) map.getSource(PASS).setData(EMPTY);
  ghostSpans = [];
  selectedCell = null;
  if (map.getSource(GHOSTS)) map.getSource(GHOSTS).setData(EMPTY);
  if (map.getLayer(`${NOISE}-selected`)) {
    map.setFilter(`${NOISE}-selected`, ['==', ['get', 'id'], '']);
  }
  applyTraceEmphasis(map);
  renderReadout(focusData());
  if (clearButton) clearButton.hidden = true;
  if (panel && panel.isOpen) panel.close();
}

/* ---------------------------------------------------------------------------
   The drill-down: segment -> its passes -> the run one of them came from.
   --------------------------------------------------------------------------- */

//: Passes listed per segment. Thirty-seven buttons is a wall, and the interesting ones are
//: at the ends of the distribution, so the list is the worst few and the best few.
const PASSES_SHOWN = 6;

function passButton(map, pass, cell) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pass-row';
  const sign = pass.adjusted_pts > 0 ? '+' : '';
  button.textContent =
    `${pass.name} · ${pass.inflation_pct.toFixed(1)}% ` +
    `(${sign}${pass.adjusted_pts.toFixed(1)} adj, ${pass.speed_ms.toFixed(1)} m/s)`;
  button.addEventListener('click', () => showPass(map, pass, cell));
  return button;
}

/** Open a segment: what this stretch measures, and every run that crossed it. */
async function openSegment(map, props) {
  if (!panel) return;
  selectedCell = props.id;
  passSpan = null;
  if (map.getSource(PASS)) map.getSource(PASS).setData(EMPTY);
  if (map.getLayer(`${NOISE}-selected`)) {
    map.setFilter(`${NOISE}-selected`, ['==', ['get', 'id'], selectedCell]);
  }

  const passes = Array.isArray(props.passes) ? props.passes : [];

  // Go there first. A 220 m cell at city zoom is a few pixels across, and a worm drawn
  // inside it would be one smudge: the overlay only says anything at a zoom where two
  // traces four metres apart are two traces.
  map.fitBounds(
    [
      [props.lon - noise.cell_deg, props.lat - noise.cell_deg * 0.7],
      [props.lon + noise.cell_deg, props.lat + noise.cell_deg * 0.7],
    ],
    { padding: 40, duration: 600, maxZoom: 18 }
  );
  const drawn = passes.length ? await drawGhosts(map, passes) : 0;
  const sign = (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
  const stats = [
    ['Recorded over simplified', `${props.inflation_pct.toFixed(2)}%`],
    ['Speed-adjusted', `${sign(props.adjusted_pts)} points`],
    ['Worst tenth of passes', `${props.p90_pct.toFixed(2)}%`],
    ['Crossings measured', `${props.windows}`],
    ['Different runs', `${props.activities}`],
  ];

  const groups = [group('This stretch', { columns: ['Measure', 'Value'], rows: stats })];

  if (passes.length) {
    const worst = passes.slice(0, PASSES_SHOWN);
    const best = passes.slice(-PASSES_SHOWN).reverse();
    groups.push(
      group(
        `Noisiest crossings`,
        worst.map((p) => passButton(map, p, props))
      )
    );
    if (passes.length > PASSES_SHOWN * 2) {
      groups.push(
        group(
          `Quietest crossings`,
          best.map((p) => passButton(map, p, props))
        )
      );
    }
  }

  panel.open(
    `Segment at ${props.lat.toFixed(4)}, ${props.lon.toFixed(4)}`,
    groups,
    drawn
      ? `${drawn} of ${passes.length} crossings drawn on top of each other. The width of ` +
        `that bundle is the noise — pick one to pull it to the front.`
      : 'No individual crossings were kept for this segment.'
  );
}

/* The leaf: load the run this crossing came from, draw just that stretch, and go there.
 *
 * The run is loaded at full resolution, so the slider works on it afterwards -- the point
 * of arriving here is to look at the wobble, and the wobble is what the overview's 5 m
 * floor removed. */
async function showPass(map, pass, cell) {
  const entry = await selectActivity(map, pass.activity, { fly: false, openPanel: false });
  if (!entry) return;
  passSpan = pass;
  const source = map.getSource(PASS);
  if (source) source.setData(passData());

  const coords = entry.doc.recorded.slice(pass.i0, pass.i1 + 1);
  const box = boundsOfCoords(coords);
  if (box) map.fitBounds(box, { padding: 90, duration: 700, maxZoom: 18 });

  if (!panel) return;
  const sign = (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'pass-row';
  back.textContent = '← back to the whole segment';
  back.addEventListener('click', () => openSegment(map, cell));

  panel.open(pass.name || pass.activity, [
    group('This crossing', {
      columns: ['Measure', 'Value'],
      rows: [
        ['Recorded over simplified', `${pass.inflation_pct.toFixed(2)}%`],
        ['Speed-adjusted', `${sign(pass.adjusted_pts)} points`],
        ['Speed through here', `${pass.speed_ms.toFixed(2)} m/s`],
        ['Points in the stretch', `${pass.i1 - pass.i0 + 1}`],
      ],
    }),
    group('The run it came from', {
      columns: ['Field', 'Value'],
      rows: [
        ['Recorded', fmtKm(entry.doc.recorded_m)],
        ...(entry.doc.matched_m ? [['Snapped', fmtKm(entry.doc.matched_m)]] : []),
        ...(entry.doc.date ? [['Date', entry.doc.date]] : []),
      ],
    }),
    group('Elsewhere', [back]),
  ], 'The slider now measures this whole run, at full resolution.');
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

// Optional, and a separate try: a missing noise grid disables one control. Folding it in
// above would turn "you have not run noise_by_area.py" into "the page has no data".
try {
  noise = await fetchFirst('area-noise.json');
} catch {
  noise = null;
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
    // The noise grid goes in first, so the traces draw on top of it. The choropleth is
    // context; the lines are the subject.
    if (noise) {
      map.addSource(NOISE, { type: 'geojson', data: noise });
      map.addLayer(
        {
          id: NOISE_SCRIM,
          type: 'background',
          layout: { visibility: showNoise ? 'visible' : 'none' },
          paint: { 'background-color': SCRIM },
        },
        ctx.beforeId
      );
      map.addLayer(
        {
          id: NOISE,
          type: 'fill',
          source: NOISE,
          layout: { visibility: showNoise ? 'visible' : 'none' },
          paint: {
            'fill-color': noiseFillExpression(),
            // Opaque where cells are being compared with each other, then gone once the
            // camera is inside one.
            //
            // Opaque matters: the ramp was validated as hex against the scrim's surface,
            // and painting it at a constant 0.85 put the colours actually on screen
            // outside what was checked -- #d6453f landed about 32 per channel away. So
            // full opacity holds through zoom 15, which is every zoom at which the fill is
            // doing its job.
            //
            // Fading above that is not a contradiction. Past zoom 16 one 222 m cell fills
            // the viewport, a "which cell is noisier" encoding has nothing left to compare,
            // and a screen of flat salmon buries the crossings the reader zoomed in to
            // look at. The outline stays, so the cell's extent is still legible.
            'fill-opacity': ['interpolate', ['linear'], ['zoom'], 15, 1, 16.5, 0],
          },
        },
        ctx.beforeId
      );
      map.addLayer(
        {
          id: `${NOISE}-outline`,
          type: 'line',
          source: NOISE,
          layout: { visibility: showNoise ? 'visible' : 'none' },
          // Every cell outlined, always. This is the relief the midpoint colour needs:
          // at 1.15:1 against the surface a midpoint cell is invisible, and without an
          // outline "measured, and unremarkable" would look identical to "not enough
          // passes to report". A cell's existence must not depend on its fill.
          paint: { 'line-color': NOISE_OUTLINE_INK, 'line-width': 1 },
        },
        ctx.beforeId
      );
      map.addLayer(
        {
          id: `${NOISE}-selected`,
          type: 'line',
          source: NOISE,
          layout: { visibility: showNoise ? 'visible' : 'none' },
          paint: { 'line-color': '#ffffff', 'line-width': 2.5 },
          filter: ['==', ['get', 'id'], selectedCell || ''],
        },
        ctx.beforeId
      );
    }

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
    //: The worm, under the one solid crossing: every loaded pass over this segment, so
    //: the bundle's width shows the disagreement between them.
    map.addSource(GHOSTS, { type: 'geojson', data: ghostData() });
    map.addLayer(
      {
        id: GHOSTS,
        type: 'line',
        source: GHOSTS,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': GHOST_INK, 'line-width': 1.5 },
      },
      ctx.beforeId
    );

    //: One crossing of a segment, over its own run. Drawn above the focused trace so the
    //: stretch being discussed is the brightest thing on screen.
    map.addSource(PASS, { type: 'geojson', data: passData() });
    map.addLayer(
      {
        id: PASS,
        type: 'line',
        source: PASS,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 3.5 },
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
    //: The noise layer and its drill-down, for `scripts/check.py`.
    hasNoise: () => Boolean(noise),
    noiseCells: () => (noise ? noise.features.length : 0),
    //: Cell properties, read from the module's own copy rather than off the MapLibre
    //: source -- `source._data` is wrapped in MapLibre 6 and reaching for it returns
    //: undefined.
    cells: () => (noise ? noise.features.map((f) => f.properties) : []),
    noiseShown: () => showNoise,
    legendRows: () => noiseLegendRows(),
    selectedCell: () => selectedCell,
    passSpan: () => passSpan,
    ghostCount: () => ghostSpans.length,
    firstCellWithPasses: () => {
      if (!noise) return null;
      const f = noise.features.find((x) => (x.properties.passes || []).length > 2);
      return f ? f.properties : null;
    },
    openSegment: (props) => openSegment(map, props),
    showPass: (pass, cell) => showPass(map, pass, cell),
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

  // The noise layer: its toggle, its legend, and the drill-down it is the entry to.
  const noiseToggle = document.getElementById('toggle-noise');
  const legendEl = document.getElementById('noise-legend');
  const noiseNote = document.getElementById('noise-note');

  if (noiseToggle) {
    if (!noise) {
      // Disabled rather than hidden: a control that is absent looks like a feature that
      // does not exist, and this one is one script away.
      noiseToggle.disabled = true;
      if (noiseNote) {
        noiseNote.textContent = 'Run noise_by_area.py to measure noise by place.';
      }
    } else {
      // Built from the same two constants the fill expression uses, so the legend cannot
      // disagree with the map about where a class starts.
      if (legendEl) {
        legendEl.replaceChildren(
          ...noiseLegendRows().map(({ colour, label }) => {
            const row = document.createElement('div');
            const swatch = document.createElement('i');
            swatch.style.background = colour;
            const text = document.createElement('span');
            // Text in text tokens, never the series colour.
            text.textContent = label;
            row.append(swatch, text);
            return row;
          })
        );
      }
      if (noiseNote) {
        // Degrees of latitude to metres, not to kilometres. This read "0.222 m across"
        // until a screenshot was looked at.
        const across = Math.round(noise.cell_deg * 111_000);
        noiseNote.textContent =
          `${noise.features.length} segments, ${across} m across, speed-adjusted.`;
      }
      noiseToggle.addEventListener('click', () => {
        showNoise = !showNoise;
        noiseToggle.setAttribute('aria-pressed', String(showNoise));
        if (legendEl) legendEl.hidden = !showNoise;
        for (const id of [NOISE_SCRIM, NOISE, `${NOISE}-outline`, `${NOISE}-selected`]) {
          if (map.getLayer(id)) {
            map.setLayoutProperty(id, 'visibility', showNoise ? 'visible' : 'none');
          }
        }
        applyTraceEmphasis(map);
        if (showNoise) goToCells(map);
      });
      if (legendEl) legendEl.hidden = true;

      map.on('click', NOISE, (event) => {
        // Only when the layer is the thing the reader is looking at. A click that lands
        // on a trace should still select the trace.
        if (!showNoise) return;
        openSegment(map, event.features[0].properties);
      });
      map.on('mouseenter', NOISE, () => {
        if (showNoise) map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', NOISE, () => {
        map.getCanvas().style.cursor = '';
      });
    }
  }

  map.on('click', HIT, (event) => {
    // With the choropleth up, the segment is the subject and a stray click on a trace
    // should not replace the panel the reader is reading.
    if (showNoise) return;
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
