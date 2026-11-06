"""Capture the desktop's icons at 8x, for judging art that is 32 px on the page.

    .venv/bin/python scripts/zoom_icon.py

At 32 px a fill that is not painting and a fill that is merely subtle look identical in a
page screenshot, and a badge that covers a third of the icon it labels looks fine. Both of
those shipped before this existed. Writes `screenshots/icon-zoom.png`.

The capture clips to the real elements and lets Chrome scale the result. Resizing the
icons with injected CSS instead -- the obvious approach -- loses to the stylesheet's own
width, and photographs three 32 px icons at full size while appearing to work.
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
PORT = 8099


def main() -> int:
    # `screenshots/` is gitignored, so it does not exist in a fresh clone. Without this
    # the capture succeeds and then the write fails.
    out = REPO_ROOT / "screenshots" / "icon-zoom.png"
    out.parent.mkdir(exist_ok=True)

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
            # Named, not left to surface as a confusing browser error further down.
            print(f"server did not come up on port {PORT}", file=sys.stderr)
            return 1
        with Browser() as browser:
            page = browser.page()
            page.call("Runtime.enable")
            page.call(
                "Emulation.setDeviceMetricsOverride",
                width=700,
                height=400,
                deviceScaleFactor=1,
                mobile=False,
            )
            page.navigate(f"http://127.0.0.1:{PORT}/")
            time.sleep(0.5)
            # Clip to the real icons as the page draws them and let the capture scale
            # them up. Resizing the elements with injected CSS is what the first version
            # of this script did, and the inline styles lost to the stylesheet -- so it
            # photographed three 32px icons and looked like the art was missing entirely.
            box = page.evaluate(
                """(() => {
                  const live = document.querySelector('#icons .icon-link[href] .icon-art[data-n]');
                  const r = live.getBoundingClientRect();
                  const globe = document.querySelector('#icons .icon-art.is-base').getBoundingClientRect();
                  // One rectangle spanning the first column's top three icons: globe,
                  // then whichever two follow.
                  return {
                    x: Math.min(r.left, globe.left) - 4,
                    y: globe.top - 4,
                    w: 48,
                    h: (r.bottom - globe.top) + 8,
                  };
                })()"""
            )
            data = page.call(
                "Page.captureScreenshot",
                format="png",
                clip={
                    "x": box["x"],
                    "y": box["y"],
                    "width": box["w"],
                    "height": box["h"],
                    "scale": 8,
                },
            )
            out.write_bytes(base64.b64decode(data["data"]))
            print(f"wrote {out} from clip {box}")
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
