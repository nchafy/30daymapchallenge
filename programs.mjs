/* This site's programs, as webxp wants them.
 *
 * The one file that knows both halves. `vendor/webxp/` draws a desktop, a taskbar and a
 * Start menu from program specs and has no idea what a challenge day is; `days/themes.mjs`
 * is the thirty themes and has no idea what a window is. This turns one into the other.
 *
 * A day that has been built exports a `program` from its own folder and is listed here. A
 * day that has not is still registered -- it gets a desktop icon and a Start menu row that
 * open a window saying so, which is better than a missing icon, because twenty-nine missing
 * icons look like a broken desktop rather than an unwritten challenge.
 */

import { group, sheet } from './vendor/webxp/webxp.mjs';
import { DAYS, BASE_ENTRY } from './days/themes.mjs';

import { program as basemapProgram } from './days/00-base/program.mjs';
import { program as linesProgram } from './days/02-lines/program.mjs';

//: Keyed by the folder name under `days/`, which is also the `dir` in `themes.mjs` and the
//: program's `id`. One string, three jobs, so there is nothing to keep in step.
const BUILT = {
  '00-base': basemapProgram,
  '02-lines': linesProgram,
};

/** The window a day gets before it has been written. */
function placeholder(entry) {
  const label = `Day ${String(entry.day).padStart(2, '0')} — ${entry.theme}`;
  return {
    id: `day-${entry.day}`,
    name: label,
    icon: 'document',
    singleton: true,
    onDesktop: true,
    width: 420,
    height: 240,
    mount() {
      return sheet([
        group(entry.theme, [
          `Day ${entry.day} of the challenge. Not built yet.`,
          'Copy days/_template to days/NN-slug, export a program from it, and list it in '
            + 'programs.mjs.',
        ]),
      ]);
    },
  };
}

function toProgram(entry) {
  const built = entry.dir && BUILT[entry.dir];
  if (built) return built;
  if (entry.day === 0) {
    // The base map is the one entry that must exist; a missing program here is a bug, not
    // an unwritten day.
    throw new Error('days/00-base/program.mjs did not export a program');
  }
  return placeholder(entry);
}

/** The base map, then the thirty days, in order. */
export const PROGRAMS = [BASE_ENTRY, ...DAYS].map(toProgram);
