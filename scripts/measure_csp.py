"""Measure whether icon art survives a strict Content-Security-Policy.

    .venv/bin/python scripts/measure_csp.py

Loads `os/conformance-csp.html`, which sets `img-src 'self'` with no `data:`, and counts
the painted pixels of its two icons: the left one asks `os/desktop.css` for a
`data:image/svg+xml` background, the right one carries its own `<svg>` node.

The claim being tested is that `img-src` governs images loaded from CSS, so the first is
refused and the second is not. Prints both counts and whether the console said anything,
because "blank and silent" is the part that makes this expensive to diagnose.
"""

from __future__ import annotations

import base64
import io
import pathlib
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from cdp import Browser  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8097

#: The green inside the stylesheet's map sheet, and the yellow of the fixture's own node.
INKS = {"stylesheet-art": (0x8D, 0xC6, 0x3F), "node-art": (0xFF, 0xCC, 0x00)}
SLACK = 40


def count(image, box, inks, slack):
    pixels = image.load()
    out = {name: 0 for name in inks}
    x0, y0, x1, y1 = box
    for y in range(max(y0, 0), min(y1, image.height)):
        for x in range(max(x0, 0), min(x1, image.width)):
            r, g, b = pixels[x, y]
            for name, (ir, ig, ib) in inks.items():
                if abs(r - ir) <= slack and abs(g - ig) <= slack and abs(b - ib) <= slack:
                    out[name] += 1
                    break
    return out


def main() -> int:
    from PIL import Image

    (REPO_ROOT / "screenshots").mkdir(exist_ok=True)
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
            page.call("Log.enable")
            page.call(
                "Emulation.setDeviceMetricsOverride",
                width=700,
                height=420,
                deviceScaleFactor=1,
                mobile=False,
            )
            page.navigate(f"http://127.0.0.1:{PORT}/os/conformance-csp.html")
            time.sleep(1.2)

            boxes = page.evaluate("window.cspFixture.boxes()")
            data = page.call("Page.captureScreenshot", format="png")
            blob = base64.b64decode(data["data"])
            out = REPO_ROOT / "screenshots" / "csp-icons.png"
            out.write_bytes(blob)
            image = Image.open(io.BytesIO(blob)).convert("RGB")

            print(f"\n{'slot':16} {'computed bg':>12} {'svg kids':>9} "
                  f"{'stylesheet px':>14} {'node px':>9}")
            for b in boxes:
                slot = b["art"] or b["kind"] or "?"
                counts = count(image, b["box"], INKS, SLACK)
                print(
                    f"{slot:16} {str(b['backgroundImage']):>12} {b['svgChildren']:>9} "
                    f"{counts['stylesheet-art']:>14} {counts['node-art']:>9}"
                )

            # Did anything say so? The expensive part of this bug is the silence.
            errors = []
            for event in page.consume_events():
                method = event.get("method")
                params = event.get("params") or {}
                if method == "Log.entryAdded":
                    entry = params.get("entry") or {}
                    errors.append(f"{entry.get('level')}: {entry.get('text')}")
                elif method == "Runtime.consoleAPICalled":
                    bits = " ".join(
                        str(a.get("value", a.get("description", "")))
                        for a in (params.get("args") or [])
                    )
                    errors.append(f"console.{params.get('type')}: {bits}")
                elif method == "Runtime.exceptionThrown":
                    details = params.get("exceptionDetails") or {}
                    errors.append(f"uncaught: {details.get('text')}")
            print(f"\nconsole said {len(errors)} thing(s):")
            for e in errors[:8]:
                print(f"  {e}")
            if not errors:
                print("  nothing. A blank icon with no message is the whole problem.")
            print(f"\nwrote {out}")
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
