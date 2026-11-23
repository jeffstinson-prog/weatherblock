// The instant estimate's picture: close enough that the measured house fills the frame.
import { afterEach, describe, expect, it } from 'vitest';
import { roofImageUrl, zoomToFit } from '../../src/server/maps';

// A box of the given size in meters around a spot in Ocean Isle Beach.
function box(widthM: number, heightM: number) {
  const lat = 33.8946;
  const lng = -78.4267;
  const dLat = heightM / 2 / 110_540;
  const dLng = widthM / 2 / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { sw: { lat: lat - dLat, lng: lng - dLng }, ne: { lat: lat + dLat, lng: lng + dLng } };
}

describe('the roof picture', () => {
  afterEach(() => {
    delete process.env.GOOGLE_MAPS_STATIC_KEY;
    delete process.env.GOOGLE_MAPS_SIGNING_SECRET;
  });

  it('zooms in as far as it can on a house', () => {
    expect(zoomToFit(box(15, 15))).toBe(20);
    expect(zoomToFit(box(22, 18))).toBe(20);
  });

  it('backs off for a big building, so the whole roof is in the picture', () => {
    expect(zoomToFit(box(50, 45))).toBe(19);
    expect(zoomToFit(box(120, 90))).toBe(18);
  });

  it('never goes wider than a few blocks or closer than the imagery allows', () => {
    expect(zoomToFit(box(2000, 2000))).toBe(16);
    expect(zoomToFit(box(1, 1))).toBe(20);
  });

  it('centers the picture on the roof and sets the zoom itself', () => {
    process.env.GOOGLE_MAPS_STATIC_KEY = 'test-key';
    const url = roofImageUrl(box(15, 15))!;
    expect(url).toContain('center=33.894600,-78.426700');
    expect(url).toContain('zoom=20');
    expect(url).toContain('maptype=satellite');
    expect(url).toContain('path=color:0xffd500ff');
  });

  it('has no picture without a key', () => {
    expect(roofImageUrl(box(15, 15))).toBeNull();
  });
});
