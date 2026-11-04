/* The base map, with no thematic data on it.
 *
 * This page exists to be the reference: it exercises every part of the shell — the three
 * basemaps, the zoom buttons, the status line, the detail panel and a `draw` callback that
 * has to survive a basemap switch — so that a day's page can be read against something
 * known to work.
 *
 * The one overlay is the point last clicked. It is a style layer rather than a marker on
 * purpose: `setStyle` discards style layers and leaves markers alone, so drawing the click
 * this way is what proves `draw` really is re-run when the basemap changes.
 */

import { createBaseMap } from '../../assets/basemap.mjs';
import { mountChrome, group } from '../../assets/chrome.mjs';

const { panel } = mountChrome({ here: '00-base' });

//: Where the map opens. New York at z10 because all three basemaps have good coverage there,
//: so switching between them on load shows three real maps rather than three grey squares.
//: This and `zoom` are the two knobs a day changes first.
const CENTER = [-73.95, 40.7];
const ZOOM = 10;

const CLICKED = 'clicked-point';

//: The last clicked position, kept outside `draw` because `draw` is re-run from scratch on
//: every basemap change and must be able to put the point back.
let clicked = null;

function clickedData() {
  return {
    type: 'FeatureCollection',
    features: clicked
      ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: clicked }, properties: {} }]
      : [],
  };
}

const base = await createBaseMap({
  container: 'map',
  center: CENTER,
  zoom: ZOOM,

  draw(map, ctx) {
    map.addSource(CLICKED, { type: 'geojson', data: clickedData() });
    map.addLayer(
      {
        id: `${CLICKED}-halo`,
        type: 'circle',
        source: CLICKED,
        paint: {
          // Two circles rather than one with a stroke: a stroke scales with the circle and
          // this ring has to stay readable over imagery, where a thin line disappears.
          'circle-radius': 11,
          'circle-color': 'rgba(232, 67, 31, 0.25)',
          'circle-stroke-width': 2,
          // White over satellite, where the era's navy would vanish into the water; the
          // dark outline reads on the two pale basemaps.
          'circle-stroke-color': ctx.basemap === 'satellite' ? '#ffffff' : '#13264a',
        },
      },
      ctx.beforeId
    );
    map.addLayer(
      {
        id: CLICKED,
        type: 'circle',
        source: CLICKED,
        paint: { 'circle-radius': 4, 'circle-color': '#e8431f' },
      },
      ctx.beforeId
    );
  },
});

if (base) {
  const { map } = base;

  // On `window` deliberately, in every day: it is how you poke at the map from the devtools
  // console, and it is what `scripts/check.py` queries to prove the overlay survived a
  // basemap switch. Nothing on the page reads it.
  window.base = base;

  map.on('click', (event) => {
    clicked = [event.lngLat.lng, event.lngLat.lat];
    const source = map.getSource(CLICKED);
    if (source) source.setData(clickedData());
    showCoordinate(event.lngLat);
  });

  // Dismissing the panel also takes the point away: a ring left behind points at a question
  // that is no longer on screen.
  if (panel) {
    panel.onClose = () => {
      clicked = null;
      const source = map.getSource(CLICKED);
      if (source) source.setData(clickedData());
    };
  }

  function showCoordinate(lngLat) {
    if (!panel) return;
    const lat = lngLat.lat;
    const lon = lngLat.lng;
    panel.open(
      'Position',
      [
        group('Coordinate', {
          columns: ['Field', 'Value'],
          rows: [
            // Six decimal places is about 0.1 m at this latitude: past that the figure
            // claims a precision no basemap here has.
            ['Latitude', lat.toFixed(6)],
            ['Longitude', lon.toFixed(6)],
            ['Zoom', map.getZoom().toFixed(2)],
            ['Basemap', base.basemap],
          ],
        }),
        group('Elsewhere', [
          {
            text: 'This point on OpenStreetMap',
            href: `https://www.openstreetmap.org/#map=${Math.round(map.getZoom())}/${lat.toFixed(5)}/${lon.toFixed(5)}`,
          },
        ]),
      ],
      'Read off the map, not from a geocoder — the figures are the camera’s, not a source’s.'
    );
  }
}
