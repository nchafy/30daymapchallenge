/* The 2026 themes, verbatim from https://30daymapchallenge.com/ (fetched 2026-11-04).
 *
 * The challenge runs 1-30 November 2026, one theme per day. `dir` is the folder under
 * `days/`; a day with `dir: null` has no page yet and is rendered as text rather than as a
 * link, so the index never carries a dead target.
 *
 * Starting a day is two steps: copy `days/_template/` to the `dir` named here, then set
 * `dir` on that row.
 */
export const DAYS = [
  { day: 1, theme: 'Points', dir: null },
  { day: 2, theme: 'Lines' },
  { day: 3, theme: 'Polygons', dir: null },
  { day: 4, theme: 'Clusters', dir: null },
  { day: 5, theme: 'Senses: Sight', dir: null },
  { day: 6, theme: 'Vintage', dir: null },
  { day: 7, theme: '10 minute map', dir: null },
  { day: 8, theme: 'Utopia', dir: null },
  { day: 9, theme: 'Urban-rural', dir: null },
  { day: 10, theme: 'Prompting only', dir: null },
  { day: 11, theme: 'Senses: Sound', dir: null },
  { day: 12, theme: 'Power', dir: null },
  { day: 13, theme: 'Interactions', dir: null },
  { day: 14, theme: 'Borgesian map', dir: null },
  { day: 15, theme: 'Inside out', dir: null },
  { day: 16, theme: 'Collaborative map', dir: null },
  { day: 17, theme: 'Light & dark', dir: null },
  { day: 18, theme: 'NULL', dir: null },
  { day: 19, theme: 'Senses: Smell', dir: null },
  { day: 20, theme: 'Hexagons', dir: null },
  { day: 21, theme: 'OpenStreetMap', dir: null },
  { day: 22, theme: 'Projections', dir: null },
  { day: 23, theme: 'Senses: Taste', dir: null },
  { day: 24, theme: 'Network', dir: null },
  { day: 25, theme: 'Is this a map?', dir: null },
  { day: 26, theme: 'Water', dir: null },
  { day: 27, theme: 'New tool', dir: null },
  { day: 28, theme: 'Senses: Feeling', dir: null },
  { day: 29, theme: 'Raster', dir: null },
  { day: 30, theme: 'Pen & paper', dir: null },
];

/** The base map itself, which is not a challenge day but is the thing every day starts from. */
export const BASE_ENTRY = { day: 0, theme: 'Base map', dir: '00-base' };
