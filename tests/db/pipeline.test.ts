// After the inspection: the estimate, the customer's answer, follow-ups, crews and roof jobs.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { facts } from '../../src/facts';
import type { Owner } from '../../src/server/auth';
import { createBooking, getByToken, openSlots } from '../../src/server/booking';
import { asPublic, asService, closeDatabase, db, useDatabase } from '../../src/server/db';
import { handleInbound } from '../../src/server/messaging/inbound';
import { send } from '../../src/server/messaging/send';
import * as o from '../../src/server/owner';
import * as p from '../../src/server/pipeline';
import { addDays, local } from '../../src/server/reminders';

const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/wb_test';
let owner: Owner;
const ADDRESS = 'PO Box 100, Ocean Isle Beach, NC 28469';

beforeAll(async () => {
  process.env.APP_ENV = 'test';
  execFileSync('bash', ['scripts/db-local.sh'], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  useDatabase(url);
  const id = randomUUID();
  await db()`insert into auth.users (id, email) values (${id}, 'justin@example.com')`;
  await asService((tx) => tx`insert into wb.owners (user_id, name, email, mobile) values (${id}, 'Justin Coffey', 'justin@example.com', '+19105550100')`);
  owner = { userId: id, email: 'justin@example.com' };
});
afterAll(() => closeDatabase());
beforeEach(async () => {
  facts.business.mailingAddress = ADDRESS;
  await asService(async (tx) => {
    await tx`delete from wb.messages`;
    await tx`delete from wb.booking_events`;
    await tx`delete from wb.bookings`;
    await tx`update wb.crews set jobs_per_day = 1, active = true`;
  });
});
afterEach(() => {
  facts.business.mailingAddress = '';
});

let n = 8100;
async function bookAndInspect(consent = true) {
  const slot = (await openSlots()).filter((s) => Date.parse(s.startsAt) > Date.now() + 2 * 86_400_000)[0]!;
  const r = await createBooking({
    draftKey: randomUUID(),
    startedAt: Date.now() - 60_000,
    address: { text: '101 Test Beach Dr W, Ocean Isle Beach, NC 28469', typed: true },
    relationship: 'owner',
    roof: { material: 'shingle', age: '15-20', reason: 'replace', notes: '' },
    slotId: slot.id,
    visit: { someoneHome: 'no', gateCode: '', pets: '' },
    contact: { name: 'Pat Tester', mobile: `910555${++n}`, email: 'pat@example.com', smsConsent: consent },
    source: { heardAbout: '', referralCode: '', utm: {}, viaAssistant: false },
  });
  if (!r.ok) throw new Error(r.message);
  // The visit happened.
  await asService((tx) => tx`delete from wb.messages`);
  expect(await o.setStatus(owner, r.booking.id, 'done', true)).toEqual({ ok: true });
  return r;
}

const messages = (bookingId: string) =>
  asService(
    (tx) => tx`select audience, channel, kind, subject, body, to_addr from wb.messages
               where booking_id = ${bookingId} and direction = 'out' order by created_at, channel`,
  );

/** A time in the business day (about 11 am Eastern) and one in the evening (about 6:30 pm), today. */
function today(hourUtc: number): Date {
  const d = new Date();
  d.setUTCHours(hourUtc, 30, 0, 0);
  return d;
}

describe('estimate', () => {
  it('thanks the customer when the inspection is done, then sends the estimate by email and text', async () => {
    const r = await bookAndInspect(true);
    const thanks = await messages(r.booking.id);
    expect(thanks.map((m) => `${m.channel}:${m.kind}`)).toEqual(['email:inspected', 'sms:inspected']);
    expect(thanks[1]!.body).toContain('Reply STOP to opt out');

    expect(await p.saveEstimate(owner, r.booking.id, { amountCents: 1_250_000, summary: 'Tear off and new architectural shingles.' })).toEqual({ ok: true, sent: false });
    // A draft isn't visible to the customer.
    expect((await getByToken(r.token)).ok && (await getByToken(r.token) as { booking: { estimate: unknown } }).booking.estimate).toBeNull();

    expect(await p.saveEstimate(owner, r.booking.id, { send: true })).toEqual({ ok: true, sent: true });
    const sent = (await messages(r.booking.id)).filter((m) => m.kind === 'estimate_ready');
    expect(sent.map((m) => m.channel)).toEqual(['email', 'sms']);
    expect(sent[0]!.subject).toBe('Your estimate is ready');
    // The amount stays on the private page, not in the message.
    expect(sent.map((m) => m.body).join(' ')).not.toContain('12,500');

    const seen = await getByToken(r.token);
    if (!seen.ok) throw new Error('not found');
    expect(seen.booking.estimate).toMatchObject({ status: 'sent', amountCents: 1_250_000, summary: 'Tear off and new architectural shingles.' });
    const [e] = await asService((tx) => tx`select viewed_at from wb.estimates where booking_id = ${r.booking.id}`);
    expect(e!.viewed_at).not.toBeNull();
  });

  it('refuses an estimate before the inspection is done, and a silent change after sending', async () => {
    const r = await bookAndInspect(false);
    await o.setStatus(owner, r.booking.id, 'booked', false);
    expect(await p.saveEstimate(owner, r.booking.id, { amountCents: 900_000, send: true })).toMatchObject({ ok: false, status: 409 });
    await o.setStatus(owner, r.booking.id, 'done', false);
    expect(await p.saveEstimate(owner, r.booking.id, { send: true })).toMatchObject({ ok: false, status: 400 });
    expect(await p.saveEstimate(owner, r.booking.id, { amountCents: 900_000, send: true })).toMatchObject({ ok: true, sent: true });
    expect(await p.saveEstimate(owner, r.booking.id, { amountCents: 800_000 })).toMatchObject({ ok: false, status: 409 });
    expect(await p.saveEstimate(owner, r.booking.id, { amountCents: 800_000, send: true })).toMatchObject({ ok: true, sent: true });
    const updated = (await messages(r.booking.id)).filter((m) => m.kind === 'estimate_ready');
    expect(updated.map((m) => m.subject)).toEqual(['Your estimate is ready', 'Your updated estimate is ready']);
    // No texts without consent.
    expect(updated.every((m) => m.channel === 'email')).toBe(true);
  });

  it('nobody but the owners can read estimates or jobs directly', async () => {
    const r = await bookAndInspect();
    await p.saveEstimate(owner, r.booking.id, { amountCents: 500_000, send: true });
    await expect(asPublic((tx) => tx`select * from wb.estimates`)).rejects.toThrow();
    await expect(asPublic((tx) => tx`select * from wb.jobs`)).rejects.toThrow();
  });
});

describe("the customer's answer", () => {
  it('a yes creates the job and alerts the owners once, however many times it is tapped', async () => {
    const r = await bookAndInspect();
    await p.saveEstimate(owner, r.booking.id, { amountCents: 1_400_000, send: true });
    const yes = await p.customerAnswer(r.token, 'accept', '');
    expect(yes).toMatchObject({ ok: true });
    expect(await p.customerAnswer(r.token, 'accept', '')).toMatchObject({ ok: true });
    expect(await p.customerAnswer(r.token, 'decline', '')).toMatchObject({ ok: false, status: 409 });
    const alerts = (await messages(r.booking.id)).filter((m) => m.kind === 'owner_accepted');
    expect(alerts.map((m) => m.channel).sort()).toEqual(['email', 'sms']);
    expect(alerts.find((m) => m.channel === 'sms')!.body).toMatch(/^Said yes: Pat Tester.*\$14,000/);
    const [j] = await asService((tx) => tx`select status from wb.jobs where booking_id = ${r.booking.id}`);
    expect(j!.status).toBe('to_schedule');
    const seen = await getByToken(r.token);
    expect(seen.ok && seen.booking.job).toMatchObject({ status: 'to_schedule', day: null });
  });

  it('a question goes to the owners and stops follow-ups; a no thanks is recorded with its reason', async () => {
    const asks = await bookAndInspect();
    await p.saveEstimate(owner, asks.booking.id, { amountCents: 700_000, send: true });
    expect(await p.customerAnswer(asks.token, 'question', '   ')).toMatchObject({ ok: false, status: 400 });
    expect(await p.customerAnswer(asks.token, 'question', 'Does this include gutters?')).toMatchObject({ ok: true });
    const q = (await messages(asks.booking.id)).find((m) => m.kind === 'owner_question' && m.channel === 'sms');
    expect(q!.body).toContain('"Does this include gutters?"');
    await asService((tx) => tx`update wb.estimates set sent_at = now() - interval '3 days' where booking_id = ${asks.booking.id}`);
    expect(await p.runFollowUps(new Date(Date.now()).getUTCHours() >= 0 ? today(16) : new Date())).toBe(0);

    const no = await bookAndInspect();
    await p.saveEstimate(owner, no.booking.id, { amountCents: 700_000, send: true });
    expect(await p.customerAnswer(no.token, 'decline', 'Going with a family friend.')).toMatchObject({ ok: true });
    const [e] = await asService((tx) => tx`select status, customer_note from wb.estimates where booking_id = ${no.booking.id}`);
    expect(e).toMatchObject({ status: 'declined', customer_note: 'Going with a family friend.' });
    expect(await p.customerAnswer('not-a-real-token-at-all-0000000000000000000', 'accept', '')).toMatchObject({ ok: false, status: 404 });
  });
});

describe('follow-ups', () => {
  it('wait for a mailing address, then go out on days 2, 7 and 21, in business hours, a day apart', async () => {
    const r = await bookAndInspect(true);
    await p.saveEstimate(owner, r.booking.id, { amountCents: 1_000_000, send: true });
    const now = today(16);
    const setSent = (days: number) =>
      asService((tx) => tx`update wb.estimates set sent_at = ${new Date(now.getTime() - days * 86_400_000 - 3_600_000)} where booking_id = ${r.booking.id}`);

    await setSent(2);
    facts.business.mailingAddress = '';
    expect(await p.runFollowUps(now)).toBe('held');
    facts.business.mailingAddress = ADDRESS;
    expect(await p.runFollowUps(today(2))).toBe(0); // the middle of the night
    expect(await p.runFollowUps(now)).toBe(1);
    expect(await p.runFollowUps(now)).toBe(0); // not twice

    await setSent(7);
    expect(await p.runFollowUps(new Date(now.getTime() + 3_600_000))).toBe(0); // a day apart, even after downtime
    await asService((tx) => tx`update wb.estimates set last_followup_at = last_followup_at - interval '1 day' where booking_id = ${r.booking.id}`);
    expect(await p.runFollowUps(now)).toBe(1);

    await setSent(21);
    await asService((tx) => tx`update wb.estimates set last_followup_at = last_followup_at - interval '1 day' where booking_id = ${r.booking.id}`);
    expect(await p.runFollowUps(now)).toBe(1);
    await asService((tx) => tx`update wb.estimates set last_followup_at = last_followup_at - interval '1 day' where booking_id = ${r.booking.id}`);
    expect(await p.runFollowUps(now)).toBe(0); // three and done

    const sent = (await messages(r.booking.id)).filter((m) => m.kind.startsWith('followup_'));
    expect(sent.map((m) => `${m.channel}:${m.kind}`)).toEqual(['email:followup_1', 'email:followup_2', 'email:followup_3']);
    expect(sent.map((m) => m.subject)).toEqual(['Any questions about your estimate?', 'Still thinking it over?', 'One last note about your estimate']);
    // How to stop, and the mailing address, as the CAN-SPAM Act requires.
    for (const m of sent) {
      expect(m.body).toContain('No thanks');
      expect(m.body).toContain(ADDRESS);
    }
  });

  it('stop when the customer texts us, or an owner stops them', async () => {
    const texts = await bookAndInspect(true);
    await p.saveEstimate(owner, texts.booking.id, { amountCents: 1_000_000, send: true });
    await asService((tx) => tx`update wb.estimates set sent_at = now() - interval '3 days' where booking_id = ${texts.booking.id}`);
    const [b] = await asService((tx) => tx`select mobile from wb.bookings where id = ${texts.booking.id}`);
    await handleInbound({ from: b!.mobile, to: '+19105550000', body: 'Can you do it next month?', sid: 'SM-PIPE-1' });
    expect(await p.runFollowUps(today(16))).toBe(0);

    const stopped = await bookAndInspect(false);
    await p.saveEstimate(owner, stopped.booking.id, { amountCents: 1_000_000, send: true });
    await asService((tx) => tx`update wb.estimates set sent_at = now() - interval '3 days' where booking_id = ${stopped.booking.id}`);
    expect(await p.estimateAction(owner, stopped.booking.id, 'stop_followups')).toEqual({ ok: true });
    expect(await p.runFollowUps(today(16))).toBe(0);
  });
});

describe('roof jobs', () => {
  async function accepted(consent = true) {
    const r = await bookAndInspect(consent);
    await p.saveEstimate(owner, r.booking.id, { amountCents: 1_100_000, send: true });
    await p.customerAnswer(r.token, 'accept', '');
    return r;
  }

  it('go on a crew day, warn when the crew is full, and tell the customer', async () => {
    const crews = await p.listCrews(owner);
    expect(crews.map((c) => c.name)).toEqual(['Crew 1', 'Crew 2', 'Crew 3']);
    const day = addDays(local(new Date()).date, 5);
    const first = await accepted(true);
    const second = await accepted(false);
    expect(await p.scheduleJob(owner, first.booking.id, { crewId: crews[0]!.id, day })).toEqual({ ok: true });
    expect(await p.scheduleJob(owner, second.booking.id, { crewId: crews[0]!.id, day })).toMatchObject({ ok: false, status: 409, code: 'crew_full' });
    expect(await p.scheduleJob(owner, second.booking.id, { crewId: crews[1]!.id, day })).toEqual({ ok: true });
    const told = (await messages(first.booking.id)).filter((m) => m.kind === 'job_scheduled');
    expect(told.map((m) => m.channel)).toEqual(['email', 'sms']);
    expect(told[1]!.body).toContain('your roof job is set for');
    expect((await messages(second.booking.id)).filter((m) => m.kind === 'job_scheduled').map((m) => m.channel)).toEqual(['email']);
    const seen = await getByToken(first.token);
    expect(seen.ok && seen.booking.job).toMatchObject({ status: 'scheduled', day });
    // Not before a yes.
    const notYet = await bookAndInspect();
    expect(await p.scheduleJob(owner, notYet.booking.id, { crewId: crews[2]!.id, day })).toMatchObject({ ok: false, status: 404 });
  });

  it('weather moves a whole day, tells each customer, and the evening-before reminder follows the new day', async () => {
    const crews = await p.listCrews(owner);
    const evening = today(23);
    const tomorrow = addDays(local(evening).date, 1);
    const rainy = addDays(local(evening).date, 2);
    const a = await accepted(true);
    const b = await accepted(false);
    await p.scheduleJob(owner, a.booking.id, { crewId: crews[0]!.id, day: rainy });
    await p.scheduleJob(owner, b.booking.id, { crewId: crews[1]!.id, day: rainy });

    expect(await p.moveDay(owner, { from: rainy, to: tomorrow })).toEqual({ ok: true, moved: 2 });
    const moved = (await messages(a.booking.id)).find((m) => m.kind === 'job_moved' && m.channel === 'sms');
    expect(moved!.body).toContain('because of the weather');
    expect((await messages(b.booking.id)).filter((m) => m.kind === 'job_moved').map((m) => m.channel)).toEqual(['email']);

    // A busy crew on the new day needs a second OK.
    const c = await accepted(false);
    const later = addDays(tomorrow, 3);
    await p.scheduleJob(owner, c.booking.id, { crewId: crews[0]!.id, day: later });
    expect(await p.moveDay(owner, { from: tomorrow, to: later })).toMatchObject({ ok: false, status: 409, code: 'crew_full' });

    expect(await p.runJobReminders(evening)).toBe(2);
    expect(await p.runJobReminders(evening)).toBe(0);
    expect((await messages(a.booking.id)).filter((m) => m.kind === 'job_reminder').map((m) => m.channel)).toEqual(['sms']);
    expect((await messages(b.booking.id)).filter((m) => m.kind === 'job_reminder').map((m) => m.channel)).toEqual(['email']);
  });

  it('done sends thanks, with a review request only when a mailing address is on file', async () => {
    const crews = await p.listCrews(owner);
    const day = addDays(local(new Date()).date, 1);
    const withAddress = await accepted();
    await p.scheduleJob(owner, withAddress.booking.id, { crewId: crews[0]!.id, day });
    expect(await p.setJobStatus(owner, withAddress.booking.id, 'done')).toEqual({ ok: true });
    const done = (await messages(withAddress.booking.id)).filter((m) => m.kind === 'job_done');
    expect(done.map((m) => m.channel)).toEqual(['email']);
    expect(done[0]!.body).toContain('Google review');
    expect(done[0]!.body).toContain(ADDRESS);

    facts.business.mailingAddress = '';
    const without = await accepted();
    await p.scheduleJob(owner, without.booking.id, { crewId: crews[1]!.id, day });
    await p.setJobStatus(owner, without.booking.id, 'done');
    const plain = (await messages(without.booking.id)).find((m) => m.kind === 'job_done');
    expect(plain!.body).not.toContain('review');
    const seen = await getByToken(without.token);
    expect(seen.ok && seen.booking.job?.status).toBe('done');
  });
});

describe('the pipeline lists', () => {
  it('sort customers into needs an estimate, waiting, said yes and closed', async () => {
    const needs = await bookAndInspect();
    const waiting = await bookAndInspect();
    await p.saveEstimate(owner, waiting.booking.id, { amountCents: 600_000, send: true });
    const yes = await bookAndInspect();
    await p.saveEstimate(owner, yes.booking.id, { amountCents: 600_000, send: true });
    await p.customerAnswer(yes.token, 'accept', '');
    const no = await bookAndInspect();
    await p.saveEstimate(owner, no.booking.id, { amountCents: 600_000, send: true });
    await p.customerAnswer(no.token, 'decline', '');
    const list = await p.pipeline(owner);
    expect(list.needsEstimate.map((x) => x.id)).toEqual([needs.booking.id]);
    expect(list.waiting.map((x) => x.id)).toEqual([waiting.booking.id]);
    expect(list.saidYes.map((x) => x.id)).toEqual([yes.booking.id]);
    expect(list.closed.map((x) => x.id)).toEqual([no.booking.id]);
  });
});

describe('the text limit', () => {
  it('stops texts at the number the booking form promises; email still goes', async () => {
    const r = await bookAndInspect(true);
    const [b] = await asService((tx) => tx`select mobile from wb.bookings where id = ${r.booking.id}`);
    for (let i = 0; i < facts.texts.maxPerBooking + 2; i++) {
      await send({ bookingId: r.booking.id, channel: 'sms', audience: 'customer', kind: 'test', to: b!.mobile, text: `test ${i}` });
    }
    const [count] = await asService(
      (tx) => tx`select count(*)::int as n from wb.messages where booking_id = ${r.booking.id} and channel = 'sms' and audience = 'customer'`,
    );
    expect(count!.n).toBe(facts.texts.maxPerBooking);
  });
});
