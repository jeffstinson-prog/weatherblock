import { asPublic } from './db';
import { appEnv, config } from './env';
import { hashKey } from './tokens';

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      ...headers,
    },
  });
}

export class BadRequest extends Error {}

/** Read a JSON body, refusing anything large. */
export async function readJson(request: Request, maxBytes = 32_000): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) throw new BadRequest('Send JSON.');
  const text = await request.text();
  if (text.length > maxBytes) throw new BadRequest('That request is too large.');
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequest('That request could not be read.');
  }
}

/**
 * Only accept writes that come from our own pages. Browsers send Origin on
 * cross-site POSTs; JSON bodies also force a preflight we never answer.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // same-origin fetches from older browsers may omit it
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Count requests per visitor (hashed IP) per bucket. False means slow down. */
export async function rateOk(bucket: string, ip: string, max: number, windowSeconds: number): Promise<boolean> {
  if (appEnv() === 'test') return true; // automated tests book many times from one address
  const key = hashKey(ip || 'unknown', config.rateLimitSalt());
  return asPublic(async (tx) => {
    const [row] = await tx`select wb_api.rate_ok(${bucket}, ${key}, ${max}, ${windowSeconds}) as ok`;
    return Boolean(row?.ok);
  });
}

export const tooMany = () =>
  json(429, { error: 'too_many', message: 'Too many tries in a short time. Wait a few minutes and try again, or call us.' });

export const serverError = () =>
  json(500, { error: 'server', message: 'Something went wrong on our side. Try again, or call us.' });
