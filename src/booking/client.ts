// Talking to the server, and keeping a half-done booking on the phone.
import type { Draft } from './rules';

export interface Slot {
  id: string;
  startsAt: string;
  endsAt: string;
}

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
  inArea: boolean;
  sig: string;
}

export interface ApiError {
  error: string;
  message: string;
  fields?: Record<string, string>;
  alternatives?: Slot[];
}

export class RequestFailed extends Error {
  constructor(public status: number, public body: ApiError) {
    super(body.message);
  }
}

const OFFLINE: ApiError = { error: 'offline', message: "We couldn't reach the server. Check your connection and try again." };

export async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new RequestFailed(0, OFFLINE);
  }
  const data = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok) throw new RequestFailed(res.status, { ...OFFLINE, ...data, message: data.message ?? OFFLINE.message });
  return data;
}

export async function getSlots(): Promise<Slot[]> {
  try {
    const res = await fetch('/api/slots', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    return ((await res.json()) as { slots: Slot[] }).slots;
  } catch {
    throw new RequestFailed(0, { error: 'slots', message: "We couldn't load the open times. Check your connection and try again." });
  }
}

export const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
        (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (Number(c) / 4)))).toString(16),
      );

// The draft lives in localStorage for up to 24 hours, then it's forgotten.
const KEY = 'booking-draft-v1';
const MAX_AGE = 24 * 60 * 60 * 1000;

export interface Saved {
  savedAt: number;
  step: number;
  draft: Draft;
  satellite: string | null;
}

export function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    if (!saved?.draft?.draftKey || Date.now() - saved.savedAt > MAX_AGE) {
      localStorage.removeItem(KEY);
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

export function save(step: number, draft: Draft, satellite: string | null): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), step, draft, satellite } satisfies Saved));
  } catch {
    // Storage full or private mode: the booking still works, it just won't survive a refresh.
  }
}

export function clearSaved(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/** How someone found us, remembered on this device by the small script on every page. */
export function readSource(): { utm: Record<string, string>; referralCode: string } {
  const out = { utm: {} as Record<string, string>, referralCode: '' };
  if (typeof window === 'undefined') return out; // rendering on the server
  try {
    const raw = localStorage.getItem('found-us-v1');
    if (raw) {
      const s = JSON.parse(raw) as Record<string, string | number>;
      for (const k of ['source', 'medium', 'campaign', 'referrer', 'landing']) {
        const v = s[k];
        if (typeof v === 'string' && v) out.utm[k] = v.slice(0, 200);
      }
      if (typeof s.ref === 'string') out.referralCode = s.ref;
    }
  } catch {
    /* ignore */
  }
  const q = new URLSearchParams(location.search).get('ref');
  if (q) out.referralCode = q.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
  return out;
}

/** Make a photo small enough to upload quickly on a phone. Re-drawing it also drops its location data. */
export async function shrinkPhoto(file: File, max = 1600, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read that photo'))), 'image/jpeg', quality),
  );
}

export async function thumbnail(blob: Blob): Promise<string> {
  const small = await shrinkPhoto(new File([blob], 'thumb.jpg', { type: 'image/jpeg' }), 200, 0.6);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(small);
  });
}

export async function uploadPhoto(draftKey: string, blob: Blob): Promise<string> {
  const { photoId, upload } = await post<{ photoId: string; upload: { url: string; method: string; headers: Record<string, string> } }>(
    '/api/photos',
    { draftKey, contentType: 'image/jpeg', bytes: blob.size },
  );
  let res: Response;
  try {
    res = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: blob });
  } catch {
    throw new RequestFailed(0, OFFLINE);
  }
  if (!res.ok) throw new RequestFailed(res.status, { error: 'upload', message: "That photo didn't upload. Try again, or skip photos." });
  return photoId;
}
