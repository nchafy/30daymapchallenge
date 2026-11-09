"""Load the desktop, open the two map programs, and report what happened.

    .venv/bin/python scripts/smoke.py

Fast feedback while the shell is being rewired, and narrower than `scripts/check.py` on
purpose: it answers "does anything work at all", not "is it right". Prints every console
message, because during a port the interesting failure is usually a module that did not
resolve rather than a layout that is wrong.
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
PORT = 8094


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
            page.call("Log.enable")
            page.call(
                "Emulation.setDeviceMetricsOverride",
                width=1280, height=820, deviceScaleFactor=1, mobile=False,
            )
            page.navigate(f"http://127.0.0.1:{PORT}/")
            time.sleep(3.0)

            state = page.evaluate(
                """(() => {
                  const d = window.webxp;
                  if (!d) return { booted: false };
                  return {
                    booted: true,
                    /* `.size`, not `.length`: `programs` is a Map, so `.length` is
                       `undefined` and this printed nothing on every run. And the icon class
                       is `desktop-icon`, so `.icon` matched none of them and printed
                       `icons: 0` — which during a port is exactly the signal someone acts
                       on. Nothing asserts either, so the script did not fail; it misreported. */
                    programs: d.programs ? d.programs.size : null,
                    icons: document.querySelectorAll('#webxp .desktop-icon').length,
                    taskButtons: document.querySelectorAll('#webxp .task-button').length,
                    windows: document.querySelectorAll('#webxp .window').length,
                    titles: [...document.querySelectorAll('#webxp .window-title h1, #webxp .window-title h2')]
                      .map((h) => h.textContent.trim()),
                  };
                })()"""
            )
            print(f"boot: {state}")

            if state.get("booted"):
                # Open the base map by its program id, the way a desktop icon would. This was
                # day 2 until day 2 moved to webxp; the base map is the program this repo
                # still has.
                opened = page.evaluate(
                    """(() => window.webxp.launch('00-base')
                         .then(() => 'launched')
                         .catch((e) => 'failed: ' + e.message))()""",
                    await_promise=True,
                )
                print(f"launch 00-base: {opened}")
                time.sleep(6.0)
                after = page.evaluate(
                    """(() => {
                      const canvas = document.querySelector('.maplibregl-canvas');
                      const frame = document.querySelector('.map-frame');
                      const attrib = document.querySelector('.map-attrib');
                      const cards = document.querySelectorAll('.overlay-cards .card').length;
                      const box = frame ? frame.getBoundingClientRect() : null;
                      return {
                        windows: document.querySelectorAll('#webxp .window').length,
                        canvas: Boolean(canvas && canvas.width > 0),
                        canvasSize: canvas ? [canvas.width, canvas.height] : null,
                        frameBox: box ? [Math.round(box.width), Math.round(box.height)] : null,
                        dayCards: cards,
                        attrib: attrib ? attrib.textContent.trim().slice(0, 60) : null,
                        status: (document.querySelector('.map-status') || {}).textContent || '',
                        hasLines: Boolean(window.lines),
                        activities: window.lines ? window.lines.activities().length : null,
                      };
                    })()"""
                )
                for k, v in after.items():
                    print(f"  {k}: {v}")

            data = page.call("Page.captureScreenshot", format="png")
            shot = out_dir / "smoke.png"
            shot.write_bytes(base64.b64decode(data["data"]))
            print(f"\nwrote {shot}")

            msgs = []
            for event in page.consume_events():
                method = event.get("method")
                params = event.get("params") or {}
                if method == "Log.entryAdded":
                    e = params.get("entry") or {}
                    msgs.append(f"{e.get('level')}: {e.get('text')}")
                elif method == "Runtime.consoleAPICalled":
                    bits = " ".join(
                        str(a.get("value", a.get("description", "")))
                        for a in (params.get("args") or [])
                    )
                    msgs.append(f"console.{params.get('type')}: {bits}")
                elif method == "Runtime.exceptionThrown":
                    d = params.get("exceptionDetails") or {}
                    desc = (d.get("exception") or {}).get("description") or d.get("text")
                    msgs.append(f"UNCAUGHT: {desc}")
            print(f"\n{len(msgs)} console message(s):")
            for m in msgs[:25]:
                print(f"  {m}")
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
