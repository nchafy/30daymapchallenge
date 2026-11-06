/* Which windows are open, and the buttons in the bar.
 *
 * Each app is its own page, so "open windows" cannot be a variable — a navigation throws
 * every variable away. The list lives in `localStorage` and every page rebuilds the bar
 * from it on load. That is what makes the metaphor hold: opening three windows and going
 * back to the desktop leaves three buttons in the bar, because the bar is reading a list
 * rather than remembering a session.
 *
 * ## The bar is opt-in
 *
 * `renderTaskbar` is only called when a host passes entries. A host that server-renders
 * its own taskbar — so that it works with no JavaScript — must be able to mount the rest
 * of the shell without having its markup replaced.
 *
 * This was a real bug, not a hypothetical: the previous `mountChrome` called `renderTaskbar`
 * unconditionally, `renderTaskbar` called `container.replaceChildren()` when the open list
 * was empty, and the open list was filtered against this project's own day catalogue. For
 * any other host every stored id failed that filter, so the list was always empty and the
 * bar was always erased. "I have no windows to show" and "I was not asked to manage this
 * bar" are different states, and only the second should leave existing markup alone.
 */

import { byId, usableEntries } from './entries.mjs';

const STORE_KEY = '30dmc:open';

//: Falls back to an in-memory list when `localStorage` cannot be reached, which happens in
//: a private window and when a browser is configured to refuse it. The bar then works for
//: one page instead of not at all, and nothing else on the page cares.
let memory = [];
let usingMemory = false;

function read(known) {
  if (usingMemory) return memory.slice();
  let raw;
  // Only a failure to *reach* storage means storage is unavailable. Reading and then
  // failing to parse means the value is damaged, which is a different problem with a
  // different fix -- and conflating the two used to latch `usingMemory` permanently, so a
  // single corrupt value stopped the bar persisting in that browser for good, with the bad
  // key still sitting there.
  try {
    raw = window.localStorage.getItem(STORE_KEY);
  } catch {
    usingMemory = true;
    return memory.slice();
  }
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    // An id the host does not know about is dropped on read, so a renamed app or a stale
    // entry from an older version cannot put a dead button in the bar. With no catalogue
    // to check against, every id is kept -- filtering on an empty set is how the bar used
    // to erase itself for every host but one.
    return known ? list.filter((id) => known.has(id)) : list;
  } catch {
    // Damaged beyond use. Clear it rather than work around it forever.
    try {
      window.localStorage.removeItem(STORE_KEY);
    } catch {
      usingMemory = true;
    }
    return [];
  }
}

function write(list) {
  memory = list.slice();
  if (usingMemory) return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    usingMemory = true;
  }
}

/**
 * The ids currently open, in the order they were opened.
 *
 * @param {object[]} [entries]  When given, ids not among them are dropped.
 */
export function openWindows(entries) {
  return read(entries ? byId(entries, 'openWindows') : null);
}

/**
 * Note an id as open. Opening one that is already open changes nothing.
 *
 * @param {string} id
 * @param {object[]} [entries]  When given, an unknown id is refused.
 */
export function openWindow(id, entries) {
  if (!id) return;
  const known = entries ? byId(entries, 'openWindow') : null;
  if (known && !known.has(id)) {
    // Worth saying out loud: the symptom is a window that never gets a taskbar button,
    // with nothing else wrong, and the cause is two files disagreeing about an id.
    console.warn(`openWindow: ${id} is not in the entry list, so it gets no taskbar button`);
    return;
  }
  const list = read(known);
  if (!list.includes(id)) {
    list.push(id);
    write(list);
  }
}

/** Forget an id. Returns what is left open. */
export function closeWindow(id) {
  const list = read(null).filter((entry) => entry !== id);
  write(list);
  return list;
}

/* One button: a link to the window, and a close box that forgets it.
 *
 * The close box is a sibling of the link rather than inside it. A button nested in an
 * anchor is invalid, and a click on it would follow the link as well as close the window. */
function taskButton(entry, here, onChange, homeHref) {
  const wrap = document.createElement('span');
  wrap.className = 'task-button';
  if (entry.id === here) wrap.dataset.current = 'true';

  const link = document.createElement('a');
  link.href = entry.href || '#';
  link.className = 'task-label';
  link.textContent = entry.label;
  if (entry.id === here) link.setAttribute('aria-current', 'page');

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'task-close';
  // Names the window, because "Close" repeated across eight buttons tells a screen reader
  // nothing about which one it is on.
  close.setAttribute('aria-label', `Close ${entry.label}`);
  close.textContent = '✕';
  close.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeWindow(entry.id);
    // Closing the window you are looking at has to leave the screen, or the bar would
    // disagree with what is on it.
    if (entry.id === here) {
      window.location.href = homeHref;
      return;
    }
    if (onChange) onChange();
  });

  wrap.append(link, close);
  return wrap;
}

/**
 * Fill the taskbar's window-button area.
 *
 * Only ever called with entries. A host that manages its own bar never reaches here, so
 * its markup is untouched.
 *
 * @param {HTMLElement} container  The `.task-items` element.
 * @param {object} options
 * @param {object[]} options.entries   The host's entries, for labels and for validation.
 * @param {string} [options.here]      The current id, drawn as the pressed button.
 * @param {string} [options.homeHref]  Where closing the current window goes. Default `/`.
 */
export function renderTaskbar(container, { entries, here, homeHref = '/' } = {}) {
  if (!container) return;
  const known = byId(usableEntries(entries, 'renderTaskbar'), 'renderTaskbar');
  const rerender = () => renderTaskbar(container, { entries, here, homeHref });
  const open = read(known);
  container.replaceChildren(
    ...open
      .map((id) => known.get(id))
      .filter(Boolean)
      .map((entry) => taskButton(entry, here, rerender, homeHref))
  );
}
