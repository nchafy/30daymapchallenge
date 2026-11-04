#!/usr/bin/env python3
"""Report what a basemap style draws for green space, and at which zooms.

Written to answer one complaint: Central Park, Prospect Park and Flushing Meadows are not
green on the `simple` basemap. A style's own layer list is the only place that answers why,
and reading it beats guessing at paint overrides.

    python3 scripts/inspect_style.py positron liberty bright
"""

from __future__ import annotations

import json
import sys
import urllib.request

BASE = "https://tiles.openfreemap.org/styles/"

#: Source layers in the OpenMapTiles schema that can carry a park, a wood or a meadow.
GREEN_SOURCE_LAYERS = {"park", "landcover", "landuse"}


def fetch(name: str) -> dict:
    # A bare urllib request gets 403: the host filters on User-Agent. The browser is
    # unaffected, which is why the map loads and this script did not.
    request = urllib.request.Request(
        BASE + name,
        headers={"User-Agent": "Mozilla/5.0 (Macintosh) 30daymapchallenge-style-inspector"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def report(name: str) -> None:
    style = fetch(name)
    layers = style.get("layers", [])
    print(f"\n=== {name}: {len(layers)} layers ===")
    for layer in layers:
        source_layer = layer.get("source-layer")
        if source_layer not in GREEN_SOURCE_LAYERS:
            continue
        paint = layer.get("paint") or {}
        print(
            f"  {layer['id']:<34} src={source_layer:<10} type={layer['type']:<6} "
            f"minzoom={layer.get('minzoom', '-'):<4} maxzoom={layer.get('maxzoom', '-')}"
        )
        if layer.get("filter"):
            print(f"      filter {json.dumps(layer['filter'])[:150]}")
        for key in ("fill-color", "fill-opacity", "line-color", "background-color"):
            if key in paint:
                print(f"      {key}: {json.dumps(paint[key])[:150]}")


if __name__ == "__main__":
    for arg in sys.argv[1:] or ["positron"]:
        report(arg)
