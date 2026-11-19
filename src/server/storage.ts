// Private photo storage. Supabase Storage in production; a local folder in
// tests and development. Uploads go straight from the phone to storage with a
// short-lived signed URL, so photos never pass through our functions.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { config, isProduction } from './env';
import { sign, verify } from './tokens';

export interface Upload {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

const LOCAL_ROOT = join(process.cwd(), '.local-storage');

const useSupabase = (): boolean => Boolean(config.supabaseUrl() && config.supabaseServiceKey());

function authHeaders(): Record<string, string> {
  const key = config.supabaseServiceKey()!;
  // Legacy service_role keys are JWTs and go in Authorization too; new secret keys only in apikey.
  return key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
}

export async function createUpload(path: string, contentType: string): Promise<Upload> {
  if (!useSupabase()) {
    if (isProduction()) throw new Error('Photo storage is not configured');
    const sig = sign(`put:${path}`, config.manageTokenSecret());
    return {
      url: `/api/photos/local?path=${encodeURIComponent(path)}&sig=${sig}`,
      method: 'PUT',
      headers: { 'content-type': contentType },
    };
  }
  const base = config.supabaseUrl()!;
  const res = await fetch(`${base}/storage/v1/object/upload/sign/${config.photoBucket()}/${path}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Could not create an upload URL: ${res.status}`);
  const data = (await res.json()) as { url: string };
  return {
    url: `${base}/storage/v1${data.url}`,
    method: 'PUT',
    headers: { 'content-type': contentType, 'x-upsert': 'false', 'cache-control': 'max-age=3600' },
  };
}

/** A link an owner can open for a few minutes. */
export async function viewUrl(path: string, seconds = 600): Promise<string> {
  if (!useSupabase()) {
    const sig = sign(`get:${path}`, config.manageTokenSecret());
    return `/api/photos/local?path=${encodeURIComponent(path)}&sig=${sig}`;
  }
  const base = config.supabaseUrl()!;
  const res = await fetch(`${base}/storage/v1/object/sign/${config.photoBucket()}/${path}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: seconds }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Could not sign a photo URL: ${res.status}`);
  const data = (await res.json()) as { signedURL: string };
  return `${base}/storage/v1${data.signedURL}`;
}

// Local mode (development and tests only).

function localPath(path: string): string {
  const full = normalize(join(LOCAL_ROOT, path));
  if (!full.startsWith(LOCAL_ROOT)) throw new Error('bad path');
  return full;
}

export function localAllowed(): boolean {
  return !useSupabase() && !isProduction();
}

export function checkLocalSignature(kind: 'put' | 'get', path: string, sig: string): boolean {
  return verify(`${kind}:${path}`, sig, config.manageTokenSecret());
}

export async function localWrite(path: string, body: ArrayBuffer): Promise<void> {
  const file = localPath(path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(body));
}

export async function localRead(path: string): Promise<Buffer> {
  return readFile(localPath(path));
}
