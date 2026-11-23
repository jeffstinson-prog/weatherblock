// Roof math and the owners' roof sheet: roof size from Google's measurement or an outline,
// a ballpark from facts.yaml, and finding the house. All of it is for the owners.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { facts } from '../../src/facts';
import {
  candidates,
  distanceTo,
  measuredEstimate,
  outlineFromHouse,
  pitchLabel,
  parseTile,
  roofEstimate,
  tileKey,
  tilesAround,
  type Building,
  type PriceConfig,
} from '../../src/server/roof';
import { asRoofSheet, customerBallpark, imageryMonth, measureRoof, roofSummary } from '../../src/server/roofsheet';

const cfg: PriceConfig = { pricePerSquare: 450, largeRoof: { minSquares: 30, pricePerSquare: [350, 400] }, measuredRange: [1.0, 1.15], slopeFactor: [1.1, 1.3] };

describe('roof size and price', () => {
  it('a typical house: price per square across the slope range, rounded out to $100', () => {
    const r = roofEstimate(150, cfg); // about 1,615 square feet from above
    expect(r.outlineSqft).toBe(1610);
    expect(r.roofSqft).toEqual([1780, 2100]);
    expect(r.squares).toEqual([18, 21]);
    expect(r.price).toEqual([7900, 9500]);
  });

  it('a big roof gets the large-roof price per square', () => {
    const r = roofEstimate(260, cfg);
    expect(r.squares[0]).toBeGreaterThanOrEqual(30);
    expect(r.price).toEqual([10700, 14600]);
  });

  it('a range that crosses the large-roof line covers both prices', () => {
    const r = roofEstimate(240, cfg); // 28.4 to 33.6 squares
    expect(r.price).toEqual([10500, 13500]);
  });

  it('no price for a building too big or too small to be one house', () => {
    expect(roofEstimate(900, cfg).price).toBeNull();
    expect(roofEstimate(20, cfg).price).toBeNull();
  });

  it('from heated square feet and stories, with an allowance for porches and overhangs', () => {
    const m2 = outlineFromHouse(1800, 2);
    expect(Math.round(m2 * 10.7639)).toBe(1035);
    expect(roofEstimate(m2, cfg).outlineSqft).toBe(1040);
    expect(roofEstimate(m2, cfg).price).not.toBeNull();
  });

  it("Google's measured roof: from as measured to 15% more, priced the same way", () => {
    const r = measuredEstimate(209, 187, cfg);
    expect(r.roofSqft).toEqual([2250, 2590]);
    expect(r.squares).toEqual([22.5, 26]);
    expect(r.price).toEqual([10100, 11700]);
    expect(r.outlineSqft).toBe(2010);
    expect(measuredEstimate(900, 800, cfg).price).toBeNull();
  });

  it('says pitch the way roofers do', () => {
    expect(pitchLabel(26.57)).toBe('6/12');
    expect(pitchLabel(18.43)).toBe('4/12');
    expect(pitchLabel(45)).toBe('12/12');
  });

  it('uses the prices in facts.yaml', () => {
    const e = facts.estimate;
    expect(e.pricePerSquare).toBe(450);
    expect(e.largeRoof).toEqual({ minSquares: 30, pricePerSquare: [350, 400] });
    expect(e.showBallpark).toBe(false);
  });
});

describe("the owners' roof sheet", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    facts.estimate.showBallpark = false;
  });

  // The site's own outline files, read from disk instead of over the network.
  const outlinesFromDisk = () =>
    vi.stubGlobal('fetch', async (url: string | URL) => {
      const m = /\/data\/outlines\/([\d_-]+\.json)$/.exec(String(url));
      try {
        return new Response(readFileSync(`public/data/outlines/${m![1]}`, 'utf8'), { status: 200 });
      } catch {
        return new Response('', { status: 404 });
      }
    });

  it("measures the test house with the stand-in for Google's data", async () => {
    process.env.APP_ENV = 'test';
    const sheet = await measureRoof(33.895447, -78.434496);
    expect(sheet).toMatchObject({ source: 'google', sqft: [2250, 2590], squares: [22.5, 26], pitch: '6/12', imageryDate: '2025-03-10', ballpark: [10100, 11700] });
    expect(sheet!.box).not.toBeNull();
    expect(roofSummary(sheet)).toBe('Roof about 22.5 squares (2,250 square feet), 6/12 pitch. Ballpark $10,100 to $11,700.');
    expect(imageryMonth(sheet!.imageryDate)).toBe('March 2025');
  });

  it("falls back to the building's outline when Google has nothing", async () => {
    process.env.APP_ENV = 'test';
    outlinesFromDisk();
    const sheet = await measureRoof(33.974452, -78.379911); // 404 Test Main St: no Google data in tests
    expect(sheet).toMatchObject({ source: 'outline', pitch: '', imageryDate: '', box: null, ballpark: [9400, 11200] });
    expect(roofSummary(sheet)).toMatch(/^Roof about [\d.]+ to [\d.]+ squares, from the building's outline\. Slope not known\. Ballpark \$9,400 to \$11,200\.$/);
  });

  it("doesn't keep the owners' alert waiting: past its time budget, the measurement gives up", async () => {
    process.env.APP_ENV = 'test';
    vi.stubGlobal('fetch', () => new Promise(() => {})); // a lookup that never answers
    const started = Date.now();
    expect(await measureRoof(33.974452, -78.379911, 50)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('gives nothing, without failing, when neither has the house or the lookup is down', async () => {
    process.env.APP_ENV = 'test';
    vi.stubGlobal('fetch', async () => {
      throw new Error('network down');
    });
    expect(await measureRoof(33.974452, -78.379911)).toBeNull();
    expect(roofSummary(null)).toBe('Roof not measured from above.');
  });

  it('shows customers a ballpark only when the facts file says so', () => {
    const sheet = asRoofSheet({ source: 'google', sqft: [2250, 2590], squares: [22.5, 26], pitch: '6/12', imageryDate: '2025-03-10', box: null, ballpark: [10100, 11700] });
    expect(customerBallpark(sheet)).toBeNull();
    facts.estimate.showBallpark = true;
    expect(customerBallpark(sheet)).toEqual({ low: '$10,100', high: '$11,700', material: 'architectural shingles' });
    expect(customerBallpark(null)).toBeNull();
  });

  it('says so when a building is too big to price, and reads stored sheets with care', () => {
    const big = asRoofSheet({ source: 'google', sqft: [9600, 11040], squares: [96, 110.5], pitch: '4/12', imageryDate: '', box: null, ballpark: null });
    expect(roofSummary(big)).toBe('Roof about 96 squares (9,600 square feet), 4/12 pitch. Too big or too small to price from above.');
    expect(asRoofSheet(null)).toBeNull();
    expect(asRoofSheet({ source: 'somewhere', sqft: [1, 2], squares: [1, 2] })).toBeNull();
    expect(asRoofSheet({ source: 'google' })).toBeNull();
  });
});

describe('finding the house', () => {
  const square = (lat: number, lon: number, sideM: number, areaM2 = sideM * sideM): Building => ({
    lat,
    lon,
    areaM2,
    outline: [
      [-sideM / 2, -sideM / 2],
      [sideM / 2, -sideM / 2],
      [sideM / 2, sideM / 2],
      [-sideM / 2, sideM / 2],
    ],
  });

  it('measures distance to the outline, zero inside it', () => {
    const b = square(33.9, -78.4, 14);
    expect(distanceTo(b, 33.9, -78.4)).toBe(0);
    expect(distanceTo(b, 33.9 - 12 / 110_540, -78.4)).toBeCloseTo(5, 0);
  });

  it('prefers a house-sized building over a closer shed, and lists the rest in order', () => {
    const shed = square(33.9 - 9 / 110_540, -78.4, 4);
    const house = square(33.9 + 14 / 110_540, -78.4, 13);
    const neighbor = square(33.9, -78.4 + 45 / 92_000, 13);
    const far = square(33.9, -78.4 + 300 / 92_000, 13);
    const found = candidates([far, neighbor, shed, house], 33.9, -78.4);
    expect(found.map((b) => b.areaM2)).toEqual([169, 16, 169]);
    expect(found[0]!.lat).toBe(house.lat);
    expect(found.some((b) => b.lon === far.lon)).toBe(false);
  });

  it('reads the real tile for a test address and finds a house there', () => {
    const lat = 33.895447;
    const lon = -78.434496;
    expect(tilesAround(lat, lon)).toContain(tileKey(lat, lon));
    const key = tileKey(lat, lon);
    const tile = parseTile(key, JSON.parse(readFileSync(`public/data/outlines/${key}.json`, 'utf8')));
    expect(tile.length).toBeGreaterThan(100);
    const [best] = candidates(tile, lat, lon);
    expect(best!.areaM2).toBe(170);
    expect(best!.distanceM).toBeLessThan(15);
  });
});
