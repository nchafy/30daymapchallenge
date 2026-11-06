/* The detail panel, and the era's content shapes for filling it.
 *
 * The panel is window furniture: an app asks it to show something and does not care how it
 * slides or where it docks. `table` and `group` are here for the same reason — an app that
 * wants the era's look should not be reimplementing a fieldset.
 *
 * Nothing reaches the page as markup: every node is built with DOM calls and `textContent`.
 */

//: How long the panel takes to slide, matching the transition in `theme.css`. The element
//: is marked `hidden` only once the slide has finished, so it is never seen vanishing
//: mid-slide and it stays out of the tab order the rest of the time.
const SLIDE_MS = 220;

export class Panel {
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
   * @param {string} title         The title-bar text.
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
   Content builders, for an app that wants the era's shapes rather than its own.
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
