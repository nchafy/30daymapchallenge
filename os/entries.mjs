/* What the OS is given to show. The whole contract between the shell and its host.
 *
 * The shell draws a desktop of icons, a taskbar of open windows and a Start menu. It does
 * not know what any of them are. A host hands it entries; everything else follows.
 *
 * An entry is:
 *
 *     {
 *       id,          // stable, unique. The key the open-window list stores.
 *       label,       // what the reader sees, in all three places.
 *       href,        // where activating it goes. Omit for an entry that is not a target.
 *       kind,        // optional. Picks the icon art; unknown kinds get the default.
 *       badge,       // optional. A short string drawn on the icon's corner.
 *     }
 *
 * `href` absent means "listed but not available" — the icon greys out and the Start menu
 * renders it as text rather than a dead link. That is a state worth having: this project's
 * desktop shows all thirty challenge days from the first one, and twenty-nine of them have
 * no page yet.
 *
 * ## Why this file exists
 *
 * The shell used to `import { DAYS } from './days.mjs'` and build `/days/${dir}/` URLs by
 * hand, in three separate modules. That made it unusable by anything other than this one
 * site: a host with four destinations and different URLs got thirty links to pages it does
 * not have. It also made `days.mjs` a required file for any page that wanted only the
 * clock, because a top-level import has to resolve whether or not anything reads it.
 *
 * So nothing under `os/` imports a catalogue. Entries arrive as arguments.
 */

/** The icon art a `kind` maps to. A host may use any string; unknown falls back. */
export const KINDS = ['map', 'globe', 'doc'];
export const DEFAULT_KIND = 'doc';

/** True when an entry can be activated. */
export function isAvailable(entry) {
  return Boolean(entry && entry.href);
}

/**
 * Reject anything that is not a usable entry, loudly enough to debug.
 *
 * Called by the renderers rather than trusted, because the failure mode of a bad entry is
 * a silently missing icon, and the host that passed it has no way to see that.
 *
 * @param {object[]} entries
 * @param {string} where  Named in the warning, so the caller is identifiable.
 */
export function usableEntries(entries, where) {
  if (!Array.isArray(entries)) {
    console.warn(`${where}: entries is not an array`, entries);
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) {
      console.warn(`${where}: entry has no id`, entry);
      continue;
    }
    if (seen.has(entry.id)) {
      // Two entries with one id would make the open-window list ambiguous.
      console.warn(`${where}: duplicate entry id ${entry.id}`);
      continue;
    }
    if (typeof entry.label !== 'string' || !entry.label) {
      console.warn(`${where}: entry ${entry.id} has no label`);
      continue;
    }
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

/** Index entries by id, for looking up a label from a stored id. */
export function byId(entries, where = 'byId') {
  return new Map(usableEntries(entries, where).map((entry) => [entry.id, entry]));
}
