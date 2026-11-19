// Postgres access. Every request runs in a short transaction under the right
// role, so row level security applies exactly as it would through Supabase:
//   asPublic   role anon: may only call the wb_api functions
//   asOwner    role authenticated with the owner's user id: row level security
//   asService  role service_role: background jobs (reminders, calendar sync)
import postgres from 'postgres';
import { config } from './env';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

let client: Sql | undefined;

export function db(): Sql {
  if (!client) {
    client = postgres(config.databaseUrl(), {
      // Supabase's pooler in transaction mode doesn't keep prepared statements.
      prepare: false,
      max: Number(process.env.DB_POOL_MAX ?? 3),
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
    });
  }
  return client;
}

/** For tests: use a specific connection string. */
export function useDatabase(url: string): void {
  client = postgres(url, { prepare: false, max: 10, onnotice: () => {} });
}

export async function closeDatabase(): Promise<void> {
  await client?.end({ timeout: 5 });
  client = undefined;
}

async function asRole<T>(role: 'anon' | 'authenticated' | 'service_role', claims: object | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await db().begin(async (tx) => {
    await tx`select set_config('role', ${role}, true)`;
    if (claims) await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
    return fn(tx);
  })) as T;
}

export const asPublic = <T>(fn: (tx: Tx) => Promise<T>) => asRole('anon', { role: 'anon' }, fn);
export const asService = <T>(fn: (tx: Tx) => Promise<T>) => asRole('service_role', { role: 'service_role' }, fn);
export const asOwner = <T>(userId: string, fn: (tx: Tx) => Promise<T>) =>
  asRole('authenticated', { sub: userId, role: 'authenticated' }, fn);

/** Database errors we raise on purpose (see the migrations), by SQLSTATE. */
export const DB_ERRORS: Record<string, string> = {
  WB400: 'bad_request',
  WB404: 'not_found',
  WB409: 'slot_full',
  WB410: 'slot_not_offered',
  WB423: 'cannot_change',
  WB429: 'too_many',
};

export function dbErrorCode(err: unknown): string | null {
  const code = (err as { code?: string })?.code;
  return code && DB_ERRORS[code] ? DB_ERRORS[code]! : null;
}
