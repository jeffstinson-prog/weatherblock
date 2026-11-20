// The instant estimate's math: find the house in the outline tiles, size the
// roof, and turn it into a price range from facts.yaml. Pure functions, so the
// page and the tests share them.

export interface Building {
  lat: number;
  lon: number;
  /** Area seen from above, square meters. */
  areaM2: number;
  /** Outline in meters east and north of the center. */
  outline: [number, number][];
}

export interface Candidate extends Building {
  /** Meters from the address point to the building (0 when the point is inside it). */
  distanceM: number;
}

export interface TileData {
  v: 1;
  b: [number, number, number, number[]][];
}

const M_PER_DEG_LAT = 110_540;
const mPerDegLon = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);
export const SQFT_PER_M2 = 10.7639;

export const tileKey = (lat: number, lon: number) => `${Math.floor(lat * 100)}_${Math.floor(lon * 100)}`;

/** The tiles that cover a circle around a point. */
export function tilesAround(lat: number, lon: number, radiusM = 80): string[] {
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLon = radiusM / mPerDegLon(lat);
  const keys = new Set<string>();
  for (const a of [lat - dLat, lat, lat + dLat]) for (const o of [lon - dLon, lon, lon + dLon]) keys.add(tileKey(a, o));
  return [...keys];
}

export function parseTile(key: string, data: TileData): Building[] {
  const [lat100, lon100] = key.split('_').map(Number) as [number, number];
  return data.b.map(([dLat, dLon, area, ring]) => {
    const outline: [number, number][] = [];
    for (let i = 0; i + 1 < ring.length; i += 2) outline.push([ring[i]! / 10, ring[i + 1]! / 10]);
    return { lat: lat100 / 100 + dLat / 1e6, lon: lon100 / 100 + dLon / 1e6, areaM2: area, outline };
  });
}

function insidePolygon(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToSegment(px: number, py: number, [ax, ay]: [number, number], [bx, by]: [number, number]): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Meters from a point to a building's outline; 0 inside it. */
export function distanceTo(b: Building, lat: number, lon: number): number {
  const x = (lon - b.lon) * mPerDegLon(b.lat);
  const y = (lat - b.lat) * M_PER_DEG_LAT;
  if (b.outline.length < 3) return Math.hypot(x, y);
  if (insidePolygon(x, y, b.outline)) return 0;
  let best = Infinity;
  for (let i = 0; i < b.outline.length; i++) best = Math.min(best, distanceToSegment(x, y, b.outline[i]!, b.outline[(i + 1) % b.outline.length]!));
  return best;
}

/** Houses near the address point, most likely first. A street address point sits on the road, so
 *  nearness counts, but a house-sized building beats a shed that happens to be closer. */
export function candidates(buildings: Building[], lat: number, lon: number, maxM = 70): Candidate[] {
  const near = buildings
    .map((b) => ({ ...b, distanceM: distanceTo(b, lat, lon) }))
    .filter((b) => b.distanceM <= maxM);
  const score = (b: Candidate) => b.distanceM + (b.areaM2 < 60 ? 25 : 0);
  return near.sort((a, b) => score(a) - score(b)).slice(0, 6);
}

export interface PriceConfig {
  pricePerSquare: number;
  largeRoof: { minSquares: number; pricePerSquare: [number, number] };
  /** Google's measured roof area times this range (waste, and what imagery can't see). */
  measuredRange: [number, number];
  /** An outline's area times this range, for the slope we can't see. */
  slopeFactor: [number, number];
}

export interface RoofEstimate {
  outlineSqft: number;
  roofSqft: [number, number];
  squares: [number, number];
  /** Null when the building is too big or too small to guess at. */
  price: [number, number] | null;
}

/** The biggest outline we'll price: past this it's a townhome row, a business, or a mistake. */
export const MAX_OUTLINE_M2 = 600;
const MIN_OUTLINE_M2 = 40;

const half = (n: number) => Math.round(n * 2) / 2;
/** Square feet to the nearest 10: the measurement is rough, and the numbers shouldn't pretend otherwise. */
const ten = (n: number) => Math.round(n / 10) * 10;

/** From an outline seen from above: the roof is bigger by the slope we can't see. */
export function roofEstimate(outlineM2: number, cfg: PriceConfig): RoofEstimate {
  const outlineSqft = outlineM2 * SQFT_PER_M2;
  const roof: [number, number] = [outlineSqft * cfg.slopeFactor[0], outlineSqft * cfg.slopeFactor[1]];
  const ok = outlineM2 <= MAX_OUTLINE_M2 && outlineM2 >= MIN_OUTLINE_M2;
  return { outlineSqft: ten(outlineSqft), ...priced(roof, cfg, ok) };
}

/** From Google's measurement of the roof itself (slope included): a range for waste and what imagery can't see. */
export function measuredEstimate(roofM2: number, groundM2: number, cfg: PriceConfig): RoofEstimate {
  const sqft = roofM2 * SQFT_PER_M2;
  const roof: [number, number] = [sqft * cfg.measuredRange[0], sqft * cfg.measuredRange[1]];
  const ok = groundM2 <= MAX_OUTLINE_M2 && groundM2 >= MIN_OUTLINE_M2;
  return { outlineSqft: ten(groundM2 * SQFT_PER_M2), ...priced(roof, cfg, ok) };
}

/** Pitch in degrees as roofers say it: rise in inches per 12 of run. */
export const pitchLabel = (degrees: number) => `${Math.max(1, Math.round(Math.tan((degrees * Math.PI) / 180) * 12))}/12`;

function priced(roof: [number, number], cfg: PriceConfig, ok: boolean): Omit<RoofEstimate, 'outlineSqft'> {
  const squares: [number, number] = [half(roof[0] / 100), half(roof[1] / 100)];
  if (!ok) return { roofSqft: [ten(roof[0]), ten(roof[1])], squares, price: null };
  // Price at each end of the size range, and at the large-roof line if the range crosses it.
  const min = cfg.largeRoof.minSquares;
  const lows: number[] = [];
  const highs: number[] = [];
  const at = (sq: number) => {
    if (sq < min) {
      lows.push(sq * cfg.pricePerSquare);
      highs.push(sq * cfg.pricePerSquare);
    } else {
      lows.push(sq * cfg.largeRoof.pricePerSquare[0]);
      highs.push(sq * cfg.largeRoof.pricePerSquare[1]);
    }
  };
  const [lo, hi] = [roof[0] / 100, roof[1] / 100];
  at(lo);
  at(hi);
  if (lo < min && hi >= min) {
    at(min - 0.01);
    at(min);
  }
  const low = Math.floor(Math.min(...lows) / 100) * 100;
  const high = Math.ceil(Math.max(...highs) / 100) * 100;
  return { roofSqft: [ten(roof[0]), ten(roof[1])], squares, price: [low, high] };
}

/** When there's no outline, or it's wrong: the house's size from above, from heated square feet and stories.
 *  Porches, garages and overhangs add about 15 percent. */
export function outlineFromHouse(heatedSqft: number, stories: number): number {
  return ((heatedSqft / Math.max(1, stories)) * 1.15) / SQFT_PER_M2;
}

export const dollars = (n: number) => `$${n.toLocaleString('en-US')}`;
