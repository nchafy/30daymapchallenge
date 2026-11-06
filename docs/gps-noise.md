# Day 2: how long was the run?

Two lengths for the same activity, neither of them the answer.

- **As recorded.** Sum the distances between consecutive trackpoints. Receiver jitter is
  indistinguishable from movement, so every wobble is counted as ground covered. This
  overestimates.
- **Snapped to the map.** Fit the trace to the OpenStreetMap network and measure the path
  the matcher fitted. Matching follows way centrelines, so it cuts corners and never sees
  a weave around a dog. This underestimates.

The gap between them is not an error bar on a known value. It is the width of the
question. A polyline's length depends on the resolution it is measured at, which is the
coastline paradox ([Mandelbrot
1967](https://doi.org/10.1126/science.156.3775.636)) happening on a 5 km run.

So the page measures the whole curve rather than its two ends. The slider simplifies the
recorded trace at a tolerance the reader picks, and the total falls as the wobble comes
out. There is no setting at which the number is right.

## The pipeline

```
.venv/bin/python days/02-lines/prepare.py ~/Downloads/strava_export
```

Reads GPX, FIT and TCX (gzipped or not), measures each activity, snaps it to the network,
and writes one JSON per activity plus an `index.json` into `days/02-lines/private/`, which
is gitignored. The page looks there first and falls back to the committed
`days/02-lines/data/`, which holds the synthetic fixture.

Writing into `data/` takes an explicit `--out` and is only for regenerating the fixture.
The split is deliberate: `data/` is tracked, so a default that wrote there would mean the
command above overwrites committed files with real traces, and the next `git add -A`
publishes them.

| File | What it is |
| --- | --- |
| `gpsnoise.py` | The measurement library: projection, length, Douglas-Peucker, file readers, map matching. |
| `prepare.py` | The CLI. Walks an export, measures, writes the page's data. |
| `geo.mjs` | The same length and simplification arithmetic, in the browser, so the slider can be continuous. |
| `map.mjs` | The two line layers, the slider, the detail panel. |
| `make_fixture.py` | Builds a synthetic export whose true answer is known. |
| `test_gpsnoise.py` | Unit checks, plus `--negative-control`. |
| `test_matching.py` | Integration checks against the live matcher. |
| `test_pipeline.py` | Holds `prepare.py`'s output against the fixture's truth. |

## Measuring in a local plane

Everything works in a tangent plane built once per trace, not on lat/lon. The scale
factors are the WGS84 radii of curvature at the trace's own origin: the meridional radius
for north, the prime-vertical radius times cos(lat) for east. Length, perpendicular
distance and simplification are then plane geometry and agree with each other by
construction.

Over the few km of one run the planar error is of order (L/R)², about 3 mm over 5 km.
Doing it on a sphere of mean radius instead was measured — by sabotaging the projection in
`test_gpsnoise.py --negative-control` — to skew a degree of latitude by +0.14% and a
degree of longitude by −0.25%. That is the same size as the inflation on a clean trace, so
the ellipsoid is load-bearing rather than fussy.

The origin is the bounding-box midpoint, rounded to six decimal places by an explicitly
written rule rather than by either language's `round`. Not for accuracy: for
reproducibility. `geo.mjs` recomputes all of this, and Douglas-Peucker compares distances
against a threshold, so two origins differing in the last bits can keep different points.

## Two implementations of one calculation

`geo.mjs` duplicates what `gpsnoise.py` does, which is the thing this repo's
[code-design rules](../README.md) exist to prevent. The reason is the slider: a continuous
control has to re-simplify in the browser, and shipping a geometry per rung would make it
stepped and the payload several times larger.

The guard is that `prepare.py` writes its own ladder into every activity document and
`scripts/check.py` drives the browser's implementation over the same geometry and requires
agreement — on the integer count of surviving points, which carries no rounding, and on
the lengths to 2 mm. They currently agree to 0.43 mm across twelve rungs with identical
point sets at every one.

That check found two real defects. Lengths were being written at one decimal place, which
put a 3e-5 floor under any comparison; they are now written at three. And it is why
`frame_origin` exists at all.

## What was verified, and how

The hard part of measuring GPS noise is that a wrong pipeline still produces a plausible
number. "About 2% inflation" looks right whether or not the projection, the variance, or
the polyline precision is correct. So nothing here is checked against another measurement
of itself.

- **Against a closed form.** For a straight path sampled every `d` metres with
  independent per-point noise of sigma σ, the measured step is Rice-distributed and its
  mean is known in closed form ([Rice
  1945](https://doi.org/10.1002/j.1538-7305.1945.tb00453.x)). `test_gpsnoise.py` builds a
  trace whose true length is exact by construction and requires the measured inflation to
  match the prediction. It does, to better than 0.2% across three noise regimes.
- **Against published values.** A degree of latitude and a degree of longitude at 40°N,
  to 2e-4.
- **Against a known route.** `test_matching.py` asks Valhalla to route between two points,
  resamples the path, displaces every point by noise, and feeds it back as a recording.
  Matching recovers the length Valhalla itself reported to within 0.5% on street grid,
  park path and waterfront.
- **Against the fixture's truth.** `test_pipeline.py` holds the whole CLI against
  `fixture/truth.json`: matching recovered the route length to within 0.51% on all six
  activities, and the GPX round trip is lossless to 0.08%.
- **Negative controls.** `test_gpsnoise.py --negative-control` sabotages the projection,
  the noise variance and the polyline precision in turn and requires each to produce a
  failure. The pixel check in `scripts/check.py` has its threshold set from the measured
  gap between a healthy render and a sabotaged one, not from a guess.

### The white-noise caveat

The Rice model assumes independent per-point error, and real receiver error is not
independent. It is dominated by satellite geometry and atmospheric delay, which drift over
tens of seconds, so consecutive points share most of their error and their difference
carries far less than 2σ². That is why a real trace is inflated by a few percent while the
fixture, built with white noise, is inflated by 20% to 270%.

The model is the right reference for checking the arithmetic against a known answer and
the wrong one for predicting a real activity. The fixture is a test, not a claim.

## Two things the page cannot tell you

**Strava's own figure is not the raw sum.** The bulk export hands back the file the device
uploaded, and Strava's reported distance is computed by its own smoothing — and for a
device with a footpod or wheel sensor may not come from GPS at all. `prepare.py` reads the
reported figure from `activities.csv` and shows it beside the others rather than claiming
to reproduce it.

**The CSV's units are worked out by measurement.** Strava's export CSV is not a stable
interface: the column set has changed between exports and two differently-scaled
`Distance` columns have appeared in one file. So `resolve_distance_unit` infers the scale
from the median ratio to the matched length and **refuses** when the answer is ambiguous.
Kilometres and miles are only a factor of 1.609 apart, so this only works against an
accurate reference — against the inflated recorded length the two are indistinguishable,
and an early version read a kilometres column as miles.

## Privacy and licensing

An activity trace records where someone lives and when they are not home.

- Real exports are gitignored (`strava-export/`, `strava_export*/`).
- `prepare.py` writes to `days/02-lines/private/`, which is gitignored, and prints where
  it is writing on every run.
- `days/02-lines/fixture/` and the `data/` built from it are synthetic and are committed,
  so the page renders for someone with no export.

The private output path is not a convenience. The first version defaulted to `data/`,
which is tracked — so following the documented command and committing would have published
real home locations to a public repo, while this document claimed the opposite. It was
caught by review, not by a check, which is why `prepare.py` now also says the destination
out loud.

Map matching uses the [FOSSGIS](https://www.fossgis.de/) public Valhalla instance at
`valhalla1.openstreetmap.de`, which is a volunteer-run service. `prepare.py` identifies
itself in a `User-Agent` and pauses a second between calls. A whole-history export is
thousands of requests; for that, run Valhalla locally in Docker against an OSM extract
rather than leaning on the public instance.

Matched geometry derives from OpenStreetMap and is therefore © OpenStreetMap contributors
under the [ODbL](https://www.openstreetmap.org/copyright).
