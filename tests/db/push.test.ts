// Phone notifications: signing a phone up, a ping for every new lead and booking,
// phones that went away, and the home screen's numbers.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sent: { endpoint: string; payload: string }[] = [];
let goneEndpoint = '';
vi.mock('web-push', () => ({
  generateVAPIDKeys: () => ({ publicKey: `B${'k'.repeat(86)}`, privateKey: 'p'.repeat(43) }),
  sendNotification: vi.fn(async (sub: { endpoint: string }, payload: string) => {
    if (sub.endpoint === goneEndpoint) throw Object.assign(new Error('gone'), { statusCode: 410 });
    sent.push({ endpoint: sub.endpoint, payload });
    return { statusCode: 201 };
  }),
}));

const { asOwner, asService, closeDatabase, db, useDatabase } = await import('../../src/server/db');
const push = await import('../../src/server/push');
const { home } = await import('../../src/server/home');
const { createBooking, openSlots } = await import('../../src/server/booking');
const { bookingCreated } = await import('../../src/server/notify');

const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/wb_test';
const justin = { userId: randomUUID(), email: 'justin@example.com' };
const jt = { userId: randomUUID(), email: 'jt@example.com' };
const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };
const phone = (n: number) => `https://fcm.googleapis.com/fcm/send/device-${n}`;

beforeAll(async () => {
  process.env.APP_ENV = 'test';
  execFileSync('bash', ['scripts/db-local.sh'], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  useDatabase(url);
  for (const o of [justin, jt]) {
    await db()`insert into auth.users (id, email) values (${o.userId}, ${o.email})`;
    await asService((tx) => tx`insert into wb.owners (user_id, name, email) values (${o.userId}, ${o.email === 'jt@example.com' ? 'JT Stinson' : 'Justin Coffey'}, ${o.email})`);
  }
});
afterAll(() => closeDatabase());
beforeEach(async () => {
  sent.length = 0;
  push.loggedPushes.length = 0;
  goneEndpoint = '';
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  await asService((tx) => tx`delete from wb.push_subscriptions`);
});

const devices = () => asService((tx) => tx`select user_id, endpoint, device, failures from wb.push_subscriptions order by endpoint`);

describe('signing a phone up', () => {
  it('saves the phone for the owner, and moves it when another owner signs in on it', async () => {
    expect(await push.subscribe(justin, { endpoint: phone(1), keys }, 'iPhone')).toEqual({ ok: true });
    expect(await push.myDevices(justin)).toBe(1);
    expect(await push.subscribe(jt, { endpoint: phone(1), keys }, 'iPhone')).toEqual({ ok: true });
    expect(await push.myDevices(justin)).toBe(0);
    expect(await push.myDevices(jt)).toBe(1);
  });

  it('refuses anything that is not a browser push address', async () => {
    const r = await push.subscribe(justin, { endpoint: 'http://example.com/x', keys }, 'x');
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(await push.subscribe(justin, { endpoint: phone(2) }, 'x')).toMatchObject({ ok: false, status: 400 });
    expect(await devices()).toHaveLength(0);
  });

  it('only the owner who has the phone can take it off', async () => {
    await push.subscribe(justin, { endpoint: phone(3), keys }, 'Android phone');
    await push.unsubscribe(jt, phone(3));
    expect(await push.myDevices(justin)).toBe(1);
    await push.unsubscribe(justin, phone(3));
    expect(await push.myDevices(justin)).toBe(0);
  });
});

describe('pings', () => {
  it('without keys (tests, a laptop) they are recorded, not sent', async () => {
    await push.subscribe(justin, { endpoint: phone(4), keys }, 'iPhone');
    expect(await push.pushToOwners({ title: 'Hi', body: 'There', url: '/app/' })).toBe(1);
    expect(push.loggedPushes).toEqual([{ endpoint: phone(4), message: { title: 'Hi', body: 'There', url: '/app/' } }]);
  });

  it('with keys they go to every owner, and a phone that went away is dropped', async () => {
    process.env.VAPID_PUBLIC_KEY = 'BPublicKeyForTests';
    process.env.VAPID_PRIVATE_KEY = 'private-key-for-tests';
    await push.subscribe(justin, { endpoint: phone(5), keys }, 'iPhone');
    await push.subscribe(jt, { endpoint: phone(6), keys }, 'iPhone');
    await push.subscribe(jt, { endpoint: phone(7), keys }, 'Mac');
    goneEndpoint = phone(7);
    expect(await push.pushToOwners({ title: 'New estimate request', body: 'Robert Hayes, Supply.', url: '/app/#/request/1' })).toBe(2);
    expect(sent.map((s) => s.endpoint).sort()).toEqual([phone(5), phone(6)]);
    expect(JSON.parse(sent[0]!.payload)).toMatchObject({ title: 'New estimate request', url: '/app/#/request/1' });
    expect((await devices()).map((d) => d.endpoint)).toEqual([phone(5), phone(6)]);
  });

  it('a test ping goes to the owner who asked, and says so when there is no phone yet', async () => {
    expect(await push.testPush(justin)).toMatchObject({ ok: false, status: 409 });
    await push.subscribe(justin, { endpoint: phone(8), keys }, 'iPhone');
    await push.subscribe(jt, { endpoint: phone(9), keys }, 'iPhone');
    expect(await push.testPush(justin)).toEqual({ ok: true, sent: 1 });
    expect(push.loggedPushes.map((p) => p.endpoint)).toEqual([phone(8)]);
  });

  it('a new booking pings the owners with who, when and where', async () => {
    await push.subscribe(justin, { endpoint: phone(10), keys }, 'iPhone');
    const slot = (await openSlots()).filter((s) => Date.parse(s.startsAt) > Date.now() + 2 * 86_400_000)[0]!;
    const made = await createBooking({
      draftKey: randomUUID(),
      startedAt: Date.now() - 60_000,
      address: { text: '12 Ocean Blvd W, Holden Beach, NC 28462', typed: true },
      relationship: 'owner',
      roof: { material: 'shingle', age: '15-20', reason: 'storm', notes: '' },
      slotId: slot.id,
      visit: { someoneHome: 'no', gateCode: '', pets: '' },
      contact: { name: 'Dana Whitley', mobile: '9105550121', email: 'dana@example.com', smsConsent: false },
      source: { heardAbout: '', referralCode: '', utm: {}, viaAssistant: false },
    });
    if (!made.ok) throw new Error(made.message);
    await bookingCreated(made.booking, made.manageUrl);
    const ping = push.loggedPushes.find((p) => p.message.title === 'New inspection booked');
    expect(ping?.message.body).toMatch(/^Dana Whitley, \w{3}, \w{3} \d+, .+\. Holden Beach\.$/);
    expect(ping?.message.url).toBe(`/app/#/booking/${made.booking.id}`);
  });

  it('on the live site the server makes its own keys once, and owners can never read them', async () => {
    process.env.APP_ENV = 'preview';
    try {
      const key = await push.pushPublicKey();
      expect(key).toBe(`B${'k'.repeat(86)}`);
      expect(await push.pushPublicKey()).toBe(key);
      const rows = await asService((tx) => tx`select count(*)::int as n from wb.push_keys`);
      expect(rows[0]!.n).toBe(1);
      await expect(asOwner(justin.userId, (tx) => tx`select private_key from wb.push_keys`)).rejects.toMatchObject({ code: '42501' });
      await push.subscribe(justin, { endpoint: phone(12), keys }, 'iPhone');
      expect(await push.pushToOwners({ title: 'Signed', body: 'With the stored keys', url: '/app/' })).toBe(1);
      expect(sent.map((x) => x.endpoint)).toEqual([phone(12)]);
    } finally {
      process.env.APP_ENV = 'test';
    }
  });

  it('works before the database update too: no table, no ping, no error', async () => {
    await db()`alter table wb.push_subscriptions rename to push_subscriptions_away`;
    try {
      expect(await push.pushToOwners({ title: 'x', body: 'y', url: '/app/' })).toBe(0);
      expect(await push.myDevices(justin)).toBe(0);
      expect(await push.subscribe(justin, { endpoint: phone(11), keys }, 'iPhone')).toMatchObject({ ok: false, status: 503 });
    } finally {
      await db()`alter table wb.push_subscriptions_away rename to push_subscriptions`;
    }
  });
});

describe('the home screen', () => {
  it('has who to call, the week ahead and the money in play, in one trip', async () => {
    await asService(
      (tx) => tx`insert into wb.estimate_requests (ref, status, address, name, mobile, token_hash, idempotency_key, created_at)
                 values ('H0ME01', 'new', '77 Cedar Ln, Supply, NC 28462', 'Robert Hayes', '+19105550131', ${Buffer.alloc(32, 1)}, ${randomUUID()}, now() - interval '20 minutes')`,
    );
    const h = await home(justin);
    expect(h.name).toBe('Justin Coffey');
    expect(h.toCall.map((r) => r.name)).toContain('Robert Hayes');
    expect(h.toCall[0]).toMatchObject({ address: '77 Cedar Ln, Supply, NC 28462', mobile: '+19105550131' });
    expect(h.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(h.estimates.out).toEqual({ count: 0, cents: 0 });
    expect(Array.isArray(h.visits)).toBe(true);
  });
});
