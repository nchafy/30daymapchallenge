/* The Windows XP shell: taskbar clock, the Start menu as a day index, and the detail panel.
 *
 * Everything here is chrome. A day's page gets a working map whether or not this module
 * loads, which is why it is a separate import and why nothing in `basemap.mjs` depends on it.
 *
 * Nothing reaches the page as markup: every node is built with DOM calls and `textContent`.
 */

import { DAYS, BASE_ENTRY } from './days.mjs';

/* ---------------------------------------------------------------------------
   The taskbar clock.
   --------------------------------------------------------------------------- */

/** XP's tray clock: hours and minutes, 12-hour, no seconds. */
function tick(element) {
  const now = new Date();
  element.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  // Scheduled to the next minute boundary rather than every second: a clock with no seconds
  // hand has nothing to say in between, and a 1 s interval wakes the page 60x for nothing.
  const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
  setTimeout(() => tick(element), msToNextMinute + 50);
}

/* ---------------------------------------------------------------------------
   The Start menu, which is the day index.
   --------------------------------------------------------------------------- */

/** One row: the day number, its theme, and a link if the day has a page. */
function dayRow(entry, here) {
  const item = document.createElement('li');
  const n = document.createElement('span');
  n.className = 'n';
  n.textContent = entry.day === 0 ? '—' : String(entry.day).padStart(2, '0');
  const theme = document.createElement('span');
  theme.className = 'theme';
  theme.textContent = entry.theme;

  if (!entry.dir) {
    // A span, not a link: a day with no page yet is not a target, and the muted colour says
    // so without needing a label that repeats it.
    const row = document.createElement('span');
    row.className = 'todo';
    row.append(n, theme);
    item.append(row);
    return item;
  }

  const link = document.createElement('a');
  link.href = `/days/${entry.dir}/`;
  if (entry.dir === here) link.setAttribute('aria-current', 'page');
  link.append(n, theme);
  item.append(link);
  return item;
}

/**
 * Fill an `<ol>` with the base map and the thirty days.
 *
 * Exported because the Start menu and the index page show the same list, and two renderers
 * of one list is how they drift apart.
 *
 * @param {HTMLElement} list  The `<ol>` to fill.
 * @param {string} [here]     The current day's folder, marked `aria-current`.
 */
export function renderDayList(list, here) {
  if (!list) return;
  list.replaceChildren(dayRow(BASE_ENTRY, here), ...DAYS.map((entry) => dayRow(entry, here)));
}

/** Build the menu, open and close it, and wire the ways out of it. */
function mountStartMenu({ start, menu, here }) {
  renderDayList(menu.querySelector('ol'), here);

  const setOpen = (open) => {
    menu.hidden = !open;
    start.setAttribute('aria-expanded', String(open));
    if (open) {
      // Focus the first reachable row, so the keyboard lands inside the menu it just opened.
      const target = menu.querySelector('a');
      if (target) target.focus();
    }
  };

  start.addEventListener('click', () => setOpen(menu.hidden));

  // Escape closes and returns focus to the button that opened it, which is the only way back
  // for a keyboard once focus has moved into the menu.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || menu.hidden) return;
    setOpen(false);
    start.focus();
  });

  // A click anywhere else closes it. `pointerdown` rather than `click`, so the menu is gone
  // before a click on the map is interpreted as a map click.
  document.addEventListener('pointerdown', (event) => {
    if (menu.hidden) return;
    if (menu.contains(event.target) || start.contains(event.target)) return;
    setOpen(false);
  });
}

/* ---------------------------------------------------------------------------
   The detail panel.
   --------------------------------------------------------------------------- */

//: How long the panel takes to slide, matching the transition in xp.css. The element is
//: marked `hidden` only once the slide has finished, so it is never seen vanishing mid-slide
//: and it stays out of the tab order the rest of the time.
const SLIDE_MS = 220;

class Panel {
  constructor(root) {
    this.root = root;
    this.head = root.querySelector('.detail-head h2');
    this.body = root.querySelector('.detail-body');
    this.foot = root.querySelector('.detail-foot');
    this.timer = null;
    this.onClose = null;

    const close = root.querySelector('.detail-close');
    if (close) close.addEventListener('click', () => this.close());
  }

  /**
   * Show the panel.
   *
   * @param {string} title     The title-bar text.
   * @param {Node|Node[]} content  What goes in the body.
   * @param {Node|string} [foot]   An optional footer, for a link onward or a provenance line.
   */
  open(title, content, foot) {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.head) this.head.textContent = title;
    if (this.body) this.body.replaceChildren(...[].concat(content || []));
    if (this.foot) {
      if (foot instanceof Node) this.foot.replaceChildren(foot);
      else this.foot.textContent = foot || '';
    }

    // `hidden` comes off first and the class goes on in a later frame: setting both in one
    // go gives the browser no start state to animate from, so the panel snaps instead of
    // sliding. Two nested frames guarantee a layout in between.
    this.root.classList.remove('is-open');
    this.root.hidden = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.root.classList.add('is-open'));
    });
  }

  close() {
    if (this.root.hidden) return;
    this.root.classList.remove('is-open');
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.root.hidden = true;
      this.timer = null;
    }, SLIDE_MS);
    if (this.onClose) this.onClose();
  }

  get isOpen() {
    return !this.root.hidden;
  }
}

/* ---------------------------------------------------------------------------
   Content builders, for a day that wants the era's shapes rather than its own.
   --------------------------------------------------------------------------- */

/** A cell's content: a string, `[text, href]`, `{text, href}`, or a Node. */
function fillCell(target, value) {
  if (value instanceof Node) {
    target.append(value);
    return;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    fillCell(target, value.href ? [value.text, value.href] : value.text);
    return;
  }
  const [text, href] = Array.isArray(value) ? value : [value, null];
  if (!href) {
    target.textContent = text == null ? '' : String(text);
    return;
  }
  const a = document.createElement('a');
  a.textContent = text;
  a.href = href;
  // Same rule as the rest of the project: an off-site link carries no referrer.
  if (/^https?:/.test(href)) a.rel = 'noopener noreferrer';
  target.append(a);
}

/**
 * A real table, for content that has columns.
 *
 * `th` elements carry `scope`, so a screen reader announces the column with every cell and
 * the relationship is in the markup rather than in an em dash between a label and its value.
 *
 * @param {{caption?: string, columns: string[], rows: any[][]}} spec
 */
export function table(spec) {
  const element = document.createElement('table');
  element.className = 'group-table';

  if (spec.caption) {
    const caption = document.createElement('caption');
    caption.textContent = spec.caption;
    element.append(caption);
  }

  const headRow = document.createElement('tr');
  for (const name of spec.columns) {
    const th = document.createElement('th');
    th.setAttribute('scope', 'col');
    th.textContent = name;
    headRow.append(th);
  }
  const head = document.createElement('thead');
  head.append(headRow);

  const body = document.createElement('tbody');
  for (const row of spec.rows) {
    const tr = document.createElement('tr');
    row.forEach((value, index) => {
      // The first column names its row, so it is a row header and not a plain cell.
      const cell = document.createElement(index === 0 ? 'th' : 'td');
      if (index === 0) {
        cell.setAttribute('scope', 'row');
      } else {
        // Narrow viewports hide the header row and collapse each row to a block, so the
        // column name has to travel with the cell for the stylesheet to print back.
        cell.dataset.label = spec.columns[index];
      }
      fillCell(cell, value);
      tr.append(cell);
    });
    body.append(tr);
  }

  element.append(head, body);
  return element;
}

/**
 * One labelled group box: the era's way of titling a block, and a fieldset is what it was.
 *
 * @param {string} heading
 * @param {any[]|{columns: string[], rows: any[][]}} content
 *        A list of lines, or a table spec.
 */
export function group(heading, content) {
  const box = document.createElement('fieldset');
  box.className = 'group';
  const legend = document.createElement('legend');
  legend.textContent = heading;
  box.append(legend);

  if (content && !Array.isArray(content) && Array.isArray(content.columns)) {
    box.append(table(content));
    return box;
  }

  for (const line of content || []) {
    const p = document.createElement('p');
    p.className = 'group-line';
    fillCell(p, line);
    box.append(p);
  }
  return box;
}

/* ---------------------------------------------------------------------------
   Mount.
   --------------------------------------------------------------------------- */

/**
 * Wire the shell. Every piece is optional: a page that omits one simply does not get it.
 *
 * @param {object} [options]
 * @param {string} [options.here]  The current day's folder name, so the index can mark it.
 * @returns {{panel: Panel|null}}
 */
export function mountChrome(options = {}) {
  const clock = document.getElementById('clock');
  if (clock) tick(clock);

  const start = document.getElementById('start');
  const menu = document.getElementById('start-menu');
  if (start && menu) {
    mountStartMenu({ start, menu, here: options.here });
  }

  const detail = document.getElementById('detail');
  const panel = detail ? new Panel(detail) : null;

  // The title bar's close box. There is one window and nowhere to close it to, so it does
  // the one honest thing available: dismisses the panel if it is open, and otherwise goes
  // back to the index.
  const close = document.getElementById('window-close');
  if (close) {
    close.addEventListener('click', () => {
      if (panel && panel.isOpen) {
        panel.close();
        return;
      }
      window.location.href = '/';
    });
  }

  return { panel };
}
