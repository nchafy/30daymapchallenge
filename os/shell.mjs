/* Boot the shell. One import for a page that wants to run inside the OS.
 *
 * Everything here is chrome. An app gets a working page whether or not this module loads,
 * which is why it is a separate import and why nothing in an app's own libraries depends
 * on it.
 *
 * ## Every piece is opt-in
 *
 * A page gets exactly the parts it has markup for, and the parts it asked for. That
 * matters because the shell is used by more than one site:
 *
 * - No `#clock` in the markup, no clock.
 * - No `#detail`, no panel, and `panel` comes back null.
 * - No `entries`, and **the taskbar is not touched** — a host that server-renders its own
 *   bar keeps its markup. This is not theoretical: the previous version called
 *   `renderTaskbar` unconditionally, and because the open list was filtered against this
 *   project's own catalogue, every other host got its bar silently emptied.
 * - No `menu`, and the Start menu is not wired, so no catalogue is imported and nothing
 *   has to exist for the import graph to resolve.
 */

import { Panel } from './panel.mjs';
import { mountMenu } from './menu.mjs';
import { closeWindow, openWindow, renderTaskbar } from './taskbar.mjs';

export { renderDesktop } from './desktop.mjs';
export { renderMenu } from './menu.mjs';
export { group, table, Panel } from './panel.mjs';
export { closeWindow, openWindow, openWindows, renderTaskbar } from './taskbar.mjs';

/** XP's tray clock: hours and minutes, 12-hour, no seconds. */
function tick(element) {
  const now = new Date();
  element.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  // Scheduled to the next minute boundary rather than every second: a clock with no
  // seconds hand has nothing to say in between, and a 1 s interval wakes the page 60x for
  // nothing.
  const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
  setTimeout(() => tick(element), msToNextMinute + 50);
}

/**
 * Wire the shell.
 *
 * @param {object} [options]
 * @param {string} [options.here]       This window's entry id. Registers it as open and
 *                                      marks it current. Omit on the desktop itself,
 *                                      which is not a window.
 * @param {object[]} [options.entries]   Entries for the taskbar. Omit to leave the bar
 *                                      alone entirely.
 * @param {object[]} [options.menu]      Entries for the Start menu. Omit to skip it.
 * @param {string} [options.homeHref]    Where the close box goes. Default `/`.
 * @returns {{panel: Panel|null}}
 */
export function mountShell(options = {}) {
  const { here, entries, menu, homeHref = '/' } = options;

  const clock = document.getElementById('clock');
  if (clock) tick(clock);

  const start = document.getElementById('start');
  const startMenu = document.getElementById('start-menu');
  if (start && startMenu && menu) {
    mountMenu({ start, menu: startMenu, entries: menu, here });
  }

  const detail = document.getElementById('detail');
  const panel = detail ? new Panel(detail) : null;

  // Opening a window registers it, whatever route the reader took to get here: a desktop
  // icon, the Start menu, a bookmark, the back button. The bar is then rebuilt from that
  // list rather than kept in step by whoever did the navigating.
  if (here && entries) {
    openWindow(here, entries);
  }
  if (entries) {
    renderTaskbar(document.querySelector('.task-items'), { entries, here, homeHref });
  }

  // The title bar's close box. It closes the window: forgets this one and returns home. A
  // panel open over the content is dismissed first, because that is the nearer of the two
  // things a reader means by "close" when something is covering what they were looking at.
  const close = document.getElementById('window-close');
  if (close) {
    close.addEventListener('click', () => {
      if (panel && panel.isOpen) {
        panel.close();
        return;
      }
      if (here) closeWindow(here);
      window.location.href = homeHref;
    });
  }

  return { panel };
}
