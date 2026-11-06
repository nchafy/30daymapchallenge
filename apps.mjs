/* This site's apps, as the OS wants them.
 *
 * The one file that knows both halves. `os/` draws a desktop, a taskbar and a Start menu
 * from entries and has no idea what a challenge day is; `days/themes.mjs` is the thirty
 * themes and has no idea what an icon is. This turns one into the other.
 *
 * Adding a day is still two edits and neither of them is here: set `dir` on its row in
 * `days/themes.mjs`, and pass the same string as `here` when the page mounts the shell.
 */

import { DAYS, BASE_ENTRY } from './days/themes.mjs';

/** The id, and the `here` a day's page must pass. The folder name under `days/`. */
function idFor(entry) {
  return entry.dir || `day-${entry.day}`;
}

function toEntry(entry) {
  return {
    id: idFor(entry),
    label:
      entry.day === 0
        ? entry.theme
        : `Day ${String(entry.day).padStart(2, '0')} — ${entry.theme}`,
    // No `href` is what makes an entry unavailable: the icon greys and the Start menu
    // renders it as text. Twenty-nine of the thirty start out that way.
    href: entry.dir ? `/days/${entry.dir}/` : undefined,
    // The base map is not one of the thirty, and an icon that says so saves a reader
    // working it out from the label.
    kind: entry.day === 0 ? 'globe' : 'map',
    badge: entry.day === 0 ? undefined : String(entry.day).padStart(2, '0'),
  };
}

/** The base map, then the thirty days, in order. */
export const APPS = [BASE_ENTRY, ...DAYS].map(toEntry);

/** Every app's id, for a page that wants to assert its own `here` is one of them. */
export const APP_IDS = APPS.map((entry) => entry.id);
