"""Capture the crossing overlay for the noisiest and quietest segments.

    .venv/bin/python scripts/shoot_worm.py

The overlay is the day's argument: every run through one stretch, drawn on top of the
others, so the width of the bundle is the noise. It only means anything as a comparison,
so this shoots the extremes of the grid as a pair -- `screenshots/worm-noisy.png` and
`screenshots/worm-quiet.png`, at the same zoom.

Needs `days/02-lines/private/area-noise.json`, so it needs a real export.
"""

from __future__ import annotations

import base64
import pathlib
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from cdp import Browser  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8096

#: Opened on each segment, so the two shots are directly comparable.
ZOOM = 17.4


def main() -> int:
    out_dir = REPO_ROOT / "screenshots"
    out_dir.mkdir(exist_ok=True)
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=REPO_ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(60):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{PORT}/", timeout=5)
                break
            except OSError:
                time.sleep(0.1)
        else:
            print(f"server did not come up on {PORT}", file=sys.stderr)
            return 1

        with Browser() as browser:
            page = browser.page()
            page.call("Runtime.enable")
            page.call(
                "Emulation.setDeviceMetricsOverride",
                width=1280,
                height=820,
                deviceScaleFactor=1,
                mobile=False,
            )
            page.navigate(f"http://127.0.0.1:{PORT}/")
            # One page now: boot the desktop, then open the day as a program.
            for _ in range(80):
                if page.evaluate("Boolean(window.webxp)"):
                    break
                time.sleep(0.25)
            page.evaluate(
                "window.webxp.launch('02-lines').then(() => true)", await_promise=True
            )
            # Wait for the module to publish its handle.
            for _ in range(80):
                if page.evaluate("Boolean(window.lines && window.lines.hasNoise)"):
                    break
                time.sleep(0.25)
            if not page.evaluate("window.lines.hasNoise()"):
                print("no noise grid; run noise_by_area.py first", file=sys.stderr)
                return 1

            # The overview first: the whole grid, which is the view that has to read at a
            # glance before anyone clicks anything.
            page.evaluate(
                """(() => {
                  if (!window.lines.noiseShown()) {
                    document.querySelector('[data-role="noise-toggle"]').click();
                  }
                })()"""
            )
            time.sleep(3.0)
            data = page.call("Page.captureScreenshot", format="png")
            (out_dir / "segments-overview.png").write_bytes(base64.b64decode(data["data"]))
            print(f"overview -> segments-overview.png")

            for label, pick in (("noisy", "max"), ("quiet", "min")):
                got = page.evaluate(
                    """((pick) => {
                      const cells = window.lines.cells()
                        .filter((c) => (c.passes || []).length >= 6);
                      cells.sort((a, b) => a.adjusted_pts - b.adjusted_pts);
                      const cell = pick === 'max' ? cells[cells.length - 1] : cells[0];
                      if (!window.lines.noiseShown()) {
                        document.querySelector('[data-role="noise-toggle"]').click();
                      }
                      return window.lines.openSegment(cell).then(() => {
                        // Same zoom for both, so the bundles are comparable rather than
                        // whatever fitBounds chose for each cell's extent.
                        window.base.map.jumpTo({ center: [cell.lon, cell.lat], zoom: %s });
                        return {
                          id: cell.id,
                          adjusted: cell.adjusted_pts,
                          inflation: cell.inflation_pct,
                          passes: (cell.passes || []).length,
                          ghosts: window.lines.ghostCount(),
                        };
                      });
                    })(%r)"""
                    % (ZOOM, pick),
                    await_promise=True,
                )
                time.sleep(2.5)
                data = page.call("Page.captureScreenshot", format="png")
                out = out_dir / f"worm-{label}.png"
                out.write_bytes(base64.b64decode(data["data"]))
                print(
                    f"{label:6} cell {got['id']:>12}  adjusted {got['adjusted']:+.2f} pts  "
                    f"raw {got['inflation']:+.2f}%  {got['ghosts']}/{got['passes']} ghosts"
                    f"  -> {out.name}"
                )
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
