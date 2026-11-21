// Google's measurement of a roof (Solar API, Building Insights): the real,
// pitched roof area from aerial imagery, the area seen from above, and the
// pitch. One request per estimate; 10,000 a month cost nothing, then a cent each.
import { appEnv, config } from './env';

export interface SolarRoof {
  /** Roof area including its slope, square meters. */
  areaM2: number;
  /** The same roof seen from above, square meters. */
  groundAreaM2: number;
  /** Area-weighted average pitch, degrees. */
  pitchDegrees: number;
  segments: number;
  /** When the imagery was taken, YYYY-MM-DD. */
  imageryDate: string;
  quality: string;
  center: { lat: number; lng: number };
  box: { sw: { lat: number; lng: number }; ne: { lat: number; lng: number } };
}

const M_PER_DEG_LAT = 110_540;
const metersBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.hypot((a.lat - b.lat) * M_PER_DEG_LAT, (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180));

// Tests: one house with a measured roof, at the test address 101 Test Beach Dr W.
const TEST_HOUSE = { lat: 33.895447, lng: -78.434496 };

function fake(lat: number, lng: number): SolarRoof | null {
  if (metersBetween({ lat, lng }, TEST_HOUSE) > 60) return null;
  const d = 10 / M_PER_DEG_LAT;
  return {
    areaM2: 209,
    groundAreaM2: 187,
    pitchDegrees: 26.57,
    segments: 4,
    imageryDate: '2025-03-10',
    quality: 'HIGH',
    center: TEST_HOUSE,
    box: { sw: { lat: TEST_HOUSE.lat - d, lng: TEST_HOUSE.lng - d }, ne: { lat: TEST_HOUSE.lat + d, lng: TEST_HOUSE.lng + d } },
  };
}

interface Stats {
  areaMeters2?: number;
  groundAreaMeters2?: number;
}
interface Insights {
  center?: { latitude: number; longitude: number };
  boundingBox?: { sw: { latitude: number; longitude: number }; ne: { latitude: number; longitude: number } };
  imageryDate?: { year: number; month: number; day: number };
  imageryQuality?: string;
  solarPotential?: {
    wholeRoofStats?: Stats;
    buildingStats?: Stats;
    roofSegmentStats?: { pitchDegrees?: number; stats?: Stats }[];
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The roof at a point, or null when Google has no building there (or none within 60 meters). */
export async function roofFromSolar(lat: number, lng: number): Promise<SolarRoof | null> {
  if (appEnv() === 'test') return fake(lat, lng);
  const key = config.googleSolarKey();
  if (!key) return null;
  const url = new URL('https://solar.googleapis.com/v1/buildingInsights:findClosest');
  url.searchParams.set('location.latitude', lat.toFixed(6));
  url.searchParams.set('location.longitude', lng.toFixed(6));
  url.searchParams.set('requiredQuality', 'LOW');
  url.searchParams.set('key', key);
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Solar API ${res.status}`);
  const b = (await res.json()) as Insights;
  const p = b.solarPotential;
  const whole = p?.buildingStats?.areaMeters2 ? p.buildingStats : p?.wholeRoofStats;
  if (!b.center || !b.boundingBox || !whole?.areaMeters2) return null;
  const center = { lat: b.center.latitude, lng: b.center.longitude };
  // findClosest can return a building down the street; past 60 meters it isn't this house.
  if (metersBetween(center, { lat, lng }) > 60) return null;
  const segments = p?.roofSegmentStats ?? [];
  const weight = segments.reduce((s, x) => s + (x.stats?.areaMeters2 ?? 0), 0);
  const pitch = weight > 0 ? segments.reduce((s, x) => s + (x.pitchDegrees ?? 0) * (x.stats?.areaMeters2 ?? 0), 0) / weight : 0;
  const d = b.imageryDate;
  return {
    areaM2: whole.areaMeters2,
    groundAreaM2: whole.groundAreaMeters2 ?? whole.areaMeters2,
    pitchDegrees: pitch,
    segments: segments.length,
    imageryDate: d ? `${d.year}-${pad(d.month)}-${pad(d.day)}` : '',
    quality: b.imageryQuality ?? '',
    center,
    box: {
      sw: { lat: b.boundingBox.sw.latitude, lng: b.boundingBox.sw.longitude },
      ne: { lat: b.boundingBox.ne.latitude, lng: b.boundingBox.ne.longitude },
    },
  };
}
