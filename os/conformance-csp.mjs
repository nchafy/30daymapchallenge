/* Two icons under a strict CSP: one drawn by the stylesheet, one carrying its own node.
 *
 * Built with `createElementNS` rather than from a markup string, which is both the rule
 * for everything in this shell and the reason the node path needs no policy exception.
 */

import { mountShell, renderDesktop } from './shell.mjs';

/** A plain shape in a colour nothing else on the page uses, so it can be counted. */
function ownIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const rect = document.createElementNS(NS, 'rect');
  rect.setAttribute('x', '4');
  rect.setAttribute('y', '6');
  rect.setAttribute('width', '24');
  rect.setAttribute('height', '20');
  rect.setAttribute('rx', '2');
  rect.setAttribute('fill', '#ffcc00');
  rect.setAttribute('stroke', '#7a5c00');
  rect.setAttribute('stroke-width', '1.5');
  svg.append(rect);
  return svg;
}

const ENTRIES = [
  // Asks the stylesheet. Must come out blank under this policy -- that is the finding.
  { id: 'from-css', label: 'Art from the stylesheet', href: '#', kind: 'map' },
  // Brings its own. Must draw.
  { id: 'from-node', label: 'Art from a node', href: '#', icon: ownIcon },
];

mountShell();
renderDesktop(document.getElementById('icons'), ENTRIES);

window.cspFixture = {
  boxes: () =>
    [...document.querySelectorAll('#icons .icon-art')].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        art: el.dataset.art || null,
        kind: el.dataset.kind || null,
        // The computed value being correct while nothing is painted is the trap this page
        // records: a style comparison cannot tell you an icon is invisible.
        backgroundImage: getComputedStyle(el).backgroundImage !== 'none',
        svgChildren: el.querySelectorAll('svg').length,
        box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
      };
    }),
};
