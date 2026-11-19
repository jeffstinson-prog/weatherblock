// Texts and email against a real database, with the "log" providers
// (no keys set, so nothing is actually sent: every message is recorded).
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TZ } from '../../src/booking/format';
import { createBooking, openSlots } from '../../src/server/booking';
import { asService, closeDatabase, db, useDatabase } from '../../src/server/db';
import { runJobs } from '../../src/server/jobs';
import { handleInbound } from '../../src/server/messaging/inbound';
import { send } from '../../src/server/messaging/send';
import { bookingChanged, bookingCreated } from '../../src/server/notify';
import { runReminders } from '../../src/server/reminders';

const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/wb_test';

beforeAll(() => {
  execFileSync('bash', ['scripts/db-local.sh'], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  useDatabase(url);
});
afterAll(() => closeDatabase());
beforeEach(async () => {
  await asService(async (tx) => {
    await tx`delete from wb.messages`;
    await tx`delete from wb.sms_optouts`;
    await tx`delete from wb.booking_events`;
    await tx`delete from wb.booking_photos`;
    await tx`delete from wb.bookings`;
    await tx`delete from wb.owners`;
  });
});

let n = 5000;
const mobile = () => `910555${String(++n).padStart(4, '0')}`;
const localHour = (iso: string) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date(iso)));

async function book(opts: { hour?: number; consent?: boolean; skip?: number } = {}) {
  const slots = (await openSlots()).filter((s) => Date.parse(s.startsAt) > Date.now() + 2 * 86_400_000);
  const slot = slots.filter((s) => opts.hour === undefined || localHour(s.startsAt) === opts.hour)[opts.skip ?? 0]!;
  const r = await createBooking({
    draftKey: randomUUID(),
    startedAt: Date.now() - 60_000,
    address: { text: '101 Test Beach Dr W, Ocean Isle Beach, NC 28469', typed: true },
    relationship: 'owner',
    roof: { material: 'shingle', age: '10-15', reason: 'leak', notes: '' },
    slotId: slot.id,
    visit: { someoneHome: 'no', gateCode: '', pets: '' },
    contact: { name: 'Pat Tester', mobile: mobile(), email: 'pat@example.com', smsConsent: opts.consent ?? true },
  });
  if (!r.ok) throw new Error(r.message);
  return { ...r, slot };
}

const messages = () =>
  asService((tx) => tx`select channel, audience, kind, to_addr, status, body, subject from wb.messages order by created_at, kind, channel`);

describe('a new booking', () => {
  it('emails and texts the customer and alerts the business; nothing is claimed as sent without keys', async () => {
    const r = await book();
    const notified = await bookingCreated(r.booking, r.manageUrl);
    expect(notified).toEqual({ email: false, sms: false }); // logged only, so the page won't say "we texted you"
    const m = await messages();
    expect(m.map((x) => `${x.audience}:${x.channel}:${x.kind}:${x.status}`).sort()).toEqual([
      'customer:email:confirmation:logged',
      'customer:sms:confirmation:logged',
      'owner:email:owner_new:logged',
    ]);
    expect(m.find((x) => x.audience === 'owner')!.to_addr).toBe('weatherblockroofing@gmail.com');
  });

  it('skips the text when they did not agree to texts', async () => {
    const r = await book({ consent: false });
    await bookingCreated(r.booking, r.manageUrl);
    const m = await messages();
    expect(m.filter((x) => x.audience === 'customer').map((x) => x.channel)).toEqual(['email']);
  });

  it('alerts each owner by text and email once owners are set up', async () => {
    const id = randomUUID();
    await db()`insert into auth.users (id) values (${id})`;
    await asService(
      (tx) => tx`insert into wb.owners (user_id, name, email, mobile) values (${id}, 'Justin', 'justin@example.com', '+19105550101')`,
    );
    const r = await book();
    await bookingCreated(r.booking, r.manageUrl);
    const owner = (await messages()).filter((x) => x.audience === 'owner');
    expect(owner.map((x) => `${x.channel}:${x.to_addr}`).sort()).toEqual(['email:justin@example.com', 'sms:+19105550101']);
    expect(owner.find((x) => x.channel === 'sms')!.body).toMatch(/^New inspection: /);
  });

  it('tells the customer and the owners when the customer reschedules or cancels', async () => {
    const r = await book();
    await bookingChanged(r.booking, 'cancelled');
    const kinds = (await messages()).map((x) => `${x.audience}:${x.kind}`).sort();
    expect(kinds).toEqual(['customer:cancelled', 'customer:cancelled', 'owner:owner_cancelled']);
  });
});

describe('reminders', () => {
  it('texts once the evening before, and never twice', async () => {
    const r = await book({ hour: 8 });
    const eve = new Date(Date.parse(r.slot.startsAt) - 13.5 * 3_600_000); // 6:30 pm the day before
    expect(await runReminders(eve)).toBe(1);
    expect(await runReminders(new Date(eve.getTime() + 15 * 60_000))).toBe(0);
    const m = (await messages()).filter((x) => x.kind === 'remind_eve');
    expect(m).toHaveLength(1);
    expect(m[0]!.channel).toBe('sms');
    expect(m[0]!.body).toContain('tomorrow between 8 and 10 am');
  });

  it('texts the morning of', async () => {
    const r = await book({ hour: 10 });
    const morning = new Date(Date.parse(r.slot.startsAt) - 2 * 3_600_000); // 8 am
    expect(await runReminders(morning)).toBe(1);
    expect((await messages()).some((x) => x.kind === 'remind_morn' && x.body.includes('see you today'))).toBe(true);
  });

  it('emails the evening before when they did not agree to texts', async () => {
    const r = await book({ hour: 8, consent: false });
    await runReminders(new Date(Date.parse(r.slot.startsAt) - 13.5 * 3_600_000));
    const m = (await messages()).filter((x) => x.kind === 'remind_eve');
    expect(m.map((x) => x.channel)).toEqual(['email']);
  });

  it('a cancelled booking gets no reminder', async () => {
    const r = await book({ hour: 8 });
    await asService((tx) => tx`update wb.bookings set status = 'cancelled' where id = ${r.booking.id}`);
    expect(await runReminders(new Date(Date.parse(r.slot.startsAt) - 13.5 * 3_600_000))).toBe(0);
  });
});

describe('replies to our texts', () => {
  it('STOP stops texts until START, and the owners hear about every reply', async () => {
    const r = await book({ hour: 12 });
    const from = r.mobile;
    const stop = await handleInbound({ from, to: '+19105550000', body: 'STOP', sid: 'SM1' });
    expect(stop.optedOut).toBe(true);
    expect(stop.forwarded).toBe(1); // to the business email
    expect(await send({ channel: 'sms', audience: 'customer', kind: 'test', to: from, text: 'hi' })).toBe('opted_out');
    const reminder = await runReminders(new Date(Date.parse(r.slot.startsAt) - 4 * 3_600_000)); // morning of a noon visit
    expect(reminder).toBe(0); // no text, and no morning email either
    const start = await handleInbound({ from, to: '+19105550000', body: 'start', sid: 'SM2' });
    expect(start.optedIn).toBe(true);
    expect(await send({ channel: 'sms', audience: 'customer', kind: 'test', to: from, text: 'hi' })).toBe('logged');
    const inbound = await asService((tx) => tx`select count(*)::int as n from wb.messages where direction = 'in'`);
    expect(inbound[0]!.n).toBe(2);
    const fwd = (await messages()).filter((x) => x.kind === 'forward');
    expect(fwd[0]!.subject).toContain('Text from Pat Tester');
  });
});

describe('the scheduled job', () => {
  it('runs every step without failing', async () => {
    const out = await runJobs(new Date());
    for (const [k, v] of Object.entries(out)) expect(String(v), k).not.toMatch(/^failed/);
  });
});
