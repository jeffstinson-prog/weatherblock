// Address to a point, for the instant estimate, from the U.S. Census Bureau's
// free geocoder (public domain). Google's address data stays in the booking
// form: its terms don't allow pairing its locations with other map data.
import { appEnv } from './env';

export interface GeoMatch {
  /** As the Census Bureau writes it, in capitals: "101 OCEAN BLVD W, HOLDEN BEACH, NC, 28462". */
  address: string;
  lat: number;
  lon: number;
}

// Test addresses, placed on real house-sized buildings in the outline tiles.
const FAKE: Record<string, GeoMatch> = {
  'test-oib': { address: '101 TEST BEACH DR W, OCEAN ISLE BEACH, NC, 28469', lat: 33.895447, lon: -78.434496 },
  'test-shallotte': { address: '404 TEST MAIN ST, SHALLOTTE, NC, 28470', lat: 33.974452, lon: -78.379911 },
  'test-nowhere': { address: '1 TEST FAR RD, RALEIGH, NC, 27601', lat: 35.7796, lon: -78.6382 },
};

function fake(query: string): GeoMatch[] {
  const q = query.toLowerCase();
  if (q.includes('test beach')) return [FAKE['test-oib']!];
  if (q.includes('test main')) return [FAKE['test-shallotte']!];
  if (q.includes('test far')) return [FAKE['test-nowhere']!];
  return [];
}

export async function geocode(query: string): Promise<GeoMatch[]> {
  if (appEnv() === 'test') return fake(query);
  const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
  url.searchParams.set('address', query);
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('format', 'json');
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Census geocoder ${res.status}`);
  const data = (await res.json()) as {
    result?: { addressMatches?: { matchedAddress: string; coordinates: { x: number; y: number }; addressComponents?: { state?: string } }[] };
  };
  return (data.result?.addressMatches ?? [])
    .filter((m) => (m.addressComponents?.state ?? 'NC') === 'NC')
    .slice(0, 3)
    .map((m) => ({ address: m.matchedAddress, lat: m.coordinates.y, lon: m.coordinates.x }));
}
