// Builds the building-outline tiles the owners' roof sheet falls back on, from Microsoft's
// Global ML Building Footprints (Open Data Commons ODbL).
//
//   1. Download the files that cover the service area (see dataset-links.csv at
//      https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv;
//      Brunswick County is quadkeys 032012022, 032012023, 032012200, 032012201).
//   2. node scripts/build-outlines.mjs part1.csv.gz part2.csv.gz ...
//
// Writes public/data/outlines/<lat100>_<lon100>.json, one file per 0.01 degree
// square: each building's center, its area seen from above, and a simplified outline.
import { createReadStream, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

// Brunswick County, with a little to spare.
const BOX = { south: 33.83, north: 34.42, west: -78.7, east: -77.85 };
const MIN_AREA_M2 = 40; // smaller than this is a shed or a carport, not a house
const OUT = join(import.meta.dirname, '..', 'public', 'data', 'outlines');

const M_PER_DEG_LAT = 110_540;
const mPerDegLon = (lat) => 111_320 * Math.cos((lat * Math.PI) / 180);

function areaM2(ring, lat) {
  const kx = mPerDegLon(lat);
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    s += x1 * kx * (y2 * M_PER_DEG_LAT) - x2 * kx * (y1 * M_PER_DEG_LAT);
  }
  return Math.abs(s) / 2;
}

/** Douglas-Peucker in meters, so the outline keeps its shape in fewer points. */
function simplify(points, tolerance) {
  if (points.length <= 3) return points;
  let max = 0;
  let index = 0;
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1e-9;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
    if (d > max) {
      max = d;
      index = i;
    }
  }
  if (max <= tolerance) return [points[0], points[points.length - 1]];
  const left = simplify(points.slice(0, index + 1), tolerance);
  const right = simplify(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

const tiles = new Map();
let kept = 0;
let seen = 0;

for (const file of process.argv.slice(2)) {
  const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    seen++;
    const f = JSON.parse(line);
    if (f.geometry?.type !== 'Polygon') continue;
    const ring = f.geometry.coordinates[0];
    let cx = 0;
    let cy = 0;
    for (const [x, y] of ring.slice(0, -1)) {
      cx += x;
      cy += y;
    }
    cx /= ring.length - 1;
    cy /= ring.length - 1;
    if (cy < BOX.south || cy > BOX.north || cx < BOX.west || cx > BOX.east) continue;
    const area = areaM2(ring, cy);
    if (area < MIN_AREA_M2) continue;
    // Outline relative to the center, in meters, simplified to about 0.5 m.
    const kx = mPerDegLon(cy);
    const local = ring.slice(0, -1).map(([x, y]) => [(x - cx) * kx, (y - cy) * M_PER_DEG_LAT]);
    // A closed ring has the same first and last point, so split it at the vertex farthest from the start.
    let far = 0;
    for (let i = 1; i < local.length; i++) if (Math.hypot(...local[i]) > Math.hypot(...local[far])) far = i;
    const a = local[0];
    const shifted = local.map(([x, y]) => [x - a[0], y - a[1]]);
    far = shifted.reduce((best, p, i) => (Math.hypot(...p) > Math.hypot(...shifted[best]) ? i : best), 0);
    const simple = far === 0
      ? local
      : [...simplify(local.slice(0, far + 1), 0.5).slice(0, -1), ...simplify([...local.slice(far), local[0]], 0.5).slice(0, -1)];
    const lat100 = Math.floor(cy * 100);
    const lon100 = Math.floor(cx * 100);
    const key = `${lat100}_${lon100}`;
    const list = tiles.get(key) ?? [];
    // [center lat and lon in millionths of a degree from the tile's corner, area m2, outline in decimeters]
    list.push([
      Math.round((cy - lat100 / 100) * 1e6),
      Math.round((cx - lon100 / 100) * 1e6),
      Math.round(area),
      simple.flatMap(([x, y]) => [Math.round(x * 10), Math.round(y * 10)]),
    ]);
    tiles.set(key, list);
    kept++;
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
let bytes = 0;
for (const [key, list] of tiles) {
  const body = JSON.stringify({ v: 1, b: list });
  bytes += body.length;
  writeFileSync(join(OUT, `${key}.json`), body);
}
writeFileSync(
  join(OUT, 'LICENSE.txt'),
  [
    'Building outlines for roof measurements, derived from Microsoft Global ML Building Footprints.',
    'Source: https://github.com/microsoft/GlobalMLBuildingFootprints',
    'This database is made available under the Open Database License: https://opendatacommons.org/licenses/odbl/1-0/',
    'Each file holds the buildings in one 0.01 degree square: center (millionths of a degree from the',
    "square's south-west corner), area seen from above in square meters, and a simplified outline in",
    'decimeters from the center. Rebuilt with scripts/build-outlines.mjs.',
    '',
  ].join('\n'),
);
console.log(`read ${seen} buildings, kept ${kept} in ${tiles.size} tiles, ${(bytes / 1e6).toFixed(1)} MB`);
