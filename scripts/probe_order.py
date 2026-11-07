"""Print the real layer order on the day 2 page, with the noise layer on.

    .venv/bin/python scripts/probe_order.py

Throwaway diagnostic. `addLayer(layer, beforeId)` makes paint order easy to reason about
wrongly, so read it off the running map instead.
"""

from __future__ import annotations

import pathlib
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from cdp import Browser  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8095
MINE = {
    "noise-scrim", "noise", "noise-outline", "noise-selected",
    "all", "all-casing", "all-hit", "focus", "focus-casing",
    "matched", "matched-casing", "ghosts", "pass",
}


def main() -> int:
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
        with Browser() as browser:
            page = browser.page()
            page.call("Runtime.enable")
            page.call(
                "Emulation.setDeviceMetricsOverride",
                width=1280, height=820, deviceScaleFactor=1, mobile=False,
            )
            page.navigate(f"http://127.0.0.1:{PORT}/days/02-lines/")
            for _ in range(80):
                if page.evaluate("Boolean(window.lines && window.lines.hasNoise)"):
                    break
                time.sleep(0.25)
            page.evaluate(
                """(() => {
                  const b = document.getElementById('toggle-noise');
                  if (b && !b.disabled && !window.lines.noiseShown()) b.click();
                })()"""
            )
            time.sleep(2.0)
            layers = page.evaluate(
                """(() => window.base.map.getStyle().layers.map((l, i) => ({
                     i, id: l.id, type: l.type,
                   })))()"""
            )
            print(f"{len(layers)} layers; bottom to top. Mine marked.\n")
            print(f"  {'#':>4}  {'type':<16} id")
            for row in layers:
                mark = " <<<" if row["id"] in MINE else ""
                if row["id"] in MINE or row["type"] == "background":
                    print(f"  {row['i']:>4}  {row['type']:<16} {row['id']}{mark}")
            # Where do mine sit relative to everything else?
            idx = [r["i"] for r in layers if r["id"] in MINE]
            print(f"\nmine occupy indices {min(idx)}..{max(idx)} of 0..{len(layers) - 1}")
            above = [r["id"] for r in layers if r["i"] > max(idx)]
            print(f"{len(above)} basemap layer(s) paint ABOVE all of mine: {above[:12]}")
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
