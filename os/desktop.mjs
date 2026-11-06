/* The desktop: one icon per entry.
 *
 * One deliberate departure from what is being imitated: an icon opens on a single
 * activation, not a double click. XP wanted two, but a target that needs a double click is
 * unreachable by a keyboard, awkward on touch, and the single most common thing people get
 * wrong when they rebuild this. Each icon is a link, so Enter and a tap both work.
 */

import { DEFAULT_KIND, iconNode, isAvailable, usableEntries } from './entries.mjs';

/* One icon.
 *
 * An available entry is a link. One without an `href` is a span: it is not a target, and
 * the greyed art says so without a label that repeats it. */
function icon(entry) {
  const item = document.createElement('li');
  item.className = 'icon';

  const art = document.createElement('span');
  art.className = 'icon-art';

  const own = iconNode(entry, 'renderDesktop');
  if (own) {
    // The host supplied the art. `data-art="node"` is what tells the stylesheet not to
    // also paint a background behind it, and it is what lets this work under a
    // Content-Security-Policy that forbids `data:` images -- see `entries.mjs`.
    art.dataset.art = 'node';
    art.append(own);
  } else {
    // The stylesheet picks the art from this. An unknown kind gets the default rather
    // than no background at all, which would be an invisible icon.
    art.dataset.kind = entry.kind || DEFAULT_KIND;
  }

  if (entry.badge) {
    // Thirty icons of one kind would be the right imitation and the wrong interface: the
    // badge is how a reader tells them apart.
    art.dataset.n = entry.badge;
  }

  const label = document.createElement('span');
  label.className = 'icon-label';
  label.textContent = entry.label;

  if (!isAvailable(entry)) {
    const dead = document.createElement('span');
    dead.className = 'icon-link is-todo';
    dead.append(art, label);
    item.append(dead);
    return item;
  }

  const link = document.createElement('a');
  link.className = 'icon-link';
  link.href = entry.href;
  link.append(art, label);
  item.append(link);
  return item;
}

/**
 * Fill a `<ul>` with one icon per entry.
 *
 * @param {HTMLElement} list
 * @param {object[]} entries
 */
export function renderDesktop(list, entries) {
  if (!list) return;
  list.replaceChildren(
    ...usableEntries(entries, 'renderDesktop').map(icon)
  );
}
