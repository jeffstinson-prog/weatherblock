// Owners sign in with Supabase Auth (a 6-digit code by email) and send the
// resulting token with each request. We check the token's signature, then the
// database checks they're an owner (row level security does the rest).
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { asOwner } from './db';
import { config, read } from './env';

export interface Owner {
  userId: string;
  email: string;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

async function verify(token: string): Promise<JWTPayload> {
  // Tests (and projects on Supabase's older shared-secret signing) use a secret;
  // current Supabase projects sign with keys published at a JWKS URL.
  const secret = read('SUPABASE_JWT_SECRET');
  if (secret) {
    return (await jwtVerify(token, new TextEncoder().encode(secret), { audience: 'authenticated' })).payload;
  }
  const base = config.supabaseUrl();
  if (!base) throw new Error('Supabase is not configured');
  jwks ??= createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
  return (await jwtVerify(token, jwks, { issuer: `${base}/auth/v1`, audience: 'authenticated' })).payload;
}

export class NotAnOwner extends Error {}

/** The signed-in owner, or null when the request has no valid token. Throws NotAnOwner for signed-in strangers. */
export async function ownerFrom(request: Request): Promise<Owner | null> {
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return null;
  let payload: JWTPayload;
  try {
    payload = await verify(header.slice(7));
  } catch {
    return null;
  }
  if (payload.role !== 'authenticated' || typeof payload.sub !== 'string') return null;
  const userId = payload.sub;
  const ok = await asOwner(userId, async (tx) => {
    const [r] = await tx`select wb.is_owner() as ok`;
    return Boolean(r?.ok);
  });
  if (!ok) throw new NotAnOwner();
  return { userId, email: typeof payload.email === 'string' ? payload.email : '' };
}
