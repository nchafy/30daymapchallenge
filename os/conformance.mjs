/* The fixture's script: mount the shell the way a foreign host would.
 *
 * One import, from `os/` only. No catalogue, no entries, no menu. If this file ever needs
 * to import something outside `os/` to work, the shell has stopped being reusable and
 * `scripts/check.py` should start failing rather than this file growing an import.
 */

import { mountShell } from './shell.mjs';

const { panel } = mountShell();

// Exposed for the harness, the same way every app page exposes its own handle.
window.conformance = {
  panel: Boolean(panel),
  openPanel: () => panel && panel.open('From the host', [], 'A host using the panel.'),
};
