// Address lookup and the satellite image.
// With GOOGLE_MAPS_SERVER_KEY set, uses Google Places (New). Without it, a small
// set of made-up test addresses, so tests and previews never call Google.
import { facts } from '../facts';
import { config, isProduction } from './env';
import { sign, verify } from './tokens';
import { createHmac } from 'node:crypto';

export interface Suggestion {
  placeId: string;
  main: string;
  secondary: string;
}

export interface Place {
  placeId: string;
  text: string;
  lat: number;
  lng: number;
  county: string;
  city: string;
  zip: string;
  state: string;
}

export interface CheckedPlace extends Place {
  inArea: boolean;
  /** Signature over the fields above, so the booking can trust them later. */
  sig: string;
}

// Center of Brunswick County, NC, to bias suggestions toward it.
const BIAS = { latitude: 33.97, longitude: -78.25 };

const FAKE: Place[] = [
  { placeId: 'test-oib-1', text: '101 Test Beach Dr W, Ocean Isle Beach, NC 28469', lat: 33.895447, lng: -78.434496, county: 'Brunswick', city: 'Ocean Isle Beach', zip: '28469', state: 'NC' },
  { placeId: 'test-oib-2', text: '202 Test Causeway Rd, Ocean Isle Beach, NC 28469', lat: 33.9101, lng: -78.4267, county: 'Brunswick', city: 'Ocean Isle Beach', zip: '28469', state: 'NC' },
  { placeId: 'test-cal-1', text: '303 Test River Rd, Calabash, NC 28467', lat: 33.8907, lng: -78.5689, county: 'Brunswick', city: 'Calabash', zip: '28467', state: 'NC' },
  { placeId: 'test-sha-1', text: '404 Test Main St, Shallotte, NC 28470', lat: 33.974452, lng: -78.379911, county: 'Brunswick', city: 'Shallotte', zip: '28470', state: 'NC' },
  { placeId: 'test-wil-1', text: '505 Test Market St, Wilmington, NC 28401', lat: 34.2357, lng: -77.9456, county: 'New Hanover', city: 'Wilmington', zip: '28401', state: 'NC' },
  { placeId: 'test-myr-1', text: '606 Test Ocean Blvd, Myrtle Beach, SC 29577', lat: 33.6891, lng: -78.8867, county: 'Horry', city: 'Myrtle Beach', zip: '29577', state: 'SC' },
];

const useGoogle = (): boolean => Boolean(config.googleServerKey());

function signingSecret(): string {
  return config.manageTokenSecret();
}

function placeSignature(p: Place): string {
  return sign(JSON.stringify([p.placeId, p.text, p.lat, p.lng, p.county, p.city, p.zip, p.state]), signingSecret());
}

export function verifyPlace(p: Partial<Place> & { sig?: string }): p is CheckedPlace {
  if (!p.sig || !p.placeId || typeof p.lat !== 'number' || typeof p.lng !== 'number') return false;
  const value = JSON.stringify([p.placeId, p.text, p.lat, p.lng, p.county ?? '', p.city ?? '', p.zip ?? '', p.state ?? '']);
  return verify(value, p.sig, signingSecret());
}

export function inServiceArea(p: Pick<Place, 'county' | 'state'>): boolean {
  const county = p.county.replace(/\s+County$/i, '').trim().toLowerCase();
  return (
    p.state.toUpperCase() === facts.serviceArea.state.toUpperCase() &&
    facts.serviceArea.counties.some((c) => c.toLowerCase() === county)
  );
}

function check(p: Place): CheckedPlace {
  return { ...p, inArea: inServiceArea(p), sig: placeSignature(p) };
}

/** Sign a place we stored earlier (from a request someone made), so a booking can trust it again. */
export const signPlace = (p: Place): CheckedPlace => check(p);

export async function autocomplete(input: string, sessionToken: string): Promise<Suggestion[]> {
  const q = input.trim();
  if (q.length < 3) return [];
  if (!useGoogle()) {
    if (isProduction()) throw new Error('GOOGLE_MAPS_SERVER_KEY is not set');
    const needle = q.toLowerCase();
    return FAKE.filter((p) => p.text.toLowerCase().includes(needle))
      .slice(0, 5)
      .map((p) => {
        const [main, ...rest] = p.text.split(', ');
        return { placeId: p.placeId, main: main!, secondary: rest.join(', ') };
      });
  }
  const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': config.googleServerKey()! },
    body: JSON.stringify({
      input: q,
      sessionToken,
      includedRegionCodes: ['us'],
      includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
      locationBias: { circle: { center: BIAS, radius: 50000 } },
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Places autocomplete failed: ${res.status}`);
  const data = (await res.json()) as {
    suggestions?: {
      placePrediction?: {
        placeId: string;
        text?: { text: string };
        structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } };
      };
    }[];
  };
  return (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
    .map((p) => ({
      placeId: p.placeId,
      main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      secondary: p.structuredFormat?.secondaryText?.text ?? '',
    }));
}

export async function details(placeId: string, sessionToken: string): Promise<CheckedPlace | null> {
  if (!useGoogle()) {
    if (isProduction()) throw new Error('GOOGLE_MAPS_SERVER_KEY is not set');
    const p = FAKE.find((x) => x.placeId === placeId);
    return p ? check(p) : null;
  }
  const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
  url.searchParams.set('sessionToken', sessionToken);
  const res = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': config.googleServerKey()!,
      'X-Goog-FieldMask': 'id,formattedAddress,location,addressComponents',
    },
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Place details failed: ${res.status}`);
  const d = (await res.json()) as {
    id: string;
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
    addressComponents?: { longText: string; shortText: string; types: string[] }[];
  };
  const part = (type: string, short = false) => {
    const c = d.addressComponents?.find((x) => x.types.includes(type));
    return (short ? c?.shortText : c?.longText) ?? '';
  };
  if (!d.location || !d.formattedAddress) return null;
  return check({
    placeId: d.id,
    text: d.formattedAddress.replace(/, USA$/, ''),
    lat: d.location.latitude,
    lng: d.location.longitude,
    county: part('administrative_area_level_2').replace(/\s+County$/i, ''),
    city: part('locality') || part('postal_town') || part('sublocality'),
    zip: part('postal_code'),
    state: part('administrative_area_level_1', true),
  });
}

/**
 * A satellite image URL for the review step, or null when it isn't set up.
 * Uses a separate key that only works for the Static Maps API, signed with the
 * URL signing secret so the URL can't be reused for other places.
 */
export function satelliteUrl(lat: number, lng: number): string | null {
  const center = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  return signedStaticMap(`center=${center}&zoom=19&size=640x360&scale=2&maptype=satellite&markers=color:red%7C${center}`);
}

type Box = { sw: { lat: number; lng: number }; ne: { lat: number; lng: number } };

/**
 * The closest zoom at which a roof's box still fits in a picture this size with room around it
 * (it takes between about a third and three quarters of the frame).
 * Left to itself Google picks a zoom that shows the whole neighborhood, with the house a speck.
 * Zoom 20 is the closest satellite view we can count on; 16 is a few blocks.
 */
export function zoomToFit(box: Box, size = { width: 640, height: 400 }): number {
  const lat = (box.sw.lat + box.ne.lat) / 2;
  const cos = Math.cos((lat * Math.PI) / 180);
  const widthM = Math.abs(box.ne.lng - box.sw.lng) * 111_320 * cos;
  const heightM = Math.abs(box.ne.lat - box.sw.lat) * 110_540;
  const metersPerPixel = Math.max(widthM / (size.width * 0.75), heightM / (size.height * 0.75), 0.01);
  const zoom = Math.floor(Math.log2((156_543.03392 * cos) / metersPerPixel));
  return Math.min(20, Math.max(16, zoom));
}

/** The same view from an address alone. Google finds the spot when the picture loads, so we keep no map position for it. */
export function satelliteByAddress(address: string): string | null {
  return signedStaticMap(`center=${encodeURIComponent(address)}&zoom=19&size=640x400&scale=2&maptype=satellite`);
}

/** The estimate page's picture: the measured roof outlined in yellow on Google's satellite view, close up. */
export function roofImageUrl(box: Box): string | null {
  const c = (lat: number, lng: number) => `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const { sw, ne } = box;
  const ring = [c(sw.lat, sw.lng), c(sw.lat, ne.lng), c(ne.lat, ne.lng), c(ne.lat, sw.lng), c(sw.lat, sw.lng)].join('%7C');
  const center = c((sw.lat + ne.lat) / 2, (sw.lng + ne.lng) / 2);
  return signedStaticMap(
    `center=${center}&zoom=${zoomToFit(box)}&size=640x400&scale=2&maptype=satellite&path=color:0xffd500ff%7Cweight:3%7Cfillcolor:0xffd50033%7C${ring}`,
  );
}

function signedStaticMap(query: string): string | null {
  const key = config.googleStaticKey();
  if (!key) return null;
  const path = `/maps/api/staticmap?${query}&key=${encodeURIComponent(key)}`;
  const secret = config.googleStaticSecret();
  if (!secret) return `https://maps.googleapis.com${path}`;
  const sig = createHmac('sha1', Buffer.from(secret.replace(/-/g, '+').replace(/_/g, '/'), 'base64'))
    .update(path)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `https://maps.googleapis.com${path}&signature=${sig}`;
}
