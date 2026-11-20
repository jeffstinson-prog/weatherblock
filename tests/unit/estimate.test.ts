// The instant estimate's math: roof size from an outline, prices from facts.yaml, and finding the house.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { facts } from '../../src/facts';
import {
  candidates,
  distanceTo,
  outlineFromHouse,
  parseTile,
  roofEstimate,
  tileKey,
  tilesAround,
  type Building,
  type PriceConfig,
} from '../../src/estimate/roof';

const cfg: PriceConfig = { pricePerSquare: 450, largeRoof: { minSquares: 30, pricePerSquare: [350, 400] }, slopeFactor: [1.1, 1.3] };

describe('roof size and price', () => {
  it('a typical house: price per square across the slope range, rounded out to $100', () => {
    const r = roofEstimate(150, cfg); // about 1,615 square feet from above
    expect(r.outlineSqft).toBe(1615);
    expect(r.roofSqft).toEqual([1776, 2099]);
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
    expect(roofEstimate(m2, cfg).price).not.toBeNull();
  });

  it("uses the prices in facts.yaml, and the text says the same numbers", () => {
    const e = facts.instantEstimate;
    expect(e.pricePerSquare).toBe(450);
    expect(e.largeRoof).toEqual({ minSquares: 30, pricePerSquare: [350, 400] });
    expect(facts.derived.roofPriceText).toBe(
      '$450 per square (100 square feet) for architectural shingles, installed. On roofs of 30 squares or more, $350 to $400 per square.',
    );
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
