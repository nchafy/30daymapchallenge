/* The index page. No map, so no MapLibre: just the shell and the day list. */

import { mountChrome, renderDayList } from './chrome.mjs';

mountChrome();
renderDayList(document.getElementById('day-list'));
