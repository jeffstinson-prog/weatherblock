// The owner app's server side, and the Google Calendar sync (with a stand-in calendar).
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dayKey } from '../../src/booking/format';
import { NotAnOwner, ownerFrom, type Owner } from '../../src/server/auth';
import { createBooking, openSlots } from '../../src/server/booking';
import { fakeCalendar, syncCalendar } from '../../src/server/calendar';
import { asService, closeDatabase, db, useDatabase } from '../../src/server/db';
import * as o from '../../src/server/owner';

const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/wb_test';
const SECRET = 'owner-test-jwt-secret-that-is-long-enough';
let owner: Owner;

beforeAll(async () => {
  process.env.SUPABASE_JWT_SECRET = SECRET;
  process.env.APP_ENV = 'test';
  execFileSync('bash', ['scripts/db-local.sh'], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  useDatabase(url);
  const id = randomUUID();
  await db()`insert into auth.users (id, email) values (${id}, 'justin@example.com')`;
  await asService((tx) => tx`insert into wb.owners (user_id, name, email) values (${id}, 'Justin Coffey', 'justin@example.com')`);
  owner = { userId: id, email: 'justin@example.com' };
});
afterAll(() => closeDatabase());
beforeEach(async () => {
  fakeCalendar.reset();
  await asService(async (tx) => {
    await tx`delete from wb.messages`;
    await tx`delete from wb.booking_events`;
    await tx`delete from wb.bookings`;
    await tx`delete from wb.days_off`;
    await tx`delete from wb.calendar_busy`;
    await tx`update wb.settings set calendar_id = null, inspectors = 1`;
  });
});

let n = 7000;
async function book(consent = true, skip = 0) {
  const slot = (await openSlots()).filter((s) => Date.parse(s.startsAt) > Date.now() + 2 * 86_400_000)[skip]!;
  const r = await createBooking({
    draftKey: randomUUID(),
    startedAt: Date.now() - 60_000,
    address: { text: '303 Test River Rd, Calabash, NC 28467', typed: true },
    relationship: 'property_manager',
    roof: { material: 'metal', age: '20+', reason: 'storm', notes: '=HYPERLINK("http://evil")' },
    slotId: slot.id,
    visit: { someoneHome: 'yes', gateCode: '9999', pets: 'Dog' },
    contact: { name: 'Sam Customer', mobile: `910555${++n}`, email: 'sam@example.com', smsConsent: consent },
    source: { heardAbout: '', referralCode: '', utm: { source: 'google', medium: 'gbp' }, viaAssistant: false },
  });
  if (!r.ok) throw new Error(r.message);
  return { ...r, slot };
}

const token = (sub: string) =>
  new SignJWT({ role: 'authenticated', email: 'x@example.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience('authenticated')
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));

describe('sign-in check', () => {
  it('accepts an owner, refuses a stranger and a forged token', async () => {
    const ok = await ownerFrom(new Request('http://x/api/owner/day', { headers: { authorization: `Bearer ${await token(owner.userId)}` } }));
    expect(ok?.userId).toBe(owner.userId);
    const stranger = randomUUID();
    await expect(
      ownerFrom(new Request('http://x', { headers: { authorization: `Bearer ${await token(stranger)}` } })),
    ).rejects.toBeInstanceOf(NotAnOwner);
    const forged = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(owner.userId)
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('wrong-secret-wrong-secret-wrong'));
    expect(await ownerFrom(new Request('http://x', { headers: { authorization: `Bearer ${forged}` } }))).toBeNull();
    expect(await ownerFrom(new Request('http://x'))).toBeNull();
  });
});

describe('the day and the booking', () => {
  it("lists a day's bookings in order and shows the full booking, gate code included", async () => {
    const r = await book();
    const date = dayKey(r.slot.startsAt);
    const list = await o.day(owner, date);
    expect(list.map((b) => b.id)).toContain(r.booking.id);
    const d = await o.detail(owner, r.booking.id);
    expect(d!.gateCode).toBe('9999');
    expect(d!.roof).toBe('Metal, over 20 years');
    expect(d!.leadSource).toBe('google_gbp');
    expect(d!.events.map((e) => e.kind)).toEqual(['created']);
  });

  it('marks done, saves notes, and cancelling tells the customer', async () => {
    const r = await book();
    expect(await o.setNotes(owner, r.booking.id, 'Bring the long ladder')).toEqual({ ok: true });
    expect(await o.setStatus(owner, r.booking.id, 'done', true)).toEqual({ ok: true });
    expect(await o.setStatus(owner, r.booking.id, 'cancelled', true)).toEqual({ ok: true });
    const msgs = await asService((tx) => tx`select audience, kind from wb.messages where booking_id = ${r.booking.id}`);
    expect(msgs.filter((m) => m.kind === 'cancelled' && m.audience === 'customer').length).toBe(2); // email and text
    expect(msgs.some((m) => m.audience === 'owner')).toBe(false); // owners already know
  });

  it('reschedules into an open window and refuses a full one', async () => {
    const a = await book(true, 0);
    const b = await book(true, 1);
    const full = await o.reschedule(owner, a.booking.id, b.slot.id, false);
    expect(full.ok).toBe(false);
    const free = (await openSlots()).find((s) => s.id !== a.slot.id && Date.parse(s.startsAt) > Date.now() + 3 * 86_400_000)!;
    expect(await o.reschedule(owner, a.booking.id, free.id, true)).toEqual({ ok: true });
    const kinds = await asService((tx) => tx`select kind from wb.messages where booking_id = ${a.booking.id} and audience = 'customer'`);
    expect(kinds.map((k) => k.kind)).toContain('rescheduled');
  });

  it('"on my way" texts only customers who agreed to texts', async () => {
    const yes = await book(true);
    const no = await book(false, 1);
    const sent = await o.sendOnMyWay(owner, yes.booking.id, 20);
    expect(sent.ok).toBe(true);
    const [m] = await asService((tx) => tx`select body from wb.messages where booking_id = ${yes.booking.id} and kind = 'on_my_way'`);
    expect(m!.body).toBe('WeatherBlock Roofing: Justin is on the way. About 20 minutes.');
    const refused = await o.sendOnMyWay(owner, no.booking.id, 20);
    expect(refused).toMatchObject({ ok: false, message: expect.stringMatching(/didn't agree to texts/) });
    expect((await o.sendOnMyWay(owner, yes.booking.id, 7)).ok).toBe(false);
  });
});

describe('availability', () => {
  it('saving windows changes what customers can book; overlapping windows are refused', async () => {
    const a = await o.getAvailability(owner);
    expect(a.week[1]!.length).toBe(4); // Monday, 4 windows
    const closedMondays = { ...a, week: a.week.map((w, i) => (i === 1 ? [] : w)) };
    expect(await o.saveAvailability(owner, closedMondays)).toEqual({ ok: true });
    const mondays = (await openSlots()).filter((s) => new Date(s.startsAt).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' }) === 'Monday');
    expect(mondays).toHaveLength(0);
    const overlap = { ...a, week: a.week.map((w, i) => (i === 2 ? [{ start: '08:00', end: '10:00' }, { start: '09:00', end: '11:00' }] : w)) };
    expect((await o.saveAvailability(owner, overlap)).ok).toBe(false);
    expect(await o.saveAvailability(owner, a)).toEqual({ ok: true }); // put it back
  });

  it('adds and removes a day off', async () => {
    const slot = (await openSlots())[5]!;
    const day = dayKey(slot.startsAt);
    await o.addDayOff(owner, day, 'Family');
    expect((await openSlots()).some((s) => dayKey(s.startsAt) === day)).toBe(false);
    await o.removeDayOff(owner, day);
    expect((await openSlots()).some((s) => dayKey(s.startsAt) === day)).toBe(true);
  });
});

describe('referral codes and export', () => {
  it('saves a code and exports bookings without gate codes, with formulas made harmless', async () => {
    expect(await o.saveReferrer(owner, { code: 'pm77', name: 'Coastal Rentals', kind: 'property_manager' })).toEqual({ ok: true });
    expect((await o.saveReferrer(owner, { code: 'no spaces', name: 'x', kind: 'agent' })).ok).toBe(false);
    const list = await o.listReferrers(owner);
    expect(list.map((r) => r.code)).toContain('PM77');
    const r = await book();
    const date = dayKey(r.slot.startsAt);
    const csv = await o.exportCsv(owner, date, date);
    const [header, line] = csv.trim().split('\r\n');
    expect(header).toContain('"Lead source"');
    expect(line).toContain(`"${r.booking.ref}"`);
    expect(csv).not.toContain('9999');
    expect(line).toContain(`"'=HYPERLINK`);
  });
});

describe('Google Calendar sync (stand-in calendar)', () => {
  it('puts bookings on the calendar, blocks busy times, ignores free ones, and removes cancelled bookings', async () => {
    await asService((tx) => tx`update wb.settings set calendar_id = 'owner@example.com'`);
    const r = await book();
    const other = (await openSlots()).find((s) => s.id !== r.slot.id && Date.parse(s.startsAt) > Date.now() + 2 * 86_400_000)!;
    fakeCalendar.addBusy('dentist', other.startsAt, other.endsAt);
    fakeCalendar.addBusy('lunch', other.startsAt, other.endsAt, true); // marked free: ignored

    const first = await syncCalendar();
    expect(first).toMatchObject({ status: 'ok', pushed: 1, busy: 1 });
    const ours = [...fakeCalendar.events.values()].find((e) => e.bookingId === r.booking.id);
    expect(ours?.body?.summary).toMatch(/^Roof inspection: Sam/);
    expect(ours?.body?.description).not.toContain('9999'); // no gate code on the calendar
    expect((await openSlots()).map((s) => s.id)).not.toContain(other.id);

    // Unchanged booking: nothing to push. Our own event never counts as busy.
    expect(await syncCalendar()).toMatchObject({ pushed: 0, busy: 1 });

    // Deleted in Google: put back on the next sync.
    fakeCalendar.events.delete(ours!.id);
    expect(await syncCalendar()).toMatchObject({ pushed: 1 });
    // Moved in Google: put back where the booking is.
    const back = [...fakeCalendar.events.values()].find((e) => e.bookingId === r.booking.id)!;
    fakeCalendar.events.set(back.id, { ...back, start: other.startsAt, end: other.endsAt });
    expect(await syncCalendar()).toMatchObject({ pushed: 1 });
    expect(fakeCalendar.events.get(back.id)!.start).toBe(r.slot.startsAt);
    // A real change to the booking is pushed too.
    await asService((tx) => tx`update wb.bookings set notes = 'Now leaking in two rooms' where id = ${r.booking.id}`);
    expect(await syncCalendar()).toMatchObject({ pushed: 1 });

    // Cancelled: leaves the calendar.
    await o.setStatus(owner, r.booking.id, 'cancelled', false);
    expect(await syncCalendar()).toMatchObject({ removed: 1 });
    expect([...fakeCalendar.events.values()].some((e) => e.bookingId === r.booking.id)).toBe(false);

    // The dentist appointment ends: the window opens again.
    fakeCalendar.events.delete('dentist');
    await syncCalendar();
    expect((await openSlots()).map((s) => s.id)).toContain(other.id);
  });

  it('says "not connected" until a calendar is set', async () => {
    expect(await syncCalendar()).toMatchObject({ status: 'not_connected' });
  });
});
