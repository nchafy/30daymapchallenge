/* Which days are open, and the taskbar that shows them.
 *
 * Each day is its own page, so "open windows" cannot be a variable — a navigation throws
 * every variable away. The list lives in `localStorage` and every page rebuilds the bar
 * from it on load. That is what makes the metaphor hold: opening three days and coming
 * back to the desktop leaves three buttons in the bar, because the bar is reading a list
 * rather than remembering a session.
 *
 * A day page registers itself when it loads, so however the reader got there — a desktop
 * icon, the Start menu, a bookmark, the back button — the window is open and the bar says
 * so. Nothing has to be kept in step by hand.
 */

import { DAYS, BASE_ENTRY } from './days.mjs';

const STORE_KEY = '30dmc:open';

//: Every entry that has a page, by folder name. Built from `days.mjs` rather than written
//: out again, so a day gaining a page needs no edit here.
const ENTRIES = new Map(
  [BASE_ENTRY, ...DAYS].filter((entry) => entry.dir).map((entry) => [entry.dir, entry])
);

/** The label on a taskbar button and on a window's title bar. */
export function labelFor(dir) {
  const entry = ENTRIES.get(dir);
  if (!entry) return dir;
  if (entry.day === 0) return entry.theme;
  return `Day ${String(entry.day).padStart(2, '0')} — ${entry.theme}`;
}

//: Falls back to an in-memory list when `localStorage` throws, which it does in a private
//: window and when a browser is configured to refuse it. The bar then works for one page
//: instead of not at all, and nothing else on the page cares.
let memory = [];
let usingMemory = false;

function read() {
  if (usingMemory) return memory.slice();
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    // Anything no longer a real day is dropped on read, so a renamed folder or a stale
    // entry from an older version cannot put a dead button in the bar.
    return Array.isArray(list) ? list.filter((dir) => ENTRIES.has(dir)) : [];
  } catch {
    usingMemory = true;
    return memory.slice();
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

/** The folders currently open, in the order they were opened. */
export function openWindows() {
  return read();
}

/** Note a day as open. Opening one that is already open changes nothing. */
export function openWindow(dir) {
  if (!ENTRIES.has(dir)) return;
  const list = read();
  if (!list.includes(dir)) {
    list.push(dir);
    write(list);
  }
}

/** Forget a day. Returns what is left open. */
export function closeWindow(dir) {
  const list = read().filter((entry) => entry !== dir);
  write(list);
  return list;
}

export function closeAll() {
  write([]);
}

/* One button: a link that goes to the day, and a close box that forgets it.
 *
 * The close box is a sibling of the link rather than inside it. A button nested in an
 * anchor is invalid, and more to the point a click on it would follow the link as well as
 * close the window. */
function taskButton(dir, here, onChange) {
  const label = labelFor(dir);
  const wrap = document.createElement('span');
  wrap.className = 'task-button';
  if (dir === here) wrap.dataset.current = 'true';

  const link = document.createElement('a');
  link.href = `/days/${dir}/`;
  link.className = 'task-label';
  link.textContent = label;
  if (dir === here) link.setAttribute('aria-current', 'page');

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'task-close';
  // Names the window, because "Close" repeated across eight buttons tells a screen reader
  // nothing about which one it is on.
  close.setAttribute('aria-label', `Close ${label}`);
  close.textContent = '✕';
  close.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeWindow(dir);
    // Closing the window you are looking at has to leave the screen, or the bar would
    // disagree with what is on it.
    if (dir === here) {
      window.location.href = '/';
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
 * @param {HTMLElement} container  The `.task-items` element.
 * @param {string} [here]          The current day's folder, drawn as the pressed button.
 */
export function renderTaskbar(container, here) {
  if (!container) return;
  const rerender = () => renderTaskbar(container, here);
  const list = openWindows();
  if (!list.length) {
    container.replaceChildren();
    return;
  }
  container.replaceChildren(...list.map((dir) => taskButton(dir, here, rerender)));
}
