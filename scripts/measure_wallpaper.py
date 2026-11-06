"""Measure the wallpaper pixel counts healthy and sabotaged, to set a threshold from data.

    .venv/bin/python scripts/measure_wallpaper.py

`MIN_DESKTOP_PIXELS` in `check.py` decides whether the desktop's CSS wallpaper is still
drawing. The first value was guessed at 2000 and was unfailable at the wider viewport: the
taskbar's own blue fell inside the slack for the sky, so removing the wallpaper entirely
still left more "sky" than the threshold. This prints both numbers at both viewports so
the threshold can sit in the gap.

Run it again after changing the wallpaper, the taskbar colours, or the inks.
"""

from __future__ import annotations

import pathlib
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from cdp import Browser  # noqa: E402
from check import (  # noqa: E402
    DESKTOP_EXCLUDE,
    DESKTOP_INK_SLACK,
    DESKTOP_INKS,
    VIEWPORTS,
    count_pixels,
)

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8098

#: Removes the sky and the hill without touching anything else on the page.
SABOTAGE = """(() => {
  const style = document.createElement('style');
  style.textContent =
    'body.desktop{background:#ffffff !important}' +
    'body.desktop::before{display:none !important}';
  document.head.append(style);
})()"""


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
            print("server did not come up", file=sys.stderr)
            return 1

        rows = []
        with Browser() as browser:
            for viewport, (width, height) in VIEWPORTS.items():
                page = browser.page()
                page.call("Runtime.enable")
                page.call(
                    "Emulation.setDeviceMetricsOverride",
                    width=width,
                    height=height,
                    deviceScaleFactor=1,
                    mobile=False,
                )
                for state in ("healthy", "no wallpaper"):
                    page.navigate(f"http://127.0.0.1:{PORT}/")
                    # One open window, so the taskbar carries a window button too -- that
                    # button's gradient is half of why the first threshold did not work.
                    page.evaluate(
                        """window.localStorage.setItem('30dmc:open', '["00-base"]')"""
                    )
                    page.navigate(f"http://127.0.0.1:{PORT}/")
                    if state == "no wallpaper":
                        page.evaluate(SABOTAGE)
                    time.sleep(0.6)
                    counts = count_pixels(
                        page,
                        out_dir / f"wallpaper-{viewport}-{state.replace(' ', '-')}.png",
                        DESKTOP_INKS,
                        DESKTOP_INK_SLACK,
                        exclude=DESKTOP_EXCLUDE,
                    )
                    rows.append((viewport, state, counts))
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()

    print(f"\nexcluding {DESKTOP_EXCLUDE!r}, slack {DESKTOP_INK_SLACK}\n")
    print(f"{'viewport':10} {'state':14} " + " ".join(f"{n:>12}" for n in DESKTOP_INKS))
    for viewport, state, counts in rows:
        print(
            f"{viewport:10} {state:14} "
            + " ".join(f"{counts[n]:>12,}" for n in DESKTOP_INKS)
        )

    worst_healthy = {n: min(c[n] for v, s, c in rows if s == "healthy") for n in DESKTOP_INKS}
    worst_broken = {
        n: max(c[n] for v, s, c in rows if s == "no wallpaper") for n in DESKTOP_INKS
    }
    print()
    for name in DESKTOP_INKS:
        print(
            f"{name}: worst healthy {worst_healthy[name]:,}, "
            f"worst broken {worst_broken[name]:,}"
        )
    floor = max(worst_broken.values())
    ceiling = min(worst_healthy.values())
    print(f"\nthreshold must sit between {floor:,} and {ceiling:,}")
    if floor >= ceiling:
        print("NO SAFE THRESHOLD: the check cannot distinguish the two states.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
