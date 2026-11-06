/* The desktop. No map, so no MapLibre: the shell, and an icon per day.
 *
 * One deliberate departure from what is being imitated: an icon opens on a single
 * activation, not a double click. XP wanted two, but a target that needs a double click is
 * unreachable by a keyboard, awkward on touch, and the single most common thing people get
 * wrong when they rebuild this. Each icon is a link, so Enter and a tap both work.
 */

import { mountChrome } from './chrome.mjs';
import { DAYS, BASE_ENTRY } from './days.mjs';

/* One desktop icon.
 *
 * A day with a page is a link. A day without one is a span: it is not a target, and the
 * greyed art says so without a label that repeats it. */
function icon(entry) {
  const item = document.createElement('li');
  item.className = 'icon';

  const art = document.createElement('span');
  art.className = entry.day === 0 ? 'icon-art is-base' : 'icon-art';
  if (entry.day > 0) {
    // The badge is drawn by CSS from this attribute. Thirty icons of the same file type
    // would be the right imitation and the wrong interface: the number is how the reader
    // tells them apart.
    art.dataset.n = String(entry.day).padStart(2, '0');
  }

  const label = document.createElement('span');
  label.className = 'icon-label';
  label.textContent = entry.day === 0 ? entry.theme : `Day ${String(entry.day).padStart(2, '0')} — ${entry.theme}`;

  if (!entry.dir) {
    const dead = document.createElement('span');
    dead.className = 'icon-link is-todo';
    dead.append(art, label);
    item.append(dead);
    return item;
  }

  const link = document.createElement('a');
  link.className = 'icon-link';
  link.href = `/days/${entry.dir}/`;
  link.append(art, label);
  item.append(link);
  return item;
}

function renderDesktop(list) {
  if (!list) return;
  list.replaceChildren(icon(BASE_ENTRY), ...DAYS.map(icon));
}

// `mountChrome` already fills the Start menu with the same list, through the same
// `renderDayList` the day pages use. Calling it again here would be a second renderer of
// one list, which is how the two drift apart.
mountChrome();
renderDesktop(document.getElementById('icons'));
