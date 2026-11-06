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
 *       kind,        // optional. Picks the icon art from the stylesheet.
 *       icon,        // optional. A Node, or a function returning one, used instead.
 *       badge,       // optional. A short string drawn on the icon's corner.
 *     }
 *
 * ## `kind` versus `icon`, and why both exist
 *
 * `kind` is cheap: the stylesheet draws the art as a `data:image/svg+xml` background, so
 * thirty-one icons cost no requests and the markup stays empty.
 *
 * It is also unusable under a strict Content-Security-Policy. `img-src` governs images
 * loaded from CSS, not only from markup, so under `img-src 'self'` with no `data:` every
 * icon renders as a 32px nothing -- the element is there, the computed
 * `background-image` is correct, and the box is blank. A consumer of this shell hit
 * exactly that.
 *
 * Whether anything says so depends on the policy. `os/conformance-csp.html` delivers it
 * as a `<meta>` with `default-src 'self'` and Chrome logs the refusal; the same blank icon
 * under a header-delivered `default-src 'none'; img-src 'self'` was measured with no
 * console output at all. Assume blank and silent.
 *
 * So `icon` is the escape hatch: give an entry a Node and `renderDesktop` puts that in the
 * art slot and tells the stylesheet to draw no background. An inline `<svg>` built with
 * `createElementNS` needs no fetch and no policy exception.
 *
 * **A Node, never a string.** Nothing in this shell reaches the page as markup, and an
 * `<svg>` string from a host would be an injection vector wearing a convenience API. A
 * host that has a string already can parse it itself and own that decision.
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
 * An entry's own icon node, or null to let the stylesheet draw it.
 *
 * A function is called once per render, so a host can hand the same entry to the desktop
 * and the Start menu without one of them getting an already-parented node -- appending a
 * Node moves it, so sharing one instance between two slots silently empties the first.
 *
 * @returns {Node|null}
 */
export function iconNode(entry, where = 'iconNode') {
  const source = entry && entry.icon;
  if (!source) return null;
  const node = typeof source === 'function' ? source(entry) : source;
  if (node instanceof Node) return node;
  // A string is the likely mistake, and silently ignoring it means a blank icon with no
  // explanation. Say which entry, and why.
  console.warn(
    `${where}: entry ${entry.id} has an icon that is not a Node ` +
      `(${typeof node}). Build one with document.createElementNS; a markup string is ` +
      `not accepted.`
  );
  return null;
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
