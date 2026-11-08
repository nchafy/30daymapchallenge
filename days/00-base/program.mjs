/* The base map, with no thematic data on it.
 *
 * This program exists to be the reference: it exercises every part of the map layer — the
 * three basemaps, the zoom pair, the compass, the status line, the detail panel, and a
 * `draw` callback that has to survive a basemap switch — so that a day can be read against
 * something known to work.
 *
 * The one overlay is the point last clicked. It is a style layer rather than a marker on
 * purpose: `setStyle` discards style layers and leaves markers alone, so drawing the click
 * this way is what proves `draw` really is re-run when the basemap changes.
 */

import { createBaseMap, fitWindow } from '../../lib/basemap.mjs';
import { Panel } from '../../lib/panel.mjs';
import { group } from '../../vendor/webxp/webxp.mjs';

//: Where the map opens. New York at z10 because all three basemaps have good coverage
//: there, so switching between them on load shows three real maps rather than three grey
//: squares.
const CENTER = [-73.95, 40.7];
const ZOOM = 10;

const CLICKED = 'clicked-point';

export const program = {
  id: '00-base',
  name: 'Base map',
  icon: 'globe',
  // One at a time. The map layer mints per-instance ids for the handful of places ARIA
  // needs a target, so a second window would work — but two copies of the same map is a
  // pair of windows nobody wanted, and `singleton` makes a second launch raise the first.
  singleton: true,
  onDesktop: true,
  autostart: true,
  width: 900,
  height: 620,

  async mount({ win }) {
    // Before the map measures anything: a maximise changes the container size, and doing
    // it after would make MapLibre size itself twice.
    fitWindow(win);
    //: The last clicked position, kept outside `draw` because `draw` is re-run from
    //: scratch on every basemap change and must be able to put the point back.
    let clicked = null;

    const clickedData = () => ({
      type: 'FeatureCollection',
      features: clicked
        ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: clicked }, properties: {} }]
        : [],
    });

    const base = await createBaseMap({
      root: win.bodyEl,
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
              // Two circles rather than one with a stroke: a stroke scales with the circle
              // and this ring has to stay readable over imagery, where a thin line goes.
              'circle-radius': 11,
              'circle-color': 'rgba(232, 67, 31, 0.25)',
              'circle-stroke-width': 2,
              // White over satellite, where the era's navy would vanish into the water.
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

    if (!base) {
      // `createBaseMap` has already put the reason in its own status line, which is inside
      // the frame it built. Returning that frame shows it rather than an empty window.
      return win.bodyEl.firstElementChild;
    }

    const { map } = base;
    const panel = new Panel(base.chrome.detail);

    // The program owns what it started. webxp destroys the window's DOM but knows nothing
    // about a WebGL context or a ResizeObserver.
    win.onClose = () => base.destroy();

    //: On `window` deliberately: it is how you poke at the map from the devtools console,
    //: and it is what `scripts/check.py` queries to prove the overlay survived a basemap
    //: switch. Nothing on the page reads it.
    window.base = base;

    map.on('click', (event) => {
      clicked = [event.lngLat.lng, event.lngLat.lat];
      const source = map.getSource(CLICKED);
      if (source) source.setData(clickedData());
      showCoordinate(event.lngLat);
    });

    // Dismissing the panel also takes the point away: a ring left behind points at a
    // question that is no longer on screen.
    panel.onClose = () => {
      clicked = null;
      const source = map.getSource(CLICKED);
      if (source) source.setData(clickedData());
    };

    function showCoordinate(lngLat) {
      panel.open(
        'Position',
        [
          group('Coordinate', {
            columns: ['Field', 'Value'],
            rows: [
              // Six decimal places is about 0.1 m at this latitude: past that the figure
              // claims a precision no basemap here has.
              ['Latitude', lngLat.lat.toFixed(6)],
              ['Longitude', lngLat.lng.toFixed(6)],
              ['Zoom', map.getZoom().toFixed(2)],
              ['Basemap', base.basemap],
            ],
          }),
          group('Elsewhere', [
            {
              text: 'This point on OpenStreetMap',
              href:
                `https://www.openstreetmap.org/#map=${Math.round(map.getZoom())}`
                + `/${lngLat.lat.toFixed(5)}/${lngLat.lng.toFixed(5)}`,
            },
          ]),
        ],
        'Read off the map, not from a geocoder — the figures are the camera’s, not a source’s.'
      );
    }

    // The frame `createBaseMap` built is the window's content.
    return base.chrome.frame;
  },
};
