// The secret link to manage a booking.
// The token is derived from the draft key with a server secret, so a retry of
// the same booking gets the same link. Only a hash of the token is stored.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './env';

export function manageToken(draftKey: string): string {
  return createHmac('sha256', config.manageTokenSecret()).update(`manage:${draftKey}`).digest('base64url');
}

export function tokenHash(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** Tokens are 43 URL-safe characters. Reject anything else before touching the database. */
export function looksLikeToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function manageUrl(siteUrl: string, token: string): string {
  // The token goes after #, so it is never sent to any server or written to a log.
  return `${siteUrl}/b/#${token}`;
}

/** The link in an estimate request's email: it opens the booking form already filled in. */
export function requestToken(key: string): string {
  return createHmac('sha256', config.manageTokenSecret()).update(`request:${key}`).digest('base64url');
}

export function requestUrl(siteUrl: string, token: string): string {
  // After #, like the manage link: never sent to a server or written to a log.
  return `${siteUrl}/estimate/book/#r=${token}`;
}

export function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function verify(value: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(sign(value, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function hashKey(value: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 32);
}
