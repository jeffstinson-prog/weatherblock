// Phone notifications for the owners, through the installed owner app (Web Push).
// A ping on the lock screen for every new lead and booking: faster than email,
// and it doesn't wait on text-message registration. Best effort: a push that
// fails never stops a booking, or the alert by email or text.
import { generateVAPIDKeys, sendNotification } from 'web-push';
import { z } from 'zod';
import { facts } from '../facts';
import type { Owner } from './auth';
import { asService } from './db';
import { appEnv, read } from './env';

export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping it opens, inside the owner app. */
  url: string;
  /** Pings with the same tag replace each other on the lock screen. */
  tag?: string;
}

interface Device {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushResult = { ok: true } | { ok: false; status: number; message: string };

interface Keys {
  subject: string;
  publicKey: string;
  privateKey: string;
}

let stored: Keys | null = null;

/**
 * The key pair that signs every ping. From Netlify when both VAPID_PUBLIC_KEY and
 * VAPID_PRIVATE_KEY are set; otherwise the one the server made and keeps in the
 * database (made on first use). Tests and a laptop get none: pings are recorded.
 */
async function vapid(): Promise<Keys | null> {
  const subject = read('VAPID_SUBJECT') ?? `mailto:${facts.contact.email}`;
  const publicKey = read('VAPID_PUBLIC_KEY');
  const privateKey = read('VAPID_PRIVATE_KEY');
  if (publicKey && privateKey) return { subject, publicKey, privateKey };
  if (appEnv() === 'test' || appEnv() === 'development') return null;
  if (stored) return stored;
  const keys = await asService(async (tx) => {
    const [found] = await tx`select public_key, private_key from wb.push_keys where id = 1`;
    if (found) return found;
    const made = generateVAPIDKeys();
    await tx`insert into wb.push_keys (id, public_key, private_key) values (1, ${made.publicKey}, ${made.privateKey}) on conflict (id) do nothing`;
    const [kept] = await tx`select public_key, private_key from wb.push_keys where id = 1`;
    return kept;
  });
  if (!keys) return null;
  stored = { subject, publicKey: keys.public_key as string, privateKey: keys.private_key as string };
  return stored;
}

/** The public half, for the app to sign a phone up with. Empty when pings aren't set up. */
export async function pushPublicKey(): Promise<string> {
  try {
    return (await vapid())?.publicKey ?? '';
  } catch (err) {
    if (!missingTable(err)) console.error('push keys failed', err);
    return '';
  }
}

/** In tests and on a laptop without keys: what would have gone out. */
export const loggedPushes: { endpoint: string; message: PushMessage }[] = [];

// Only the browsers' own push services, so the server never posts anywhere else.
const PUSH_HOSTS = /(^|\.)(googleapis\.com|push\.apple\.com|mozilla\.com|mozaws\.net|notify\.windows\.com)$/;

const Subscription = z.object({
  endpoint: z
    .string()
    .max(1000)
    .refine((u) => {
      try {
        const url = new URL(u);
        return url.protocol === 'https:' && (PUSH_HOSTS.test(url.hostname) || appEnv() === 'test');
      } catch {
        return false;
      }
    }),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});

const missingTable = (err: unknown) => (err as { code?: string }).code === '42P01';
const NOT_READY = 'Notifications need one database update first. Tell JT to run it.';

/** This phone wants pings. A phone another owner used before moves to this owner. */
export async function subscribe(owner: Owner, input: unknown, device: unknown): Promise<PushResult> {
  const s = Subscription.safeParse(input);
  if (!s.success) return { ok: false, status: 400, message: "That phone's notification details didn't come through. Try again." };
  const name = typeof device === 'string' ? device.slice(0, 120) : '';
  try {
    await asService(
      (tx) => tx`
        insert into wb.push_subscriptions (user_id, endpoint, p256dh, auth, device)
        values (${owner.userId}, ${s.data.endpoint}, ${s.data.keys.p256dh}, ${s.data.keys.auth}, ${name})
        on conflict (endpoint) do update
          set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device, failures = 0`,
    );
    return { ok: true };
  } catch (err) {
    if (missingTable(err)) return { ok: false, status: 503, message: NOT_READY };
    throw err;
  }
}

export async function unsubscribe(owner: Owner, endpoint: unknown): Promise<PushResult> {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return { ok: false, status: 400, message: 'Which phone?' };
  try {
    await asService((tx) => tx`delete from wb.push_subscriptions where endpoint = ${endpoint} and user_id = ${owner.userId}`);
  } catch (err) {
    if (!missingTable(err)) throw err;
  }
  return { ok: true };
}

/** How many phones this owner gets pings on. */
export async function myDevices(owner: Owner): Promise<number> {
  try {
    const [r] = await asService((tx) => tx`select count(*)::int as n from wb.push_subscriptions where user_id = ${owner.userId}`);
    return Number(r?.n ?? 0);
  } catch (err) {
    if (missingTable(err)) return 0;
    throw err;
  }
}

async function deliver(d: Device, m: PushMessage, keys: Keys | null): Promise<'sent' | 'logged' | 'gone' | 'failed'> {
  if (!keys) {
    loggedPushes.push({ endpoint: d.endpoint, message: m });
    return 'logged';
  }
  try {
    await sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, JSON.stringify(m), {
      vapidDetails: keys,
      TTL: 6 * 3600,
      urgency: 'high',
      timeout: 5000,
    });
    return 'sent';
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return 'gone'; // the phone turned them off, or the app was removed
    console.error('push failed', status ?? '', (err as Error).message);
    return 'failed';
  }
}

/** Ping every active owner's phones, or one owner's. Returns how many went out. */
export async function pushToOwners(m: PushMessage, onlyUserId?: string): Promise<number> {
  try {
    const devices = await asService(
      (tx) => tx<Device[]>`
        select s.id, s.endpoint, s.p256dh, s.auth
        from wb.push_subscriptions s join wb.owners o on o.user_id = s.user_id
        where o.active ${onlyUserId ? tx`and s.user_id = ${onlyUserId}` : tx``}`,
    );
    if (devices.length === 0) return 0;
    const message = { ...m, body: m.body.slice(0, 240), title: m.title.slice(0, 80) };
    const keys = await vapid();
    const results = await Promise.all(devices.map((d) => deliver(d, message, keys)));
    const gone = devices.filter((_, i) => results[i] === 'gone').map((d) => d.id);
    const ok = devices.filter((_, i) => results[i] === 'sent' || results[i] === 'logged').map((d) => d.id);
    const failed = devices.filter((_, i) => results[i] === 'failed').map((d) => d.id);
    await asService(async (tx) => {
      if (gone.length) await tx`delete from wb.push_subscriptions where id = any(${gone}::uuid[])`;
      if (ok.length) await tx`update wb.push_subscriptions set last_sent_at = now(), failures = 0 where id = any(${ok}::uuid[])`;
      if (failed.length) await tx`update wb.push_subscriptions set failures = failures + 1 where id = any(${failed}::uuid[])`;
      // A phone that has failed for days is gone for good.
      await tx`delete from wb.push_subscriptions where failures >= 50`;
    });
    return ok.length;
  } catch (err) {
    if (!missingTable(err)) console.error('push to owners failed', err);
    return 0;
  }
}

/** "Send a test" in the app: a ping to this owner's own phones. */
export async function testPush(owner: Owner): Promise<PushResult & { sent?: number }> {
  const sent = await pushToOwners({ title: 'Notifications are on', body: "This phone will get a ping for every new lead and booking.", url: '/app/', tag: 'test' }, owner.userId);
  if (sent === 0) return { ok: false, status: 409, message: "This phone isn't signed up for notifications yet. Turn them on first." };
  return { ok: true, sent };
}
