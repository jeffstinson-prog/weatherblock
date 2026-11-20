// Configuration from environment variables. Keys never live in the repo.
// Anything not set falls back to a safe test mode, except in production,
// where a missing key is an error you'll see right away.

export function read(name: string): string | undefined {
  const value = process.env[name];
  return value !== undefined && value.trim() !== '' ? value.trim() : undefined;
}

export type AppEnv = 'production' | 'preview' | 'development' | 'test';

export function appEnv(): AppEnv {
  const v = read('APP_ENV');
  if (v === 'production' || v === 'preview' || v === 'test') return v;
  return 'development';
}

export const isProduction = (): boolean => appEnv() === 'production';

export class ConfigError extends Error {}

/** A value that must be set in production. Outside production, use the fallback. */
export function setting(name: string, fallback: string): string {
  const v = read(name);
  if (v) return v;
  if (isProduction()) throw new ConfigError(`${name} is not set`);
  return fallback;
}

export function required(name: string): string {
  const v = read(name);
  if (!v) throw new ConfigError(`${name} is not set`);
  return v;
}

export const config = {
  siteUrl: () => (read('SITE_URL') ?? read('URL') ?? 'http://localhost:4321').replace(/\/$/, ''),
  databaseUrl: () => required('DATABASE_URL'),
  manageTokenSecret: () => setting('MANAGE_TOKEN_SECRET', 'development-only-manage-secret'),
  rateLimitSalt: () => setting('RATE_LIMIT_SALT', 'development-only-rate-salt'),
  supabaseUrl: () => read('PUBLIC_SUPABASE_URL')?.replace(/\/$/, ''),
  supabaseServiceKey: () => read('SUPABASE_SERVICE_ROLE_KEY'),
  photoBucket: () => read('PHOTO_BUCKET') ?? 'booking-photos',
  estimateBucket: () => read('ESTIMATE_BUCKET') ?? 'estimate-files',
  googleServerKey: () => read('GOOGLE_MAPS_SERVER_KEY'),
  googleStaticKey: () => read('GOOGLE_MAPS_STATIC_KEY'),
  googleStaticSecret: () => read('GOOGLE_MAPS_SIGNING_SECRET'),
};
