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

#: Pages with no map. Checked for console errors and shape, not for a canvas.
STATIC_PAGES = {"index": "/"}

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
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if page.evaluate("window.base.map.areTilesLoaded()"):
                break
            time.sleep(0.25)
        time.sleep(1.0)

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
            try:
                urllib.request.urlopen(base + "/", timeout=5)
                break
            except OSError:
                time.sleep(0.1)
        else:
            print("server did not come up", file=sys.stderr)
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

                for name, path in STATIC_PAGES.items():
                    page.navigate(base + path)
                    rows = page.evaluate(
                        "document.querySelectorAll('#day-list li').length"
                    )
                    if rows != 31:
                        failures.append(f"{name}/{viewport}: day list has {rows} rows, want 31")
                    errors = console_errors(page)
                    failures += [f"{name}/{viewport}: {e}" for e in errors]
                    size = shoot(page, out_dir / f"{name}-{viewport}.png")
                    print(f"  {name}-{viewport}.png  {size // 1024} KB  rows={rows}")

                # The remembered basemap is cleared first, so every run starts from the
                # documented default rather than from whatever the last run chose. The
                # persistence itself is checked at the end.
                page.navigate(base + MAP_PAGE)
                page.evaluate("window.localStorage.clear()")
                page.navigate(base + MAP_PAGE)
                state = wait_for_map(page, "simple")

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
                size = shoot(page, out_dir / f"base-panel-{viewport}.png")
                print(
                    f"  base-panel-{viewport}.png  {size // 1024} KB  "
                    f"panel={opened['open']} title={opened['title']!r}"
                )
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
