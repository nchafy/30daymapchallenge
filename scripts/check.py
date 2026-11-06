#!/usr/bin/env python3
"""Load every page in headless Chrome, screenshot it, and fail on a console error.

An unstyled page, an empty canvas or a module that threw on import is invisible to an HTTP
status assertion and obvious in an image. This also catches the failure mode that matters
most here: `setStyle` discards the layers a day added, so a basemap switch that does not
re-run `draw` leaves a map that looks fine and has lost its data.

    .venv/bin/python scripts/check.py [--port 8077] [--out screenshots]

Every basemap is visited in turn on the base-map page, so all three are exercised. Tile
requests go to the real services: this is a check that the sources still answer, not a unit
test, and there is no fixture that could tell us they stopped.
"""

from __future__ import annotations

import argparse
import base64
import io
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cdp import Browser, CDPError  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent

#: 500 and not a true phone width, because macOS clamps a Chrome window below ~500 px and a
#: narrower request silently crops. Still under the 52rem breakpoint, so it exercises the
#: bottom-sheet path for the detail panel.
VIEWPORTS = {"narrow": (500, 900), "desktop": (1280, 820)}

#: The map page, visited once per basemap.
MAP_PAGE = "/days/00-base/"
BASEMAPS = ("simple", "satellite", "geography")

#: How long to let tiles settle after the map reports idle. Idle means the camera stopped
#: and the style loaded; a raster pyramid can still be filling in behind it.
SETTLE_S = 2.5

#: Console messages that are noise rather than a defect. Kept narrow on purpose: a blanket
#: filter is how a real error gets ignored for a week.
IGNORED = (
    # A raster pyramid 404s at its own edge, which is normal and which MapLibre reports
    # rather than swallows.
    "Failed to load resource: the server responded with a status of 404",
    "AbortError",
)


#: The layers `days/00-base/map.mjs` adds in its `draw`. Their presence after a basemap
#: switch is the regression this whole file exists to catch: `setStyle` discards every layer
#: added to the old style, so a `draw` that is not re-run leaves a map that looks fine and
#: has silently lost its data.
OVERLAY_LAYERS = ("clicked-point", "clicked-point-halo")

#: The page's observable state, plus what only the map itself can answer. `window.base` is
#: set by every day's module for the devtools console; reading it here costs no test hook.
PROBE = """(() => {
  const canvas = document.querySelector('.maplibregl-canvas');
  const status = document.getElementById('map-status');
  const attrib = document.getElementById('map-attrib');
  const pressed = [...document.querySelectorAll('[data-basemap]')]
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.dataset.basemap);
  const base = window.base;
  const map = base && base.map;
  const div = document.getElementById('map');
  const box = div ? div.getBoundingClientRect() : null;
  return {
    // Measured, not assumed. A container that collapses to 0 px high fetches every tile,
    // reports the style loaded, and draws nothing — which is exactly what happened when
    // MapLibre's own `position: relative` beat the stylesheet's `absolute`.
    mapBox: box ? [Math.round(box.width), Math.round(box.height)] : null,
    canvas: Boolean(canvas && canvas.width > 0),
    status: status ? status.textContent.trim() : '',
    attrib: attrib ? attrib.textContent.trim().length : 0,
    pressed,
    basemap: base ? base.basemap : null,
    styleLoaded: Boolean(map && map.isStyleLoaded()),
    layers: map ? %s.filter((id) => Boolean(map.getLayer(id))) : [],
    // Rendered features at the point that was clicked, through the public query API. An
    // earlier version read `source._data.features`, which is `{geojson: {...}}` in
    // MapLibre 6 and so always measured zero — a probe that was wrong about working code.
    // Asking what actually rendered is the stronger question anyway.
    points: map && box && map.getLayer('clicked-point')
      ? map.queryRenderedFeatures([box.width / 2, box.height / 2],
          { layers: ['clicked-point'] }).length
      : null,
  };
})()""" % (list(OVERLAY_LAYERS),)


def wait_for_map(page, want: str | None = None, timeout: float = 45.0) -> dict:
    """Block until the map has drawn, and report what it drew.

    Polls the page's own state rather than a signal put there for the test: the canvas
    exists once MapLibre has a GL context, `#map-attrib` is filled when a style is applied,
    and `#map-status` is cleared on the first `idle`.

    `want` is the basemap the caller just asked for. Without it this returns on the state
    that was already true, which is the bug that made the first run of this script pass a
    switch that had not happened yet: `setBasemap` awaits a style fetch, so for a round trip
    after the click every one of the conditions above still describes the *old* basemap.
    """
    deadline = time.monotonic() + timeout
    last: dict = {}
    while time.monotonic() < deadline:
        last = page.evaluate(PROBE)
        box = last["mapBox"] or [0, 0]
        settled = (
            last["canvas"]
            and last["attrib"] > 0
            and last["styleLoaded"]
            # 200 px, not "> 0": a collapsed container is sometimes a few pixels rather
            # than none, and a map that small has drawn nothing worth screenshotting.
            and box[0] > 200
            and box[1] > 200
            and not last["status"].startswith("Loading")
        )
        if settled and (want is None or (last["pressed"] == [want] and last["basemap"] == want)):
            return last
        time.sleep(0.25)
    raise CDPError(f"map never settled on {want or 'a basemap'}; last state {last}")


def console_errors(page) -> list[str]:
    """Error-level console messages and uncaught exceptions, minus the known noise."""
    found = []
    for event in page.consume_events():
        method = event.get("method")
        params = event.get("params") or {}
        if method == "Runtime.exceptionThrown":
            details = params.get("exceptionDetails") or {}
            text = (details.get("exception") or {}).get("description") or details.get("text")
            found.append(f"uncaught: {text}")
        elif method == "Runtime.consoleAPICalled" and params.get("type") == "error":
            parts = [str(a.get("value", a.get("description", ""))) for a in params.get("args", [])]
            found.append("console.error: " + " ".join(parts))
        elif method == "Log.entryAdded":
            entry = params.get("entry") or {}
            if entry.get("level") == "error":
                found.append(f"log: {entry.get('text')} {entry.get('url') or ''}".strip())
    return [m for m in found if not any(skip in m for skip in IGNORED)]


#: Three parks that were not drawn as green space on the basemap this project started with,
#: and the reason `simple` is liberty rather than a repaint of positron. Each is a point
#: comfortably inside the park, so a rendered polygon there is the whole assertion.
PARKS = {
    "Central Park": (-73.9654, 40.7829),
    "Prospect Park": (-73.9701, 40.6602),
    "Flushing Meadows": (-73.8458, 40.7400),
}

#: Source layers in the OpenMapTiles schema that mean "this is green space". `park` carries
#: `leisure=park`; `landcover` carries wood and grass; `landuse` carries pitches and
#: cemeteries. A hit in any of them is a park the reader can see.
GREEN_SOURCE_LAYERS = {"park", "landcover", "landuse"}


def check_parks(page, viewport: str, out_dir: Path) -> list[str]:
    """Fly to each park and assert the basemap renders green space there.

    This is the owner's complaint turned into a gate (2026-11-04): positron draws the whole
    `park` source layer grey and ships no grass or pitch layer at all, so the three parks
    below were invisible on it. Querying rendered features is what distinguishes "the style
    has a park layer" from "this park is on the screen".
    """
    failures = []
    for name, (lon, lat) in PARKS.items():
        # The trailing `null` matters: `jumpTo` returns the Map, and asking CDP to serialise
        # that by value fails with "Object reference chain is too long".
        page.evaluate(
            f"(() => {{ window.base.map.jumpTo("
            f"{{ center: [{lon}, {lat}], zoom: 13 }}); return null; }})()"
        )
        settle(page)

        found = page.evaluate(
            """(() => {
              const map = window.base.map;
              const div = document.getElementById('map');
              const box = div.getBoundingClientRect();
              const hits = map.queryRenderedFeatures([box.width / 2, box.height / 2]);
              return [...new Set(hits.map((f) => f.sourceLayer).filter(Boolean))];
            })()"""
        )
        green = sorted(set(found) & GREEN_SOURCE_LAYERS)
        if not green:
            failures.append(
                f"parks/{viewport}: {name} renders no green space; "
                f"source layers at that point: {found}"
            )
        slug = name.lower().replace(" ", "-")
        size = shoot(page, out_dir / f"park-{slug}-{viewport}.png")
        print(f"  park-{slug}-{viewport}.png  {size // 1024} KB  green={green}")
    return failures


def check_tilt(page, viewport: str, out_dir: Path) -> list[str]:
    """3D buildings must be hidden looking straight down and visible from an angle.

    The owner's rule (2026-11-04): a `fill-extrusion` seen at pitch 0 is viewed down the top
    of itself, so its walls collapse and it reads as a smeared blob beside its own footprint.
    Gated on the camera, not on a button, so a drag-pitch and the Tilt button agree.

    Zoom 15, because liberty's `building-3d` carries `minzoom: 14` and there is nothing to
    assert below it.
    """
    failures = []

    def extrusion_visibility() -> list:
        return page.evaluate(
            """(() => {
              const map = window.base.map;
              return (map.getStyle().layers || [])
                .filter((l) => l.type === 'fill-extrusion')
                .map((l) => [l.id, map.getLayoutProperty(l.id, 'visibility') || 'visible']);
            })()"""
        )

    # Manhattan, where there are buildings to extrude.
    page.evaluate(
        "(() => { window.base.map.jumpTo("
        "{ center: [-73.9845, 40.7549], zoom: 15, pitch: 0, bearing: 0 }); return null; })()"
    )
    settle(page)
    flat = extrusion_visibility()
    if not flat:
        failures.append(f"tilt/{viewport}: basemap ships no fill-extrusion layer to gate")
    for layer_id, visibility in flat:
        if visibility != "none":
            failures.append(
                f"tilt/{viewport}: {layer_id} is '{visibility}' at pitch 0, want 'none'"
            )
    size = shoot(page, out_dir / f"tilt-flat-{viewport}.png")
    print(f"  tilt-flat-{viewport}.png  {size // 1024} KB  pitch=0 {flat}")

    # Through the button, so the control is covered and not just the camera API.
    page.evaluate("(() => { document.getElementById('map-tilt').click(); return null; })()")
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if page.evaluate("window.base.map.getPitch()") >= 12:
            break
        time.sleep(0.2)
    settle(page)
    pitched = extrusion_visibility()
    pitch = page.evaluate("window.base.map.getPitch()")
    if pitch < 12:
        failures.append(f"tilt/{viewport}: Tilt button left pitch at {pitch:.1f}")
    for layer_id, visibility in pitched:
        if visibility != "visible":
            failures.append(
                f"tilt/{viewport}: {layer_id} is '{visibility}' at pitch {pitch:.0f}, "
                "want 'visible'"
            )
    pressed = page.evaluate(
        "document.getElementById('map-tilt').getAttribute('aria-pressed')"
    )
    if pressed != "true":
        failures.append(f"tilt/{viewport}: Tilt button aria-pressed={pressed!r} while pitched")
    size = shoot(page, out_dir / f"tilt-pitched-{viewport}.png")
    print(f"  tilt-pitched-{viewport}.png  {size // 1024} KB  pitch={pitch:.0f} {pitched}")

    # And the gate must survive a basemap switch, which resets every layer's visibility.
    page.evaluate(
        "(() => { document.querySelector('[data-basemap=\"satellite\"]').click(); "
        "return null; })()"
    )
    wait_for_map(page, "satellite")
    page.evaluate(
        "(() => { document.querySelector('[data-basemap=\"simple\"]').click(); return null; })()"
    )
    wait_for_map(page, "simple")
    settle(page)
    after = extrusion_visibility()
    for layer_id, visibility in after:
        if visibility != "visible":
            failures.append(
                f"tilt/{viewport}: {layer_id} is '{visibility}' after a basemap round trip "
                "while still pitched, want 'visible'"
            )
    print(f"  (gate after basemap round trip: {after})")

    page.evaluate(
        "(() => { window.base.map.jumpTo({ pitch: 0, bearing: 0 }); return null; })()"
    )
    settle(page)
    return failures


def check_compass(page, viewport: str, out_dir: Path) -> list[str]:
    """The needle must track the bearing, and pressing it must face north again.

    The rose is rotated by `-bearing`, because MapLibre's bearing is the direction that is up
    the screen: at bearing 90 east is up and true north is 90 degrees anticlockwise of it. A
    needle rotated the other way looks plausible and points at the wrong quarter of the sky,
    which is the one bug worth a gate here.
    """
    failures = []

    def rose_angle():
        return page.evaluate(
            """(() => {
              const g = document.getElementById('map-compass-rose');
              const m = g && /rotate\\(\\s*(-?[\\d.]+)/.exec(g.getAttribute('transform') || '');
              return m ? parseFloat(m[1]) : null;
            })()"""
        )

    page.evaluate(
        "(() => { window.base.map.jumpTo({ bearing: 90, pitch: 0 }); return null; })()"
    )
    time.sleep(0.5)
    angle = rose_angle()
    bearing = page.evaluate("window.base.map.getBearing()")
    if angle is None:
        failures.append(f"compass/{viewport}: no rose transform to read")
    elif abs(angle - (-bearing)) > 1:
        failures.append(
            f"compass/{viewport}: rose at {angle} for bearing {bearing}, want {-bearing}"
        )
    label = page.evaluate("document.getElementById('map-compass').getAttribute('aria-label')")
    if "90" not in (label or ""):
        failures.append(f"compass/{viewport}: aria-label does not carry the bearing: {label!r}")
    settle(page)
    size = shoot(page, out_dir / f"compass-rotated-{viewport}.png")
    print(f"  compass-rotated-{viewport}.png  {size // 1024} KB  bearing={bearing:.0f} rose={angle}")

    # Clicking it faces north.
    page.evaluate("(() => { document.getElementById('map-compass').click(); return null; })()")
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if abs(page.evaluate("window.base.map.getBearing()")) < 0.5:
            break
        time.sleep(0.2)
    bearing = page.evaluate("window.base.map.getBearing()")
    if abs(bearing) > 0.5:
        failures.append(f"compass/{viewport}: click left bearing at {bearing:.1f}, want 0")
    angle = rose_angle()
    if angle is not None and abs(angle) > 1:
        failures.append(f"compass/{viewport}: rose at {angle} after reset, want 0")
    print(f"  (compass click -> bearing {bearing:.1f}, rose {angle})")

    # Arrow keys turn the view, which is the only rotation a keyboard can reach.
    page.evaluate("(() => { document.getElementById('map-compass').focus(); return null; })()")
    page.call(
        "Input.dispatchKeyEvent",
        type="rawKeyDown",
        key="ArrowRight",
        code="ArrowRight",
        windowsVirtualKeyCode=39,
        nativeVirtualKeyCode=39,
    )
    page.call("Input.dispatchKeyEvent", type="keyUp", key="ArrowRight", code="ArrowRight")
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if abs(page.evaluate("window.base.map.getBearing()")) > 1:
            break
        time.sleep(0.2)
    turned = page.evaluate("window.base.map.getBearing()")
    if abs(turned) < 1:
        failures.append(
            f"compass/{viewport}: ArrowRight on the focused compass did not turn the view "
            f"(bearing {turned:.1f})"
        )
    print(f"  (ArrowRight -> bearing {turned:.1f})")

    page.evaluate("(() => { window.base.map.jumpTo({ bearing: 0 }); return null; })()")
    return failures


def check_attribution(page, viewport: str) -> list[str]:
    """The basemap credit must be on screen, and nothing may be on top of it.

    Attribution is a licence term for all three sources. It used to float over the canvas at
    bottom-right, which is exactly where the detail panel docks, one stacking layer above —
    so the credit vanished the moment anything was selected and no check noticed for a day.
    `elementFromPoint` is the assertion that matters: it answers what the reader's cursor
    would actually hit, which a visibility or z-index comparison does not.
    """
    failures = []
    state = page.evaluate(
        """(() => {
          const el = document.getElementById('map-attrib');
          if (!el) return { missing: true };
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          // Several points across the strip, not just the middle: a panel covering one end
          // would otherwise pass.
          const probes = [0.1, 0.5, 0.9].map((f) => {
            const x = r.left + r.width * f;
            const y = r.top + r.height / 2;
            const hit = document.elementFromPoint(x, y);
            return hit ? (hit === el || el.contains(hit) ? 'self' : hit.className || hit.tagName) : 'none';
          });
          return {
            text: el.textContent.trim().length,
            box: [Math.round(r.width), Math.round(r.height)],
            onScreen: r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0 && r.height > 0,
            visibility: cs.visibility,
            display: cs.display,
            probes,
          };
        })()"""
    )
    if state.get("missing"):
        return [f"attrib/{viewport}: #map-attrib is not in the document"]
    if not state["text"]:
        failures.append(f"attrib/{viewport}: credit is empty")
    if not state["onScreen"]:
        failures.append(f"attrib/{viewport}: credit is off screen, box {state['box']}")
    if state["visibility"] != "visible" or state["display"] == "none":
        failures.append(
            f"attrib/{viewport}: credit is {state['visibility']}/{state['display']}"
        )
    covered = [p for p in state["probes"] if p != "self"]
    if covered:
        failures.append(f"attrib/{viewport}: credit is covered by {covered}")
    print(f"  attribution {viewport}: box={state['box']} hits={state['probes']}")
    return failures


#: The layers `days/02-lines/map.mjs` adds, and the page it adds them on.
LINES_PAGE = "/days/02-lines/"
LINES_LAYERS = (
    "recorded",
    "recorded-casing",
    "recorded-hit",
    "matched",
    "matched-casing",
)

#: Tolerance the slider is driven to when checking that simplification shortens the
#: total. 20 m is above the amplitude of receiver noise and below the scale of a city
#: block, so it should remove wobble and leave the route.
LINES_PROBE_TOLERANCE = 20.0

#: How far the browser's ladder may sit from the one `prepare.py` wrote, in metres.
#: `LENGTH_DP = 3` there puts the rounding floor at 0.5 mm, so 2 mm is the rounding plus
#: float noise and nothing else. A real divergence between the two implementations means
#: a different set of points kept, which moves a length by metres, not millimetres --
#: and is caught by its own assertion on the integer point counts regardless.
LADDER_AGREEMENT_M = 0.002

#: The two line colours from `days/02-lines/map.mjs`, and how many pixels of each must
#: actually be on the canvas.
#:
#: This exists because `queryRenderedFeatures` cannot answer the question. It reports a
#: feature as rendered whether or not anything is painted on top of it, and the snapped
#: line shipped invisible for exactly that reason: drawn at 3 px under a trace with a
#: 5 px casing, it was present, queryable, named in the key, and nowhere on screen. The
#: only check that catches that is counting pixels.
#:
#: The threshold is measured, not chosen. Re-introducing the covering widths and running
#: this file gives the sabotaged counts; the healthy counts are printed on every run:
#:
#:              healthy   covered
#:   narrow         659        63
#:   desktop      1,767         0
#:
#: 40 was the first guess and was too low: it caught the bug on desktop and missed it on
#: narrow, where 63 stray anti-aliased pixels cleared it. 200 sits about three times above
#: the worst covered case and three times below the worst healthy one.
LINE_INKS = {"recorded": (0xFF, 0x2E, 0x88), "matched": (0x39, 0xD0, 0xFF)}
MIN_LINE_PIXELS = 200
#: Channel distance that still counts as the ink. Anti-aliasing and the basemap beneath a
#: semi-transparent line both pull a pixel off the exact value.
INK_SLACK = 60


#: Colours the desktop wallpaper must actually paint, and how many pixels of each.
#:
#: The wallpaper is pure CSS -- a sky gradient and an elliptical hill -- so there is no
#: request that can 404 and nothing in the console if it stops drawing. A pixel count is
#: the only thing that notices.
DESKTOP_INKS = {"sky": (0x3F, 0x93, 0xDD), "hill": (0x76, 0xB5, 0x2C)}
MIN_DESKTOP_PIXELS = 2000
DESKTOP_INK_SLACK = 34


def days_with_pages() -> list[str]:
    """The folders `assets/days.mjs` claims have a page, base map included.

    Read out of the source rather than hardcoded, so this file does not have to be edited
    every time a day is built. The point of reading it is to compare what the data file
    says against what the desktop renders and what the server will actually serve.
    """
    source = (REPO_ROOT / "assets" / "days.mjs").read_text()
    dirs = re.findall(r"dir:\s*'([^']+)'", source)
    # Order does not matter here; `dict.fromkeys` just drops any accidental duplicate.
    return list(dict.fromkeys(dirs))


def check_desktop(page, viewport: str, out_dir: Path, base_url: str) -> list[str]:
    """The desktop: an icon per day, and the taskbar that tracks what is open.

    The taskbar is the part worth checking properly. Each day is a separate page, so
    "which windows are open" has to survive a navigation, and the only way to know it does
    is to navigate and look.
    """
    failures: list[str] = []
    expected_dirs = days_with_pages()

    page.navigate(base_url + "/")
    # Start from a known state rather than from whatever a previous run left behind.
    page.evaluate("window.localStorage.removeItem('30dmc:open')")
    page.navigate(base_url + "/")

    shape = page.evaluate(
        """(() => {
          const icons = [...document.querySelectorAll('#icons li')];
          const links = [...document.querySelectorAll('#icons .icon-link[href]')];
          return {
            icons: icons.length,
            links: links.map((a) => a.getAttribute('href')),
            labels: links.map((a) => a.textContent.trim()),
            badges: [...document.querySelectorAll('#icons .icon-art[data-n]')].length,
            tasks: document.querySelectorAll('.task-items .task-button').length,
          };
        })()"""
    )
    if shape["icons"] != 31:
        failures.append(f"desktop/{viewport}: {shape['icons']} icons, want 31")
    if shape["badges"] != 30:
        failures.append(
            f"desktop/{viewport}: {shape['badges']} numbered icons, want 30 "
            f"(the base map is the one without a number)"
        )

    got_dirs = [href.strip("/").split("/")[-1] for href in shape["links"]]
    if sorted(got_dirs) != sorted(expected_dirs):
        failures.append(
            f"desktop/{viewport}: the desktop links {sorted(got_dirs)} but days.mjs "
            f"says {sorted(expected_dirs)}"
        )
    if shape["tasks"] != 0:
        failures.append(
            f"desktop/{viewport}: {shape['tasks']} taskbar buttons with nothing opened"
        )

    # Every icon that is a link must lead somewhere the server will serve. This is the
    # dead-target case `days.mjs` warns about: a `dir` set to a folder that was never
    # created renders as a perfectly ordinary icon.
    for href in shape["links"]:
        try:
            with urllib.request.urlopen(base_url + href, timeout=10) as response:
                if response.status != 200:
                    failures.append(
                        f"desktop/{viewport}: {href} answered {response.status}"
                    )
        except OSError as error:
            failures.append(f"desktop/{viewport}: {href} is a dead icon ({error})")

    # Opening a day from its icon must put a button in the bar, and the button must say it
    # is the one in front.
    first = shape["links"][0]
    page.evaluate(
        f"document.querySelector('#icons .icon-link[href=\"{first}\"]').click()"
    )
    page.wait_for("Page.loadEventFired", timeout=30)
    opened_one = page.evaluate(
        """(() => {
          const buttons = [...document.querySelectorAll('.task-items .task-button')];
          return {
            count: buttons.length,
            current: buttons.filter((b) => b.dataset.current).length,
            labels: buttons.map((b) => b.querySelector('.task-label').textContent.trim()),
          };
        })()"""
    )
    if opened_one["count"] != 1 or opened_one["current"] != 1:
        failures.append(
            f"desktop/{viewport}: opening {first} gave {opened_one['count']} button(s), "
            f"{opened_one['current']} marked current; want 1 and 1"
        )

    # A second day, reached directly rather than through an icon, must also register --
    # the list is the page's own doing, not the desktop's.
    second = next((h for h in shape["links"] if h != first), None)
    if second:
        page.navigate(base_url + second)
        opened_two = page.evaluate(
            """(() => {
              const buttons = [...document.querySelectorAll('.task-items .task-button')];
              return {
                count: buttons.length,
                current: buttons.filter((b) => b.dataset.current).length,
                currentLabel: (buttons.find((b) => b.dataset.current) || {}).textContent || '',
              };
            })()"""
        )
        if opened_two["count"] != 2 or opened_two["current"] != 1:
            failures.append(
                f"desktop/{viewport}: with two days open there are "
                f"{opened_two['count']} button(s) and {opened_two['current']} current; "
                f"want 2 and 1"
            )

        # Back on the desktop both windows stay open, and neither is in front.
        page.navigate(base_url + "/")
        back = page.evaluate(
            """(() => {
              const buttons = [...document.querySelectorAll('.task-items .task-button')];
              return {
                count: buttons.length,
                current: buttons.filter((b) => b.dataset.current).length,
              };
            })()"""
        )
        if back["count"] != 2:
            failures.append(
                f"desktop/{viewport}: {back['count']} button(s) after returning to the "
                f"desktop, want 2 -- the open list did not survive the navigation"
            )
        if back["current"] != 0:
            failures.append(
                f"desktop/{viewport}: the desktop marks {back['current']} window as "
                f"current; it is not one of them"
            )

        # And the close box on a button really closes that window.
        closed = page.evaluate(
            """(() => {
              const first = document.querySelector('.task-items .task-button');
              const label = first.querySelector('.task-label').textContent.trim();
              first.querySelector('.task-close').click();
              const left = [...document.querySelectorAll('.task-items .task-button')];
              return {
                closed: label,
                count: left.length,
                labels: left.map((b) => b.querySelector('.task-label').textContent.trim()),
                stored: window.localStorage.getItem('30dmc:open'),
              };
            })()"""
        )
        if closed["count"] != 1:
            failures.append(
                f"desktop/{viewport}: closing one of two windows left "
                f"{closed['count']}, want 1"
            )
        elif closed["closed"] in closed["labels"]:
            failures.append(
                f"desktop/{viewport}: closed {closed['closed']!r} and it is still in the bar"
            )
        elif closed["closed"] in (closed["stored"] or ""):
            failures.append(
                f"desktop/{viewport}: closed {closed['closed']!r} but it is still in "
                f"localStorage, so it comes back on reload"
            )
        else:
            print(f"  (opened two, closed {closed['closed']!r}, {closed['count']} left)")

    # The wallpaper is CSS, so nothing fails loudly if it stops drawing.
    shot = out_dir / f"desktop-{viewport}.png"
    counts = count_pixels(page, shot, DESKTOP_INKS, DESKTOP_INK_SLACK, blockers=False)
    for name in DESKTOP_INKS:
        if counts[name] < MIN_DESKTOP_PIXELS:
            failures.append(
                f"desktop/{viewport}: the {name} covers {counts[name]} pixels, want at "
                f"least {MIN_DESKTOP_PIXELS}. The wallpaper is not drawing."
            )

    failures += [f"desktop/{viewport}: {e}" for e in console_errors(page)]
    print(
        f"  desktop-{viewport}.png  {shot.stat().st_size // 1024} KB  "
        f"icons={shape['icons']} links={len(shape['links'])} "
        f"px sky={counts['sky']} hill={counts['hill']}"
    )
    return failures


def count_pixels(
    page, target: Path, inks: dict, slack: int, blockers: bool = True
) -> dict:
    """Screenshot the page and count how many pixels of each named colour are on screen.

    This answers the one question `queryRenderedFeatures` and a `visibility` comparison
    cannot: is the thing actually painted where a reader would see it. A feature covered
    by a wider layer above it is still reported as rendered, and a CSS gradient that stops
    drawing produces no request to fail and nothing in the console.

    With `blockers`, the measured region is the map element minus every overlay rectangle
    on top of it -- the control cards carry a swatch of both line inks in the key, so
    counting the whole frame would pass with nothing drawn on the map at all. The
    rectangles are read from the live layout rather than written here, so a card that
    moves cannot quietly start being counted.

    Without it, the whole viewport counts, which is what the wallpaper needs.
    """
    from PIL import Image

    rects = page.evaluate(
        """(() => {
          const el = document.getElementById('map');
          const map = el ? el.getBoundingClientRect() : null;
          const blockers = [...document.querySelectorAll('.overlays > *, .map-zoom, .detail, .map-attrib')]
            .filter((node) => !node.hidden && node.getBoundingClientRect().width > 0)
            .map((node) => {
              const r = node.getBoundingClientRect();
              return [r.left, r.top, r.right, r.bottom];
            });
          return {
            map: map ? [map.left, map.top, map.right, map.bottom] : null,
            blockers,
            view: [window.innerWidth, window.innerHeight],
          };
        })()"""
    )
    data = page.call("Page.captureScreenshot", format="png")
    blob = base64.b64decode(data["data"])
    target.write_bytes(blob)

    image = Image.open(io.BytesIO(blob)).convert("RGB")
    # The screenshot can be a different pixel size than the CSS layout if the device scale
    # factor is not 1. It is set to 1 in main(), but scale rather than assume.
    sx = image.width / rects["view"][0]
    sy = image.height / rects["view"][1]

    def scaled(box):
        return [int(box[0] * sx), int(box[1] * sy), int(box[2] * sx), int(box[3] * sy)]

    if blockers and rects["map"]:
        left, top, right, bottom = scaled(rects["map"])
        skip = [scaled(b) for b in rects["blockers"]]
    else:
        left, top, right, bottom = 0, 0, image.width, image.height
        skip = []

    pixels = image.load()
    counts = {name: 0 for name in inks}
    considered = 0
    for y in range(max(top, 0), min(bottom, image.height)):
        for x in range(max(left, 0), min(right, image.width)):
            if any(x0 <= x <= x1 and y0 <= y <= y1 for x0, y0, x1, y1 in skip):
                continue
            considered += 1
            r, g, b = pixels[x, y]
            for name, (ir, ig, ib) in inks.items():
                if abs(r - ir) <= slack and abs(g - ig) <= slack and abs(b - ib) <= slack:
                    counts[name] += 1
                    break
    counts["_considered"] = considered
    return counts


def check_lines(page, viewport: str, out_dir: Path, base_url: str) -> list[str]:
    """Day 2: the two lines, the slider, and the two implementations of Douglas-Peucker.

    The load-bearing check is the last one. `days/02-lines/geo.mjs` re-implements what
    `gpsnoise.py` already does, because the slider has to be continuous and so the
    arithmetic has to run in the browser. Two implementations of one calculation is
    exactly what drifts apart unnoticed, so this drives the browser's over the same
    geometry and requires it to agree with the ladder `prepare.py` wrote into the file.
    """
    failures: list[str] = []
    page.navigate(base_url + LINES_PAGE)
    state = wait_for_map(page)
    settle(page)

    info = page.evaluate(
        """(() => {
          const map = window.base.map;
          const present = %s.filter((id) => Boolean(map.getLayer(id)));
          const box = document.getElementById('map').getBoundingClientRect();
          const rendered = map.getLayer('recorded')
            ? map.queryRenderedFeatures({ layers: ['recorded'] }).length
            : 0;
          const matched = map.getLayer('matched')
            ? map.queryRenderedFeatures({ layers: ['matched'] }).length
            : 0;
          return {
            present,
            rendered,
            matched,
            activities: window.lines ? window.lines.activities() : [],
            status: (document.getElementById('map-status') || {}).textContent || '',
            readout: (document.getElementById('readout') || {}).textContent || '',
            box: [Math.round(box.width), Math.round(box.height)],
          };
        })()"""
        % (list(LINES_LAYERS),)
    )

    missing = set(LINES_LAYERS) - set(info["present"])
    if missing:
        failures.append(f"lines/{viewport}: missing layers {sorted(missing)}")
    if not info["activities"]:
        failures.append(
            f"lines/{viewport}: no activities loaded. Run prepare.py to build "
            f"days/02-lines/data."
        )
        # Everything below reads an activity, so stop rather than cascade.
        return failures
    if info["rendered"] < 1:
        failures.append(
            f"lines/{viewport}: the recorded trace is in the style but nothing rendered. "
            f"A line present and invisible is the failure this is here to catch."
        )
    if info["matched"] < 1:
        failures.append(f"lines/{viewport}: the snapped trace rendered nothing")
    if not info["readout"].strip():
        failures.append(f"lines/{viewport}: the readout is empty")

    # Simplifying must shorten the total, and the page must say so.
    moved = page.evaluate(
        """(() => {
          const slider = document.getElementById('tolerance');
          const before = window.lines.totalAt(0);
          slider.value = '%s';
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
            resolve({
              before,
              after: window.lines.totalAt(%s),
              tolerance: window.lines.tolerance,
              out: (document.getElementById('tolerance-out') || {}).textContent || '',
              readout: (document.getElementById('readout') || {}).textContent || '',
              rendered: window.base.map.queryRenderedFeatures({ layers: ['recorded'] }).length,
            });
          })));
        })()"""
        % (LINES_PROBE_TOLERANCE, LINES_PROBE_TOLERANCE),
        await_promise=True,
    )
    if moved["tolerance"] != LINES_PROBE_TOLERANCE:
        failures.append(
            f"lines/{viewport}: slider input did not reach the page "
            f"(tolerance {moved['tolerance']})"
        )
    if not moved["after"] < moved["before"]:
        failures.append(
            f"lines/{viewport}: simplifying to {LINES_PROBE_TOLERANCE} m did not shorten "
            f"the total ({moved['before']:.0f} m -> {moved['after']:.0f} m)"
        )
    if moved["rendered"] < 1:
        failures.append(f"lines/{viewport}: nothing rendered after simplifying")
    if f"{LINES_PROBE_TOLERANCE:g} m" not in moved["out"]:
        failures.append(
            f"lines/{viewport}: the slider's own value reads {moved['out']!r}"
        )

    # The duplication guard: the browser's ladder against the one written to disk.
    agree = page.evaluate(
        """(() => {
          const id = window.lines.activities()[0];
          const mine = window.lines.ladderFor(id);
          const written = window.lines.writtenLadderFor(id);
          if (!mine || !written || mine.length !== written.length) {
            return { ok: false, why: 'ladders are different shapes', id };
          }
          let worst = 0;
          let worstAt = null;
          let keptDiff = null;
          for (let i = 0; i < mine.length; i += 1) {
            if (mine[i][0] !== written[i][0]) {
              return { ok: false, why: `tolerance ${mine[i][0]} vs ${written[i][0]}`, id };
            }
            // Absolute metres, not relative: the written value is rounded to a fixed
            // number of decimal places, so the floor on agreement is a constant in
            // metres and a relative bound would be unstateable -- tight on a long
            // activity and impossible on a short one.
            const diff = Math.abs(mine[i][1] - written[i][1]);
            if (diff > worst) { worst = diff; worstAt = mine[i][0]; }
            // The surviving-point count is the stronger signal. It is an integer, so it
            // carries no rounding at all: if the two implementations ever make a
            // different decision this moves, whatever the lengths do.
            if (mine[i][2] !== written[i][2] && keptDiff === null) {
              keptDiff = { tol: mine[i][0], mine: mine[i][2], written: written[i][2] };
            }
          }
          return { ok: true, worst, worstAt, keptDiff, id, rungs: mine.length };
        })()"""
    )
    if not agree.get("ok"):
        failures.append(
            f"lines/{viewport}: browser and Python ladders disagree "
            f"({agree.get('why')}) for {agree.get('id')}"
        )
    elif agree.get("keptDiff"):
        d = agree["keptDiff"]
        failures.append(
            f"lines/{viewport}: geo.mjs and gpsnoise.py keep different points at "
            f"tolerance {d['tol']} m on {agree['id']} "
            f"({d['mine']} vs {d['written']})"
        )
    elif agree["worst"] > LADDER_AGREEMENT_M:
        failures.append(
            f"lines/{viewport}: geo.mjs and gpsnoise.py disagree by "
            f"{agree['worst']:.4f} m at tolerance {agree['worstAt']} m on {agree['id']}"
        )
    else:
        print(
            f"  (ladders agree to {agree['worst'] * 1000:.2f} mm across "
            f"{agree['rungs']} rungs on {agree['id']}, same points kept at every rung)"
        )

    # The snapped line's toggle must really change what is on screen.
    #
    # `queryRenderedFeatures` answers from the last frame, so it has to be asked after a
    # render and not after the click. Asking too early reported 7 features still drawn
    # on a layer that was already hidden -- a false failure, which is the same defect as
    # a false pass.
    toggled = page.evaluate(
        """(() => {
          const button = document.getElementById('toggle-matched');
          const map = window.base.map;
          const idle = () => new Promise((r) => map.once('idle', r));
          return (async () => {
            button.click();
            await idle();
            const off = map.getLayoutProperty('matched', 'visibility');
            const offRendered = map.queryRenderedFeatures({ layers: ['matched'] }).length;
            button.click();
            await idle();
            return {
              off,
              offRendered,
              on: map.getLayoutProperty('matched', 'visibility'),
              onRendered: map.queryRenderedFeatures({ layers: ['matched'] }).length,
              pressed: button.getAttribute('aria-pressed'),
            };
          })();
        })()""",
        await_promise=True,
    )
    if toggled["off"] != "none" or toggled["offRendered"] != 0:
        failures.append(
            f"lines/{viewport}: hiding the snapped line left "
            f"{toggled['offRendered']} feature(s) rendered"
        )
    if toggled["on"] != "visible" or toggled["pressed"] != "true":
        failures.append(f"lines/{viewport}: the snapped line did not come back")
    elif toggled["onRendered"] < 1:
        failures.append(
            f"lines/{viewport}: the snapped line is visible again but renders nothing"
        )

    # Clicking a trace must open the panel. The pixel is found by asking what the
    # reader's cursor would actually hit, not by assuming the line crosses the centre.
    clicked = page.evaluate(
        """(() => {
          const map = window.base.map;
          const canvas = document.querySelector('.maplibregl-canvas');
          const box = canvas.getBoundingClientRect();
          const hits = map.queryRenderedFeatures({ layers: ['recorded'] });
          if (!hits.length) return { found: false };
          // Walk the rendered geometry until a projected point really queries back to
          // the layer: a coordinate can project outside the canvas, or under a card.
          const coords = hits[0].geometry.coordinates.flat
            ? hits[0].geometry.coordinates
            : [];
          const flat = Array.isArray(coords[0][0]) ? coords.flat() : coords;
          for (let i = Math.floor(flat.length / 2); i < flat.length; i += 1) {
            const p = map.project(flat[i]);
            if (p.x < 4 || p.y < 4 || p.x > box.width - 4 || p.y > box.height - 4) continue;
            if (!map.queryRenderedFeatures([p.x, p.y], { layers: ['recorded'] }).length) continue;
            if (document.elementFromPoint(box.left + p.x, box.top + p.y) !== canvas) continue;
            for (const type of ['mousedown', 'mouseup', 'click']) {
              canvas.dispatchEvent(new MouseEvent(type, {
                bubbles: true, clientX: box.left + p.x, clientY: box.top + p.y,
              }));
            }
            return { found: true, at: [Math.round(p.x), Math.round(p.y)] };
          }
          return { found: false };
        })()"""
    )
    if not clicked["found"]:
        failures.append(
            f"lines/{viewport}: found no pixel on a recorded trace that the cursor "
            f"could reach, so the click path is untested"
        )
    else:
        time.sleep(0.6)
        opened = page.evaluate(
            """(() => {
              const detail = document.getElementById('detail');
              const open = Boolean(detail && !detail.hidden);
              return {
                open,
                title: open ? detail.querySelector('h2').textContent : '',
                rows: open ? detail.querySelectorAll('.group-table tbody tr').length : 0,
                text: open ? detail.textContent : '',
              };
            })()"""
        )
        if not opened["open"]:
            failures.append(
                f"lines/{viewport}: clicking a trace at {clicked['at']} opened no panel"
            )
        elif opened["rows"] < 4:
            failures.append(
                f"lines/{viewport}: the panel has {opened['rows']} rows, want at least 4"
            )
        elif "km" not in opened["text"]:
            failures.append(f"lines/{viewport}: the panel shows no distance")
        else:
            print(f"  (panel opened on {opened['title']!r}, {opened['rows']} rows)")

    # A basemap switch re-runs `draw` against an empty style. Both traces have to come
    # back, and the reader's slider has to still be where they left it: the tolerance
    # lives outside `draw` precisely so a switch does not reset it.
    page.evaluate("document.querySelector('[data-basemap=\"simple\"]').click()")
    wait_for_map(page, "simple")
    settle(page)
    after_switch = page.evaluate(
        """(() => {
          const map = window.base.map;
          return {
            present: %s.filter((id) => Boolean(map.getLayer(id))),
            rendered: map.getLayer('recorded')
              ? map.queryRenderedFeatures({ layers: ['recorded'] }).length : 0,
            tolerance: window.lines.tolerance,
            slider: Number(document.getElementById('tolerance').value),
          };
        })()"""
        % (list(LINES_LAYERS),)
    )
    missing = set(LINES_LAYERS) - set(after_switch["present"])
    if missing:
        failures.append(
            f"lines/{viewport}: draw did not re-run after a basemap switch; "
            f"missing {sorted(missing)}"
        )
    if after_switch["rendered"] < 1:
        failures.append(
            f"lines/{viewport}: the recorded trace rendered nothing after a basemap switch"
        )
    if after_switch["tolerance"] != LINES_PROBE_TOLERANCE:
        failures.append(
            f"lines/{viewport}: the basemap switch reset the slider to "
            f"{after_switch['tolerance']}, want {LINES_PROBE_TOLERANCE}"
        )

    # Back to full resolution, which is how the page opens, and then count what is
    # actually painted. This is the last check because it is the only one that can tell
    # a line that is drawn from a line that is merely in the style.
    page.evaluate(
        """(() => {
          const slider = document.getElementById('tolerance');
          slider.value = '0';
          slider.dispatchEvent(new Event('input', { bubbles: true }));
        })()"""
    )
    settle(page)
    shot = out_dir / f"lines-{viewport}.png"
    counts = count_pixels(page, shot, LINE_INKS, INK_SLACK)
    for name in LINE_INKS:
        if counts[name] < MIN_LINE_PIXELS:
            failures.append(
                f"lines/{viewport}: the {name} line covers {counts[name]} pixels of the "
                f"map, want at least {MIN_LINE_PIXELS}. It is in the style and not on "
                f"screen -- most likely painted over by a wider layer above it."
            )

    failures += [f"lines/{viewport}: {e}" for e in console_errors(page)]
    print(
        f"  lines-{viewport}.png  {shot.stat().st_size // 1024} KB  "
        f"activities={len(info['activities'])} rendered={info['rendered']} "
        f"total={moved['before'] / 1000:.1f}km->{moved['after'] / 1000:.1f}km "
        f"px recorded={counts['recorded']} matched={counts['matched']}"
    )
    return failures


def settle(page, timeout: float = 30.0) -> None:
    """Wait for tiles, then a beat for the first paint of them."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if page.evaluate("window.base.map.areTilesLoaded()"):
            break
        time.sleep(0.25)
    time.sleep(1.0)


def click_centre(page) -> None:
    """Click the middle of the canvas.

    Dispatched on the canvas rather than sent as an `Input.dispatchMouseEvent`, because
    MapLibre binds its handlers to the canvas container and a synthesised DOM event is what
    reaches them without depending on where the overlay cards happen to sit.
    """
    page.evaluate(
        """(() => {
          const canvas = document.querySelector('.maplibregl-canvas');
          const box = canvas.getBoundingClientRect();
          for (const type of ['mousedown', 'mouseup', 'click']) {
            canvas.dispatchEvent(new MouseEvent(type, {
              bubbles: true,
              clientX: box.left + box.width / 2,
              clientY: box.top + box.height / 2,
            }));
          }
        })()"""
    )


def shoot(page, target: Path) -> int:
    data = page.call("Page.captureScreenshot", format="png")
    blob = base64.b64decode(data["data"])
    target.write_bytes(blob)
    return len(blob)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8077)
    parser.add_argument("--out", default="screenshots")
    args = parser.parse_args(argv)

    out_dir = REPO_ROOT / args.out
    out_dir.mkdir(exist_ok=True)
    base = f"http://127.0.0.1:{args.port}"

    # Refuse to run against a server this script did not start.
    #
    # `http.server` exits immediately when the port is taken, and the readiness probe below
    # then succeeds against whatever was already listening. That happened: a server left
    # running from another worktree served *its* files, so a real fix looked broken and a
    # deliberately reintroduced bug looked caught. Both runs measured stale code and the
    # harness reported neither.
    #
    # Claiming the port here is the check. If it is held, say by whom and stop.
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    # SO_REUSEADDR draws the line in the right place: it binds over a socket left in
    # TIME_WAIT by the previous run, which is harmless, but still fails against a process
    # actually LISTENing, which is the thing worth refusing. `http.server` sets the same
    # option, so this probe succeeds exactly where the real server would.
    probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        probe.bind(("127.0.0.1", args.port))
    except OSError:
        print(
            f"port {args.port} is already in use, so this run would test whatever is\n"
            f"already serving there rather than this checkout. Free it first:\n"
            f"  lsof -nP -iTCP:{args.port} -sTCP:LISTEN\n"
            f"  pkill -f 'http.server {args.port}'",
            file=sys.stderr,
        )
        return 1
    finally:
        probe.close()

    # Loopback only. Nothing here is meant to be reachable from another machine.
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(args.port), "--bind", "127.0.0.1"],
        cwd=REPO_ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    failures: list[str] = []
    try:
        for _ in range(60):
            # The server dying is not the same as the server being slow, and only one of
            # the two is worth waiting out.
            if server.poll() is not None:
                print(
                    f"the server exited with {server.returncode} before serving anything",
                    file=sys.stderr,
                )
                return 1
            try:
                urllib.request.urlopen(base + "/", timeout=5)
                break
            except OSError:
                time.sleep(0.1)
        else:
            print("server did not come up", file=sys.stderr)
            return 1

        # Served from this checkout, not another one. A file every page needs, fetched
        # through the same URL the browser will use.
        marker = "/CLAUDE.md"
        try:
            with urllib.request.urlopen(base + marker, timeout=5) as response:
                if b"30daymapchallenge" not in response.read(400):
                    print(f"{marker} served unexpected content", file=sys.stderr)
                    return 1
        except OSError as error:
            print(f"{marker} is not being served ({error})", file=sys.stderr)
            return 1

        with Browser() as browser:
            for viewport, (width, height) in VIEWPORTS.items():
                page = browser.page()
                page.call("Runtime.enable")
                page.call("Log.enable")
                page.call(
                    "Emulation.setDeviceMetricsOverride",
                    width=width,
                    height=height,
                    deviceScaleFactor=1,
                    mobile=False,
                )

                # The desktop, its icons, and the taskbar that tracks what is open.
                failures += check_desktop(page, viewport, out_dir, base)

                # The remembered basemap is cleared first, so every run starts from the
                # documented default rather than from whatever the last run chose. The
                # persistence itself is checked at the end.
                page.navigate(base + MAP_PAGE)
                page.evaluate("window.localStorage.clear()")
                page.navigate(base + MAP_PAGE)
                state = wait_for_map(page, "simple")

                # With nothing selected, before the panel is ever opened.
                failures += check_attribution(page, f"{viewport}/panel-shut")

                # Click the map before switching, so there is an overlay feature whose
                # survival across a `setStyle` can actually be observed.
                click_centre(page)
                time.sleep(0.6)

                # Once per basemap. Switching is driven through the real button, so the
                # check covers the switcher and not just the factory.
                for want in BASEMAPS:
                    if state["pressed"] != [want]:
                        page.evaluate(
                            f"document.querySelector('[data-basemap=\"{want}\"]').click()"
                        )
                        state = wait_for_map(page, want)
                    time.sleep(SETTLE_S)
                    state = page.evaluate(PROBE)

                    missing = set(OVERLAY_LAYERS) - set(state["layers"])
                    if missing:
                        failures.append(
                            f"base/{viewport}/{want}: draw did not re-run; "
                            f"missing {sorted(missing)}"
                        )
                    if state["points"] != 1:
                        failures.append(
                            f"base/{viewport}/{want}: clicked point did not survive the "
                            f"switch ({state['points']} features)"
                        )
                    failures += [f"base/{viewport}/{want}: {e}" for e in console_errors(page)]
                    size = shoot(page, out_dir / f"base-{want}-{viewport}.png")
                    print(
                        f"  base-{want}-{viewport}.png  {size // 1024} KB  "
                        f"layers={len(state['layers'])}/2 points={state['points']}"
                    )

                # Green space, on the `simple` basemap, where the reader expects it.
                page.evaluate(
                    "document.querySelector('[data-basemap=\"simple\"]').click()"
                )
                wait_for_map(page, "simple")
                failures += check_parks(page, viewport, out_dir)

                # 3D buildings, gated on the camera angle.
                failures += check_tilt(page, viewport, out_dir)

                # Compass orientation.
                failures += check_compass(page, viewport, out_dir)

                # The choice has to survive a reload, which is what makes it survive moving
                # between days. `geography` and not `simple`, because `simple` is also the
                # default and would pass whether anything was remembered or not.
                page.evaluate(
                    "document.querySelector('[data-basemap=\"geography\"]').click()"
                )
                wait_for_map(page, "geography")
                page.navigate(base + MAP_PAGE)
                reloaded = wait_for_map(page, "geography")
                if reloaded["basemap"] != "geography":
                    failures.append(
                        f"base/{viewport}: basemap choice not remembered "
                        f"({reloaded['basemap']})"
                    )

                # Clicking the map must drop a point and open the panel.
                click_centre(page)
                time.sleep(0.6)
                opened = page.evaluate(
                    """(() => {
                      const detail = document.getElementById('detail');
                      return {
                        open: Boolean(detail && !detail.hidden),
                        title: detail ? detail.querySelector('h2').textContent : '',
                        rows: detail ? detail.querySelectorAll('.group-table tbody tr').length : 0,
                      };
                    })()"""
                )
                if not opened["open"]:
                    failures.append(f"base/{viewport}: clicking the map opened no panel")
                elif opened["rows"] != 4:
                    failures.append(
                        f"base/{viewport}: panel has {opened['rows']} rows, want 4"
                    )
                failures += [f"base/{viewport}/click: {e}" for e in console_errors(page)]

                # With the panel open, which is the state that used to hide the credit.
                failures += check_attribution(page, f"{viewport}/panel-open")

                size = shoot(page, out_dir / f"base-panel-{viewport}.png")
                print(
                    f"  base-panel-{viewport}.png  {size // 1024} KB  "
                    f"panel={opened['open']} title={opened['title']!r}"
                )

                # Day 2, which has its own overlay, its own control and a second
                # implementation of the arithmetic to keep honest.
                failures += check_lines(page, viewport, out_dir, base)
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()

    if failures:
        print(f"\n{len(failures)} failure(s):", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    print("\nclean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
