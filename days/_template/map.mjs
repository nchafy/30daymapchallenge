/* Day NN — THEME.
 *
 * `draw` is called once per basemap load, against a fresh and empty style, so it may add
 * sources and layers unconditionally. Anything that has to survive a basemap switch —
 * selection, a filter, a clicked point — lives in a variable outside it and is read back in.
 */

import { createBaseMap } from '../../assets/basemap.mjs';
import { mountChrome, group } from '../../assets/chrome.mjs';

const { panel } = mountChrome({ here: 'NN-slug' });

const base = await createBaseMap({
  container: 'map',
  center: [-73.95, 40.7],
  zoom: 10,
  // `basemap: 'satellite'` opens on a specific one instead of the reader's last choice.

  draw(map, ctx) {
    // map.addSource('thing', { type: 'geojson', data: './thing.geo.json' });
    // map.addLayer({
    //   id: 'thing',
    //   type: 'circle',
    //   source: 'thing',
    //   paint: { 'circle-radius': 4, 'circle-color': '#e8431f' },
    // }, ctx.beforeId);   // beforeId keeps place labels above the overlay
  },
});

if (base) {
  const { map } = base;
  // On `window` deliberately: it is how you poke at the map from the devtools console, and
  // what `scripts/check.py` queries. Nothing on the page reads it.
  window.base = base;

  // map.on('click', 'thing', (event) => {
  //   const props = event.features[0].properties;
  //   panel.open(props.name, [group('Detail', [props.note])]);
  // });
}
