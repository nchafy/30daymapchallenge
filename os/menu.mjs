/* The Start menu: a list of the host's entries, and the ways out of it.
 *
 * Knows nothing about what the entries are. It used to render this project's thirty
 * challenge days, from a catalogue it imported itself, which meant any host that put
 * `#start` and `#start-menu` in its markup got thirty links to pages it does not have.
 */

import { isAvailable, usableEntries } from './entries.mjs';

/* One row. A link when the entry is available, a span when it is not: an entry with no
 * target is not a target, and the muted colour says so without a label repeating it. */
function row(entry, here) {
  const item = document.createElement('li');

  const badge = document.createElement('span');
  badge.className = 'n';
  badge.textContent = entry.badge || '—';

  const label = document.createElement('span');
  label.className = 'theme';
  label.textContent = entry.label;

  if (!isAvailable(entry)) {
    const dead = document.createElement('span');
    dead.className = 'todo';
    dead.append(badge, label);
    item.append(dead);
    return item;
  }

  const link = document.createElement('a');
  link.href = entry.href;
  if (entry.id === here) link.setAttribute('aria-current', 'page');
  link.append(badge, label);
  item.append(link);
  return item;
}

/**
 * Fill an `<ol>` with the host's entries.
 *
 * Exported because the Start menu and anything else showing the same list have to agree,
 * and two renderers of one list is how they stop agreeing.
 *
 * @param {HTMLElement} list     The `<ol>` to fill.
 * @param {object[]} entries
 * @param {string} [here]        The current id, marked `aria-current`.
 */
export function renderMenu(list, entries, here) {
  if (!list) return;
  list.replaceChildren(
    ...usableEntries(entries, 'renderMenu').map((entry) => row(entry, here))
  );
}

/**
 * Wire the Start button and its menu.
 *
 * @returns {() => void} a function that closes the menu, for a host that needs to.
 */
export function mountMenu({ start, menu, entries, here }) {
  renderMenu(menu.querySelector('ol'), entries, here);

  const setOpen = (open) => {
    menu.hidden = !open;
    start.setAttribute('aria-expanded', String(open));
    if (open) {
      // Focus the first reachable row, so the keyboard lands inside the menu it opened.
      const target = menu.querySelector('a');
      if (target) target.focus();
    }
  };

  start.addEventListener('click', () => setOpen(menu.hidden));

  // Escape closes and returns focus to the button that opened it, which is the only way
  // back for a keyboard once focus has moved into the menu.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || menu.hidden) return;
    setOpen(false);
    start.focus();
  });

  // A click anywhere else closes it. `pointerdown` rather than `click`, so the menu is
  // gone before a click on an app's canvas is interpreted by the app.
  document.addEventListener('pointerdown', (event) => {
    if (menu.hidden) return;
    if (menu.contains(event.target) || start.contains(event.target)) return;
    setOpen(false);
  });

  return () => setOpen(false);
}
