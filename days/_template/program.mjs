/* Day NN — THEME.
 *
 * Copy this folder to `days/NN-THEME-SLUG/`, then:
 *
 *   1. Replace `NN` and `THEME` below, and `NN-THEME-SLUG` with the folder name.
 *   2. Set `dir` to the same folder name on this day's row in `days/themes.mjs`.
 *   3. Import this program in `programs.mjs` and add it to `BUILT` under that same name.
 *   4. Write the overlay in `draw`.
 *
 * All three strings MUST agree. `id` is what the taskbar, the Start menu and the desktop
 * icon key off, and a mismatch shows up as a day that opens a "not built yet" window while
 * the program sits unused.
 *
 * `draw` is called once per basemap load, against a fresh and empty style, so it may add
 * sources and layers unconditionally. Anything that has to survive a basemap switch --
 * a selection, a filter, a clicked point -- lives in a variable outside it and is read back
 * in. `days/00-base/program.mjs` does exactly that with its clicked point.
 */

import { createBaseMap, fitWindow } from '../../lib/basemap.mjs';
import { Panel } from '../../lib/panel.mjs';
import { group } from '../../vendor/webxp/webxp.mjs';

export const program = {
  id: 'NN-THEME-SLUG',
  name: 'Day NN — THEME',
  icon: 'document',
  // One window per day. The map layer mints per-instance ids where ARIA needs a target, so
  // a second would work; two copies of one map is just a pair of windows nobody wanted.
  singleton: true,
  onDesktop: true,
  width: 900,
  height: 620,

  async mount({ win }) {
    // Before the map measures anything: a maximise changes the container size, and doing
    // it after would make MapLibre size itself twice.
    fitWindow(win);
    const base = await createBaseMap({
      root: win.bodyEl,
      center: [-73.95, 40.7],
      zoom: 10,
      // `basemap: 'satellite'` opens on a specific one instead of the reader's last choice.
      // `tilt: false` for a day that must stay flat and north-up; it hides the Tilt button
      // and the compass too, because a compass that indicates something you cannot change
      // is furniture.

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

    if (!base) {
      // The factory has already put the reason in the status line inside the frame it
      // built, so returning that frame shows it rather than an empty window.
      return win.bodyEl.firstElementChild;
    }
    // A window closed during the await never gets `setContent`, so its `onClose` has
    // already fired and would never reach the handler below.
    if (!win.isOpen) {
      base.destroy();
      return null;
    }

    const { map } = base;
    const panel = new Panel(base.chrome.detail);

    // The program owns what it started. webxp destroys the window's DOM but knows nothing
    // about a WebGL context or a ResizeObserver.
    win.onClose = () => base.destroy();

    //: On `window` deliberately, in every day: it is how you poke at the map from the
    //: devtools console, and it is what `scripts/check.py` queries. Nothing reads it.
    window.base = base;

    // This day's own controls go in the slot the factory left:
    //   const card = document.createElement('div');
    //   card.className = 'card';
    //   base.chrome.cards.append(card);

    // map.on('click', 'thing', (event) => {
    //   const props = event.features[0].properties;
    //   panel.open(props.name, [group('Detail', [props.note])]);
    // });

    return base.chrome.frame;
  },
};
