// Owner app: sign-in (Supabase Auth, emailed 6-digit code) and calls to /api/owner.
import { GoTrueClient } from '@supabase/auth-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;

export const auth: GoTrueClient | null =
  url && key
    ? new GoTrueClient({
        url: `${url.replace(/\/$/, '')}/auth/v1`,
        headers: { apikey: key },
        storageKey: 'owner-auth',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      })
    : null;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let onSignedOut: () => void = () => {};
export const whenSignedOut = (fn: () => void) => {
  onSignedOut = fn;
};

async function token(): Promise<string> {
  const { data } = (await auth?.getSession()) ?? { data: { session: null } };
  const t = data.session?.access_token;
  if (!t) {
    onSignedOut();
    throw new ApiError(401, 'Sign in again.');
  }
  return t;
}

export async function api<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/owner/${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, "Can't reach the server. Check your signal and try again.");
  }
  if (res.status === 401) {
    onSignedOut();
    throw new ApiError(401, 'Sign in again.');
  }
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new ApiError(res.status, data.message ?? 'Something went wrong.');
  return data;
}

/** Download a file (the CSV export) with the sign-in token, without putting anything in the URL bar. */
export async function download(path: string, filename: string): Promise<void> {
  const res = await fetch(`/api/owner/${path}`, { headers: { Authorization: `Bearer ${await token()}` }, cache: 'no-store' });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(res.status, data.message ?? 'Export failed.');
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
