// Booking against a real Postgres: capacity, races, the manage link, row level security.
// Needs DATABASE_URL pointing at a throwaway database (scripts/db-local.sh rebuilds it).
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asOwner, asPublic, asService, closeDatabase, db, useDatabase } from '../../src/server/db';
import { cancelByToken, createBooking, getByToken, openSlots, rescheduleByToken } from '../../src/server/booking';
import { details } from '../../src/server/maps';

const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/wb_test';

beforeAll(() => {
  execFileSync('bash', ['scripts/db-local.sh'], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  useDatabase(url);
});

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  await asService(async (tx) => {
    await tx`delete from wb.booking_photos`;
    await tx`delete from wb.booking_events`;
    await tx`delete from wb.bookings`;
    await tx`delete from wb.days_off`;
    await tx`delete from wb.calendar_busy`;
    await tx`delete from wb.rate_events`;
    await tx`update wb.slots set capacity_override = null`;
    await tx`update wb.settings set min_notice_hours = 12, inspectors = 1`;
  });
});

let phoneSeq = 2000;
function nextMobile(): string {
  phoneSeq += 1;
  return `910555${String(phoneSeq).padStart(4, '0')}`;
}

function body(slotId: string, overrides: Record<string, unknown> = {}) {
  return {
    draftKey: randomUUID(),
    startedAt: Date.now() - 60_000,
    address: { text: '101 Test Beach Dr W, Ocean Isle Beach, NC 28469', typed: true },
    relationship: 'owner',
    roof: { material: 'shingle', age: '10-15', reason: 'leak', notes: '' },
    slotId,
    visit: { someoneHome: 'no', gateCode: '1234', pets: '' },
    contact: { name: 'Test Person', mobile: nextMobile(), email: 'test@example.com', smsConsent: true },
    source: { heardAbout: '', referralCode: '', utm: {}, viaAssistant: false },
    ...overrides,
  };
}

async function futureSlots(n = 5) {
  const slots = await openSlots();
  const later = slots.filter((s) => Date.parse(s.startsAt) > Date.now() + 2 * 86_400_000);
  expect(later.length).toBeGreaterThanOrEqual(n);
  return later.slice(0, n);
}

describe('who can read what', () => {
  it('the public cannot read the tables, only call the booking functions', async () => {
    await expect(asPublic((tx) => tx`select * from wb.bookings`)).rejects.toMatchObject({ code: '42501' });
    await expect(asPublic((tx) => tx`select * from wb.slots`)).rejects.toMatchObject({ code: '42501' });
    await expect(asPublic((tx) => tx`select wb.refresh_slots()`)).rejects.toMatchObject({ code: '42501' });
    const slots = await openSlots();
    expect(slots.length).toBeGreaterThan(10);
  });

  it('a signed-in user who is not an owner sees nothing; an owner sees everything', async () => {
    const [slot] = await futureSlots(1);
    const made = await createBooking(body(slot!.id));
    expect(made.ok).toBe(true);
    const owner = randomUUID();
    const stranger = randomUUID();
    // Supabase Auth creates users; here the test database's admin does.
    await db()`insert into auth.users (id, email) values (${owner}, 'owner@example.com'), (${stranger}, 'x@example.com')`;
    await asService((tx) => tx`insert into wb.owners (user_id, name, email) values (${owner}, 'Owner', 'owner@example.com')`);
    const seenByStranger = await asOwner(stranger, (tx) => tx`select id from wb.bookings`);
    expect(seenByStranger.length).toBe(0);
    const seenByOwner = await asOwner(owner, (tx) => tx`select id from wb.bookings`);
    expect(seenByOwner.length).toBe(1);
    await expect(
      asOwner(stranger, (tx) => tx`update wb.settings set inspectors = 5 returning id`),
    ).resolves.toHaveLength(0);
  });
});

describe('booking', () => {
  it('books a window and returns a reference and a manage link token', async () => {
    const [slot] = await futureSlots(1);
    const r = await createBooking(body(slot!.id));
    if (!r.ok) throw new Error(r.message);
    expect(r.booking.ref).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.booking.status).toBe('booked');
    const again = await getByToken(r.token);
    expect(again.ok && again.booking.ref).toBe(r.booking.ref);
  });

  it('a double tap books once', async () => {
    const [slot] = await futureSlots(1);
    const b = body(slot!.id);
    const [one, two] = await Promise.all([createBooking(b), createBooking(b)]);
    expect(one.ok && two.ok).toBe(true);
    if (one.ok && two.ok) expect(one.booking.ref).toBe(two.booking.ref);
    const count = await asService((tx) => tx`select count(*)::int as n from wb.bookings`);
    expect(count[0]!.n).toBe(1);
  });

  it('a full window refuses the next booking and offers the nearest open times', async () => {
    const [slot] = await futureSlots(1);
    expect((await createBooking(body(slot!.id))).ok).toBe(true);
    const second = await createBooking(body(slot!.id, { slotStartsAt: slot!.startsAt }));
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toBe('slot_full');
      expect(second.message).toMatch(/Pick another time/);
      expect(second.alternatives!.length).toBeGreaterThan(0);
      expect(second.alternatives!.map((s) => s.id)).not.toContain(slot!.id);
    }
    const open = await openSlots();
    expect(open.map((s) => s.id)).not.toContain(slot!.id);
  });

  it('two people grabbing the last spot at once: exactly one gets it', async () => {
    const [slot] = await futureSlots(1);
    const attempts = await Promise.all(Array.from({ length: 8 }, () => createBooking(body(slot!.id))));
    expect(attempts.filter((a) => a.ok).length).toBe(1);
    expect(attempts.filter((a) => !a.ok && a.error === 'slot_full').length).toBe(7);
  });

  it('with two inspectors, a window takes exactly two even under a rush', async () => {
    const [slot] = await futureSlots(1);
    await asService((tx) => tx`update wb.slots set capacity_override = 2 where id = ${slot!.id}`);
    const attempts = await Promise.all(Array.from({ length: 6 }, () => createBooking(body(slot!.id))));
    expect(attempts.filter((a) => a.ok).length).toBe(2);
  });

  it('the database itself refuses an overbooking, even from an owner', async () => {
    const [a, b] = await futureSlots(2);
    const first = await createBooking(body(a!.id));
    const second = await createBooking(body(b!.id));
    if (!first.ok || !second.ok) throw new Error('setup');
    const owner = randomUUID();
    await db()`insert into auth.users (id) values (${owner})`;
    await asService((tx) => tx`insert into wb.owners (user_id, name, email) values (${owner}, 'Owner', 'o@example.com')`);
    await expect(
      asOwner(owner, (tx) => tx`update wb.bookings set slot_id = ${a!.id} where id = ${second.booking.id}`),
    ).rejects.toMatchObject({ code: 'WB409' });
  });

  it('refuses a window inside the minimum notice', async () => {
    const [slot] = await futureSlots(1);
    await asService((tx) => tx`update wb.settings set min_notice_hours = 168`);
    const r = await createBooking(body(slot!.id));
    expect(r.ok).toBe(false);
  });

  it('caps one mobile number at 3 upcoming inspections', async () => {
    const slots = await futureSlots(4);
    const mobile = nextMobile();
    for (const s of slots.slice(0, 3)) {
      const r = await createBooking(body(s.id, { contact: { name: 'Same', mobile, email: 'same@example.com', smsConsent: false } }));
      expect(r.ok).toBe(true);
    }
    const fourth = await createBooking(body(slots[3]!.id, { contact: { name: 'Same', mobile, email: 'same@example.com', smsConsent: false } }));
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) expect(fourth.error).toBe('too_many_bookings');
  });

  it('stores the exact text-message consent wording only when they agreed', async () => {
    const [a, b] = await futureSlots(2);
    await createBooking(body(a!.id));
    await createBooking(body(b!.id, { contact: { name: 'No Texts', mobile: nextMobile(), email: 'n@example.com', smsConsent: false } }));
    const rows = await asService((tx) => tx`select name, sms_consent, sms_consent_text, sms_consent_at from wb.bookings order by created_at`);
    expect(rows[0]!.sms_consent).toBe(true);
    expect(rows[0]!.sms_consent_text).toMatch(/Reply STOP to opt out/);
    expect(rows[0]!.sms_consent_at).toBeTruthy();
    expect(rows[1]!.sms_consent).toBe(false);
    expect(rows[1]!.sms_consent_text).toBeNull();
  });

  it('records the lead source; a valid referral code wins', async () => {
    const [a, b, c] = await futureSlots(3);
    await asService((tx) => tx`insert into wb.referrers (code, name, kind) values ('SMITH24', 'Pat Smith', 'agent')`);
    await createBooking(body(a!.id, { source: { heardAbout: 'google', referralCode: 'smith24', utm: {}, viaAssistant: false } }));
    await createBooking(body(b!.id, { source: { heardAbout: '', referralCode: '', utm: { source: 'google', medium: 'gbp' }, viaAssistant: false } }));
    await createBooking(body(c!.id, { source: { heardAbout: '', referralCode: 'NOPE99', utm: {}, viaAssistant: true } }));
    const rows = await asService((tx) => tx`select lead_source, referral_code from wb.bookings order by created_at`);
    expect(rows.map((r) => r.lead_source)).toEqual(['referral', 'google_gbp', 'assistant']);
    expect(rows[0]!.referral_code).toBe('SMITH24');
  });
});

describe('addresses', () => {
  it('trusts map details only when our server signed them', async () => {
    const [slot] = await futureSlots(1);
    const place = await details('test-oib-1', 's');
    const good = await createBooking(body(slot!.id, { address: { ...place, text: place!.text } }));
    expect(good.ok).toBe(true);
    const [other] = (await futureSlots(2)).slice(1);
    const tampered = await createBooking(body(other!.id, { address: { ...place, county: 'Somewhere Else' } }));
    expect(tampered.ok).toBe(false);
  });

  it('refuses a signed address outside the service area', async () => {
    const [slot] = await futureSlots(1);
    const place = await details('test-wil-1', 's');
    expect(place!.inArea).toBe(false);
    const r = await createBooking(body(slot!.id, { address: { ...place } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('out_of_area');
  });
});

describe('the manage link', () => {
  it('reschedules into an open window, frees the old one, and refuses a full one', async () => {
    const [a, b, c] = await futureSlots(3);
    const mine = await createBooking(body(a!.id));
    const theirs = await createBooking(body(c!.id));
    if (!mine.ok || !theirs.ok) throw new Error('setup');
    const full = await rescheduleByToken(mine.token, c!.id);
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.error).toBe('slot_full');
    const moved = await rescheduleByToken(mine.token, b!.id);
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      expect(moved.booking.startsAt).toBe(b!.startsAt);
      expect(moved.previousStartsAt).toBe(a!.startsAt);
    }
    const open = (await openSlots()).map((s) => s.id);
    expect(open).toContain(a!.id);
    expect(open).not.toContain(b!.id);
  });

  it('cancels, frees the window, and then refuses changes', async () => {
    const [a, b] = await futureSlots(2);
    const r = await createBooking(body(a!.id));
    if (!r.ok) throw new Error('setup');
    const cancelled = await cancelByToken(r.token, 'Roof got fixed');
    expect(cancelled.ok && cancelled.booking.status).toBe('cancelled');
    expect((await openSlots()).map((s) => s.id)).toContain(a!.id);
    const again = await rescheduleByToken(r.token, b!.id);
    expect(again.ok).toBe(false);
    const events = await asService((tx) => tx`select kind from wb.booking_events where booking_id = ${r.booking.id} order by at`);
    expect(events.map((e) => e.kind)).toEqual(['created', 'cancelled']);
  });

  it('a wrong token finds nothing', async () => {
    const r = await getByToken('A'.repeat(43));
    expect(r.ok).toBe(false);
  });
});

describe('availability', () => {
  it('a day off closes that day, and a busy calendar event takes an inspector out', async () => {
    const [a, b] = await futureSlots(2);
    const tzDay = new Date(a!.startsAt).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    await asService((tx) => tx`insert into wb.days_off (day) values (${tzDay})`);
    let open = (await openSlots()).map((s) => s.id);
    expect(open).not.toContain(a!.id);
    await asService((tx) => tx`delete from wb.days_off`);
    await asService(
      (tx) => tx`insert into wb.calendar_busy (event_id, starts_at, ends_at) values ('e1', ${b!.startsAt}, ${b!.endsAt})`,
    );
    open = (await openSlots()).map((s) => s.id);
    expect(open).toContain(a!.id);
    expect(open).not.toContain(b!.id);
  });

  it('more inspectors means more room in every window', async () => {
    const [slot] = await futureSlots(1);
    await asService((tx) => tx`update wb.settings set inspectors = 2`);
    const attempts = await Promise.all(Array.from({ length: 3 }, () => createBooking(body(slot!.id))));
    expect(attempts.filter((x) => x.ok).length).toBe(2);
  });
});

describe('photos and privacy', () => {
  it('links draft photos to the booking and refuses bad paths and a seventh photo', async () => {
    const [slot] = await futureSlots(1);
    const b = body(slot!.id);
    for (let i = 0; i < 6; i++) {
      await asPublic((tx) => tx`select wb_api.register_photo(${b.draftKey}, ${`uploads/${randomUUID()}.jpg`}, 'image/jpeg', 1000)`);
    }
    await expect(
      asPublic((tx) => tx`select wb_api.register_photo(${b.draftKey}, ${`uploads/${randomUUID()}.jpg`}, 'image/jpeg', 1000)`),
    ).rejects.toMatchObject({ code: 'WB429' });
    await expect(
      asPublic((tx) => tx`select wb_api.register_photo(${randomUUID()}, '../../etc/passwd', 'image/jpeg', 1000)`),
    ).rejects.toMatchObject({ code: 'WB400' });
    const r = await createBooking(b);
    if (!r.ok) throw new Error('setup');
    const linked = await asService((tx) => tx`select count(*)::int as n from wb.booking_photos where booking_id = ${r.booking.id}`);
    expect(linked[0]!.n).toBe(6);
  });

  it('gate codes are deleted a week after the visit', async () => {
    const [slot] = await futureSlots(1);
    const r = await createBooking(body(slot!.id));
    if (!r.ok) throw new Error('setup');
    // Move the booking into the past.
    await asService(async (tx) => {
      const [old] = await tx`insert into wb.slots (starts_at, ends_at, capacity) values (now() - interval '10 days', now() - interval '10 days' + interval '2 hours', 1) returning id`;
      await tx`update wb.bookings set slot_id = ${old!.id} where id = ${r.booking.id}`;
    });
    const [res] = await asService((tx) => tx`select wb.purge_gate_codes() as n`);
    expect(res!.n).toBe(1);
    const [row] = await asService((tx) => tx`select gate_code from wb.bookings where id = ${r.booking.id}`);
    expect(row!.gate_code).toBeNull();
  });
});
