/* The desktop. One page, one Desktop, thirty-one programs. */

import { Desktop } from './vendor/webxp/webxp.mjs';
import { PROGRAMS } from './programs.mjs';

const desktop = new Desktop({
  root: document.getElementById('webxp'),
  name: '30 Day Map Challenge',
  tagline: '1–30 November 2026',
  footer: 'Themes from 30daymapchallenge.com',
  programs: PROGRAMS,
});

desktop.autostart();

//: For the devtools console and for `scripts/check.py`, which reads window geometry rather
//: than trusting a screenshot. Not a test hook: this is the handle a person would want.
window.webxp = desktop;
