// The roof sheet the owners get with an estimate request or a booking: the
// roof measured from above, and a ballpark from facts.yaml. It is for the
// owners. The site shows customers no price unless facts.estimate.showBallpark is on.
import { facts } from '../facts';
import { config } from './env';
import {
  candidates,
  measuredEstimate,
  parseTile,
  pitchLabel,
  roofEstimate,
  tilesAround,
  type Candidate,
  type PriceConfig,
  type TileData,
} from './roof';
import { roofFromSolar } from './solar';

export interface RoofSheet {
  /** google: measured from aerial imagery. outline: sized from the building's outline, slope unknown. */
  source: 'google' | 'outline';
  /** Roof area with its slope, square feet. Google: as measured, then with waste. An outline: low and high. */
  sqft: [number, number];
  squares: [number, number];
  /** "6/12", or "" when we don't know it. */
  pitch: string;
  /** When Google's imagery was taken (YYYY-MM-DD), or "". */
  imageryDate: string;
  /** Google's box around the roof, for the picture. */
  box: { sw: { lat: number; lng: number }; ne: { lat: number; lng: number } } | null;
  /** A ballpark for a new roof, dollars. Null for a building too big or too small to price from above. */
  ballpark: [number, number] | null;
}

export function priceConfig(): PriceConfig {
  const e = facts.estimate;
  return { pricePerSquare: e.pricePerSquare, largeRoof: e.largeRoof, measuredRange: e.measuredRange, slopeFactor: e.slopeFactor };
}

/** The house nearest a point in the open building outlines, read from this site's own files. */
async function outlineNear(lat: number, lng: number): Promise<Candidate | null> {
  const site = config.siteUrl();
  const lists = await Promise.all(
    tilesAround(lat, lng, 80).map(async (k) => {
      const res = await fetch(`${site}/data/outlines/${k}.json`, { signal: AbortSignal.timeout(3000) });
      return res.ok ? parseTile(k, (await res.json()) as TileData) : [];
    }),
  );
  return candidates(lists.flat(), lat, lng)[0] ?? null;
}

/** A promise's answer if it comes within `ms`, otherwise null. */
async function within<T>(ms: number, work: Promise<T | null>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Measure the roof at a point. Google first; when Google has no building there,
 * the outline in open building data; null when neither has it, or when it takes
 * longer than `budgetMs`. Never throws: a request or a booking must not fail, or
 * keep the owners waiting for their alert, because a measurement did.
 * Owners can measure again from the app.
 */
export function measureRoof(lat: number, lng: number, budgetMs = 5000): Promise<RoofSheet | null> {
  return within(budgetMs, measure(lat, lng));
}

async function measure(lat: number, lng: number): Promise<RoofSheet | null> {
  const cfg = priceConfig();
  const solar = await roofFromSolar(lat, lng).catch((err) => {
    console.error('solar lookup failed', err);
    return null;
  });
  if (solar) {
    const est = measuredEstimate(solar.areaM2, solar.groundAreaM2, cfg);
    return {
      source: 'google',
      sqft: est.roofSqft,
      squares: est.squares,
      pitch: solar.segments > 0 ? pitchLabel(solar.pitchDegrees) : '',
      imageryDate: solar.imageryDate,
      box: solar.box,
      ballpark: est.price,
    };
  }
  const house = await outlineNear(lat, lng).catch(() => null);
  if (!house) return null;
  const est = roofEstimate(house.areaM2, cfg);
  return { source: 'outline', sqft: est.roofSqft, squares: est.squares, pitch: '', imageryDate: '', box: null, ballpark: est.price };
}

/** A stored sheet, read back from the database. Anything that isn't one is treated as "not measured". */
export function asRoofSheet(v: unknown): RoofSheet | null {
  const r = v as Partial<RoofSheet> | null;
  if (!r || (r.source !== 'google' && r.source !== 'outline') || !Array.isArray(r.sqft) || !Array.isArray(r.squares)) return null;
  return {
    source: r.source,
    sqft: [Number(r.sqft[0]), Number(r.sqft[1])],
    squares: [Number(r.squares[0]), Number(r.squares[1])],
    pitch: typeof r.pitch === 'string' ? r.pitch : '',
    imageryDate: typeof r.imageryDate === 'string' ? r.imageryDate : '',
    box: r.box ?? null,
    ballpark: Array.isArray(r.ballpark) ? [Number(r.ballpark[0]), Number(r.ballpark[1])] : null,
  };
}

const dollars = (n: number) => `$${n.toLocaleString('en-US')}`;
const count = (n: number) => n.toLocaleString('en-US');

/** "March 2025" from "2025-03-10". */
export function imageryMonth(iso: string): string {
  return iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
}

/** The roof in a sentence or two, for the owners' alert and the app. */
export function roofSummary(roof: RoofSheet | null): string {
  if (!roof) return 'Roof not measured from above.';
  const size =
    roof.source === 'google'
      ? `Roof about ${roof.squares[0]} squares (${count(roof.sqft[0])} square feet)${roof.pitch ? `, ${roof.pitch} pitch` : ''}.`
      : `Roof about ${roof.squares[0]} to ${roof.squares[1]} squares, from the building's outline. Slope not known.`;
  const price = roof.ballpark ? `Ballpark ${dollars(roof.ballpark[0])} to ${dollars(roof.ballpark[1])}.` : 'Too big or too small to price from above.';
  return `${size} ${price}`;
}

/** The ballpark as the customer may see it, and only when the facts file says to show one. */
export function customerBallpark(roof: RoofSheet | null): { low: string; high: string; material: string } | null {
  if (!facts.estimate.showBallpark || !roof?.ballpark) return null;
  return { low: dollars(roof.ballpark[0]), high: dollars(roof.ballpark[1]), material: facts.estimate.material };
}
