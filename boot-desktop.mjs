/* The desktop page. No map, so no MapLibre: the shell, and an icon per app. */

import { mountShell, renderDesktop } from './os/shell.mjs';
import { APPS } from './apps.mjs';

// No `here`: the desktop is not a window, so nothing is registered as open and no button
// is drawn as current. `entries` is passed so the bar still shows what is already open,
// and `menu` so the Start menu lists everything.
mountShell({ entries: APPS, menu: APPS });
renderDesktop(document.getElementById('icons'), APPS);
