// Estimate requests: saved first, measured for the owners, the owners alerted,
// tied to the booking that follows, and nothing about size or price for the customer.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { facts } from '../../src/facts';
import type { Owner } from '../../src/server/auth';
import { createBooking, customerView, getByToken, openSlots } from '../../src/server/booking';
import { asOwner, asPublic, asService, closeDatabase, db, useDatabase } from '../../src/server/db';
import { details, verifyPlace } from '../../src/server/maps';
import * as o from '../../src/server/owner';
import * as p from '../../src/server/pipeline';
import { local } from '../../src/server/reminders';
import * as q from '../../src/server/requests';

const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/wb_test';
let owner: Owner;

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
  await asService(async (tx) => {
    await tx`delete from wb.messages`;
    await tx`delete from wb.estimate_requests`;
    await tx`delete from wb.booking_events`;
    await tx`delete from wb.bookings`;
  });
});
afterEach(() => {
  facts.estimate.showBallpark = false;
  delete process.env.GOOGLE_MAPS_STATIC_KEY;
});

const TEST_HOUSE = '101 Test Beach Dr W, Ocean Isle Beach, NC 28469';
let n = 6100;
const nextMobile = () => `910555${++n}`;

/** An address picked from the list: the test house, signed by the server. */
const picked = async (placeId = 'test-oib-1') => ({ ...(await details(placeId, 'session'))! });

function body(over: Record<string, unknown> = {}) {
  return {
    key: randomUUID(),
    startedAt: Date.now() - 60_000,
    contact: { name: 'Pat Tester', mobile: nextMobile(), email: 'pat@example.com' },
    source: { utm: { source: 'google', medium: 'cpc', campaign: 'roof-estimate' } },
    ...over,
  };
}

const messages = () =>
  asService((tx) => tx`select audience, channel, kind, subject, body, to_addr, request_id from wb.messages where direction = 'out' order by audience desc, channel`);
const row = async (ref: string) => (await asService((tx) => tx`select * from wb.estimate_requests where ref = ${ref}`))[0]!;

async function ask(over: Record<string, unknown> = {}) {
  const r = await q.createRequest(body({ address: await picked(), ...over }));
  if (!r.ok) throw new Error(r.message);
  return r;
}

async function book(mobile: string, address: Record<string, unknown> = { text: TEST_HOUSE, typed: true }) {
  const slot = (await openSlots()).filter((s) => Date.parse(s.startsAt) > Date.now() + 2 * 86_400_000)[0]!;
  const r = await createBooking({
    draftKey: randomUUID(),
    startedAt: Date.now() - 60_000,
    address,
    relationship: 'owner',
    roof: { material: 'shingle', age: '15-20', reason: 'replace', notes: '' },
    slotId: slot.id,
    visit: { someoneHome: 'no', gateCode: '', pets: '' },
    contact: { name: 'Pat Tester', mobile, email: 'pat@example.com', smsConsent: false },
    source: { heardAbout: '', referralCode: '', utm: {}, viaAssistant: false },
  });
  if (!r.ok) throw new Error(r.message);
  return r;
}

describe('asking for an estimate', () => {
  it('saves the request, measures the roof for the owners, and alerts them at once', async () => {
    const r = await ask();
    expect(r).toMatchObject({ ok: true, firstName: 'Pat', existing: false, ballpark: null });
    expect(r.ref).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);

    const saved = await row(r.ref);
    expect(saved).toMatchObject({ status: 'new', name: 'Pat Tester', address: TEST_HOUSE, place_id: 'test-oib-1', lead_source: 'google_cpc', booking_id: null });
    expect(saved.roof).toMatchObject({ source: 'google', squares: [22.5, 26], pitch: '6/12', ballpark: [10100, 11700] });
    expect(saved.utm).toEqual({ source: 'google', medium: 'cpc', campaign: 'roof-estimate' });

    const sent = await messages();
    expect(sent.map((m) => `${m.audience}:${m.channel}:${m.kind}`)).toEqual(['owner:email:owner_request', 'owner:sms:owner_request', 'customer:email:request_received']);
    expect(sent.every((m) => m.request_id === saved.id)).toBe(true);
    const text = sent[1]!;
    expect(text.to_addr).toBe('+19105550100');
    expect(text.body).toContain('Estimate request: Pat Tester');
    expect(text.body).toContain('Ballpark $10,100 to $11,700.');
    expect(text.body).toContain(`/app/#/request/${saved.id}`);
  });

  it("tells the customer no price and nothing about the roof's size", async () => {
    const r = await ask();
    expect(JSON.stringify(r)).not.toMatch(/\$|squares|pitch|10100|2250/);
    const copy = (await messages()).find((m) => m.audience === 'customer')!;
    expect(copy.subject).toBe('We got your estimate request');
    expect(copy.body).toContain(`One of us will call you ${facts.derived.estimateCallback}`);
    expect(copy.body).toMatch(/\/estimate\/book\/#r=[A-Za-z0-9_-]{43}/);
    expect(copy.body).not.toMatch(/\$\s?\d|square|pitch|ballpark/i);
  });

  it('shows the customer a ballpark only when the facts file says so', async () => {
    facts.estimate.showBallpark = true;
    const r = await ask();
    expect(r.ballpark).toEqual({ low: '$10,100', high: '$11,700', material: 'architectural shingles' });
    const copy = (await messages()).find((m) => m.audience === 'customer')!;
    expect(copy.body).toContain('Your ballpark for a new roof with architectural shingles: $10,100 to $11,700.');
  });

  it('a double tap, or the same person asking again that day, makes one request and one alert', async () => {
    const first = body({ address: await picked() });
    const a = await q.createRequest(first);
    const again = await q.createRequest(first);
    const other = await q.createRequest({ ...first, key: randomUUID() });
    if (!a.ok || !again.ok || !other.ok) throw new Error('refused');
    expect(again).toMatchObject({ ref: a.ref, existing: true });
    expect(other).toMatchObject({ ref: a.ref, existing: true });
    const [{ count }] = await asService((tx) => tx`select count(*)::int as count from wb.estimate_requests`) as unknown as [{ count: number }];
    expect(count).toBe(1);
    expect((await messages()).filter((m) => m.kind === 'owner_request')).toHaveLength(2); // one email, one text
  });

  it('takes an address typed by hand, with no roof sheet, and no email', async () => {
    const r = await q.createRequest(body({ address: { text: '12 Nowhere Lane, Supply, NC 28462', typed: true }, contact: { name: 'Sam', mobile: nextMobile(), email: '' } }));
    if (!r.ok) throw new Error(r.message);
    const saved = await row(r.ref);
    expect(saved).toMatchObject({ place_id: null, lat: null, roof: null, email: null });
    const sent = await messages();
    expect(sent.map((m) => m.audience)).toEqual(['owner', 'owner']);
    expect(sent[1]!.body).toContain('Roof not measured from above.');
  });

  it('checks everything again on the server', async () => {
    const place = await picked();
    const cases: [Record<string, unknown>, number, string][] = [
      [{ address: place, contact: { name: 'Pat', mobile: '555-0142', email: '' } }, 422, 'invalid'],
      [{ address: place, contact: { name: '', mobile: nextMobile(), email: '' } }, 422, 'invalid'],
      [{ address: place, contact: { name: 'Pat', mobile: nextMobile(), email: 'pat@' } }, 422, 'invalid'],
      [{ address: { text: '12 Oc' } }, 422, 'invalid'],
      [{ address: place, website: 'http://spam.example' }, 400, 'bad_request'],
      [{ address: place, startedAt: Date.now() }, 400, 'too_fast'],
      [{ address: { ...place, lat: place.lat + 0.01 } }, 422, 'invalid'], // the signature no longer matches
      [{ address: await picked('test-wil-1') }, 422, 'out_of_area'],
    ];
    for (const [over, status, error] of cases) {
      const r = await q.createRequest(body(over));
      expect(r, JSON.stringify(over).slice(0, 80)).toMatchObject({ ok: false, status, error });
    }
    expect(await messages()).toHaveLength(0);
  });

  it('stops one number from flooding the owners', async () => {
    const mobile = nextMobile();
    for (const street of ['1 First St', '2 Second St', '3 Third St']) {
      const r = await q.createRequest(body({ address: { text: `${street}, Shallotte, NC 28470`, typed: true }, contact: { name: 'Pat', mobile, email: '' } }));
      expect(r.ok).toBe(true);
    }
    const fourth = await q.createRequest(body({ address: { text: '4 Fourth St, Shallotte, NC 28470', typed: true }, contact: { name: 'Pat', mobile, email: '' } }));
    expect(fourth).toMatchObject({ ok: false, status: 429, error: 'too_many' });
  });

  it('keeps the table closed to the public and to signed-in strangers', async () => {
    await ask();
    await expect(asPublic((tx) => tx`select count(*) from wb.estimate_requests`)).rejects.toThrow(/permission denied/);
    const [seen] = await asOwner(randomUUID(), (tx) => tx`select count(*)::int as n from wb.estimate_requests`);
    expect(seen!.n).toBe(0);
  });
});

describe('from request to booking', () => {
  it("the link in the customer's email fills the booking form, while the request is open", async () => {
    const r = await ask();
    const copy = (await messages()).find((m) => m.audience === 'customer')!;
    const token = /#r=([A-Za-z0-9_-]{43})/.exec(copy.body)![1]!;
    const prefill = await q.requestForBooking(token);
    expect(prefill!.contact).toMatchObject({ name: 'Pat Tester', email: 'pat@example.com' });
    expect(prefill!.contact.mobile).toMatch(/^\+1910555\d{4}$/);
    // The address comes back signed, so the booking form treats it as picked from the list.
    expect(verifyPlace(prefill!.place as never)).toBe(true);
    expect(prefill!.place).toMatchObject({ text: TEST_HOUSE, inArea: true });

    expect(await q.requestForBooking('x'.repeat(43))).toBeNull();
    const saved = await row(r.ref);
    expect(await q.setRequestStatus(owner, saved.id, 'closed', 'Not interested')).toEqual({ ok: true });
    expect(await q.requestForBooking(token)).toBeNull();
  });

  it('a booking from the same number is tied to the request, and carries its roof sheet and where they came from', async () => {
    const mobile = nextMobile();
    const r = await ask({ contact: { name: 'Pat Tester', mobile, email: '' } });
    const booked = await book(mobile);
    await q.attachToBooking({ id: booked.booking.id, mobile: booked.mobile, lat: null, lng: null });

    const saved = await row(r.ref);
    expect(saved).toMatchObject({ status: 'booked', booking_id: booked.booking.id });
    const [b] = await asService((tx) => tx`select roof, lead_source, utm from wb.bookings where id = ${booked.booking.id}`);
    expect(b!.roof).toMatchObject({ source: 'google', ballpark: [10100, 11700] });
    expect(b!.lead_source).toBe('google_cpc');
    expect(b!.utm).toMatchObject({ campaign: 'roof-estimate' });

    const detail = await o.detail(owner, booked.booking.id);
    expect(detail!.request).toMatchObject({ id: saved.id, ref: r.ref });
    expect(detail!.roofSheet).toMatchObject({ squares: [22.5, 26] });
    expect(detail!.roofSuggestion).toEqual({ sqft: 2250, pitch: 6, source: 'google', imagery: 'March 2025' });
  });

  it('a booking nobody asked an estimate for still gets a roof sheet when its address was picked from the list', async () => {
    const place = await picked();
    // Someone else asked about this same house. A different number is a different person: no tie.
    const other = await ask();
    const booked = await book(nextMobile(), place);
    await q.attachToBooking({ id: booked.booking.id, mobile: booked.mobile, lat: place.lat, lng: place.lng });
    const [b] = await asService((tx) => tx`select roof, lead_source from wb.bookings where id = ${booked.booking.id}`);
    expect(b!.roof).toMatchObject({ source: 'google', pitch: '6/12' });
    expect(b!.lead_source).toBe('direct');
    expect((await o.detail(owner, booked.booking.id))!.request).toBeNull();
    expect((await row(other.ref)).status).toBe('new');
  });

  it("the estimate can state the roof's size and pitch, and the customer sees them", async () => {
    const mobile = nextMobile();
    await ask({ contact: { name: 'Pat Tester', mobile, email: '' } });
    const booked = await book(mobile, await picked());
    await q.attachToBooking({ id: booked.booking.id, mobile: booked.mobile, lat: null, lng: null });
    expect(await o.setStatus(owner, booked.booking.id, 'done', false)).toEqual({ ok: true });

    expect(await p.saveEstimate(owner, booked.booking.id, { amountCents: 1_250_000, roofSqft: 50 })).toMatchObject({ ok: false, message: 'Check the roof size: square feet, like 2400.' });
    expect(await p.saveEstimate(owner, booked.booking.id, { amountCents: 1_250_000, roofSqft: 2300, roofPitch: 6, send: true })).toEqual({ ok: true, sent: true });
    expect((await p.forBooking(owner, booked.booking.id)).estimate).toMatchObject({ roofSqft: 2300, roofPitch: 6 });

    process.env.GOOGLE_MAPS_STATIC_KEY = 'test-static-key';
    const seen = await getByToken(booked.token);
    if (!seen.ok) throw new Error('not found');
    expect(seen.booking.estimate).toMatchObject({ amountCents: 1_250_000, roofSqft: 2300, roofPitch: 6 });
    // The picture is asked for by address, so no map position has to be kept for it.
    expect(seen.booking.roofPicture).toContain(`center=${encodeURIComponent(TEST_HOUSE)}`);
    expect(seen.booking.roofPicture).toContain('maptype=satellite');

    // Leaving the size out leaves the roof off the estimate.
    expect(await p.saveEstimate(owner, booked.booking.id, { roofSqft: null, roofPitch: null, send: true })).toEqual({ ok: true, sent: true });
    const after = await getByToken(booked.token);
    if (!after.ok) throw new Error('not found');
    expect(after.booking.estimate).toMatchObject({ roofSqft: null });
    expect(after.booking.roofPicture ?? null).toBeNull();

    // An address typed by hand gets the numbers but no picture: it could land on the wrong house.
    const typed = await book(nextMobile());
    expect(await o.setStatus(owner, typed.booking.id, 'done', false)).toEqual({ ok: true });
    expect(await p.saveEstimate(owner, typed.booking.id, { amountCents: 900_000, roofSqft: 1800, send: true })).toEqual({ ok: true, sent: true });
    const plain = await getByToken(typed.token);
    if (!plain.ok) throw new Error('not found');
    expect(plain.booking.estimate).toMatchObject({ roofSqft: 1800, roofPitch: null });
    expect(plain.booking.roofPicture ?? null).toBeNull();
  });

  it("the roof picture stays on the customer's estimate after they answer", async () => {
    process.env.GOOGLE_MAPS_STATIC_KEY = 'test-static-key';
    const booked = await book(nextMobile(), await picked());
    expect(await o.setStatus(owner, booked.booking.id, 'done', false)).toEqual({ ok: true });
    expect(await p.saveEstimate(owner, booked.booking.id, { amountCents: 1_100_000, roofSqft: 2250, roofPitch: 6, send: true })).toEqual({ ok: true, sent: true });
    const answered = await p.customerAnswer(booked.token, 'accept', '');
    if (!answered.ok) throw new Error(answered.message);
    const view = customerView(answered.booking as Record<string, unknown>);
    expect(view.estimate).toMatchObject({ status: 'accepted', roofSqft: 2250, roofPitch: 6 });
    expect(view.roofPicture).toContain(`center=${encodeURIComponent(TEST_HOUSE)}`);
  });
});

describe('the owner app', () => {
  it('lists who to call first, and follows a request through called, closed and reopened', async () => {
    const a = await ask();
    const b = await ask({ contact: { name: 'Sam Second', mobile: nextMobile(), email: '' } });
    const first = await row(a.ref);
    const second = await row(b.ref);
    await asService((tx) => tx`update wb.estimate_requests set created_at = now() - interval '2 hours' where id = ${second.id}`);

    let lists = await q.listRequests(owner);
    expect(lists.toCall.map((r) => r.name)).toEqual(['Sam Second', 'Pat Tester']); // the longest wait first
    expect(lists.toCall[0]!.roof).toContain('Ballpark $10,100 to $11,700.');

    expect(await q.setRequestStatus(owner, first.id, 'called', '')).toEqual({ ok: true });
    expect(await q.setRequestNotes(owner, first.id, 'Wants a call after 5.')).toEqual({ ok: true });
    expect(await q.setRequestStatus(owner, second.id, 'closed', 'Asked twice')).toEqual({ ok: true });
    lists = await q.listRequests(owner);
    expect([lists.toCall.length, lists.called.length, lists.closed.length]).toEqual([0, 1, 1]);

    const detail = await q.requestDetail(owner, first.id);
    expect(detail).toMatchObject({ status: 'called', ownerNotes: 'Wants a call after 5.', leadSource: 'google_cpc', canMeasure: true });
    expect(detail!.calledAt).not.toBeNull();
    expect(detail!.roofSheet).toMatchObject({ pitch: '6/12' });
    expect(detail!.link).toMatch(/\/estimate\/book\/#r=[A-Za-z0-9_-]{43}$/);
    expect(verifyPlace(detail!.prefill.place as never)).toBe(true);
    expect(detail!.messages.map((m) => m.kind)).toContain('owner_request');

    expect(await q.setRequestStatus(owner, second.id, 'new', '')).toEqual({ ok: true });
    expect((await row(b.ref)).close_reason).toBeNull();
    expect(await q.setRequestStatus(owner, first.id, 'booked', '')).toMatchObject({ ok: false, status: 400 });
    expect(await q.requestDetail(owner, randomUUID())).toBeNull();
  });

  it('measures again on request', async () => {
    const r = await ask();
    const saved = await row(r.ref);
    await asService((tx) => tx`update wb.estimate_requests set roof = null, roof_measured_at = null where id = ${saved.id}`);
    expect(await q.remeasureRequest(owner, saved.id)).toEqual({ ok: true });
    expect((await row(r.ref)).roof).toMatchObject({ source: 'google' });

    const typed = await q.createRequest(body({ address: { text: '12 Nowhere Lane, Supply, NC 28462', typed: true } }));
    if (!typed.ok) throw new Error(typed.message);
    expect(await q.remeasureRequest(owner, (await row(typed.ref)).id)).toMatchObject({ ok: false, status: 409 });
  });
});

describe('the scheduled job', () => {
  /** 2 pm Eastern today, and 2 am the night after. */
  function times() {
    const base = new Date();
    const day = new Date(base.getTime() + (14 * 60 - local(base).minutes) * 60_000);
    return { day, night: new Date(day.getTime() + 12 * 3_600_000) };
  }

  it('nudges the owners once when a request has waited half an hour, and only in the daytime', async () => {
    const { day, night } = times();
    const r = await ask();
    const saved = await row(r.ref);
    await asService((tx) => tx`delete from wb.messages`);
    // The job's clock is 2 pm today, whatever time the tests run: the request came in a minute before.
    await asService((tx) => tx`update wb.estimate_requests set created_at = ${new Date(day.getTime() - 60_000)} where id = ${saved.id}`);

    expect(await q.runRequestReminders(day)).toBe(0); // only a minute old
    await asService((tx) => tx`update wb.estimate_requests set created_at = ${new Date(day.getTime() - 40 * 60_000)} where id = ${saved.id}`);
    expect(await q.runRequestReminders(night)).toBe(0);
    expect(await q.runRequestReminders(day)).toBe(1);
    expect(await q.runRequestReminders(day)).toBe(0);
    const sent = await messages();
    expect(sent.map((m) => m.kind)).toEqual(['owner_request_reminder']);
    expect(sent[0]!.body).toContain('Still to call: Pat Tester');
    expect(sent[0]!.body).toContain('asked for an estimate 40 minutes ago');
  });

  it('leaves a request alone once someone has called', async () => {
    const { day } = times();
    const r = await ask();
    const saved = await row(r.ref);
    await asService((tx) => tx`update wb.estimate_requests set created_at = ${new Date(day.getTime() - 40 * 60_000)} where id = ${saved.id}`);
    await q.setRequestStatus(owner, saved.id, 'called', '');
    expect(await q.runRequestReminders(day)).toBe(0);
  });

  it("deletes what Google gave us after 30 days, and keeps the address and Google's place ID", async () => {
    const place = await picked();
    const r = await ask();
    const booked = await book(nextMobile(), place);
    await q.attachToBooking({ id: booked.booking.id, mobile: booked.mobile, lat: place.lat, lng: place.lng });
    await asService(async (tx) => {
      await tx`update wb.estimate_requests set created_at = now() - interval '31 days', roof_measured_at = now() - interval '31 days'`;
      await tx`update wb.bookings set created_at = now() - interval '31 days', roof_measured_at = now() - interval '31 days'`;
    });
    const [before] = await asService((tx) => tx`select updated_at, lat, roof from wb.bookings where id = ${booked.booking.id}`);
    expect(before!.lat).not.toBeNull();
    expect(before!.roof).not.toBeNull();

    const [out] = await asService((tx) => tx`select wb.cleanup() as r`);
    expect(out!.r.google_data).toBe(4);

    const saved = await row(r.ref);
    expect(saved).toMatchObject({ lat: null, lng: null, roof: null, address: TEST_HOUSE, place_id: 'test-oib-1' });
    const [after] = await asService((tx) => tx`select updated_at, lat, lng, roof, address, place_id from wb.bookings where id = ${booked.booking.id}`);
    expect(after).toMatchObject({ lat: null, lng: null, roof: null, address: TEST_HOUSE, place_id: 'test-oib-1' });
    // Housekeeping doesn't count as a change to the booking (the calendar sync watches this).
    expect(new Date(after!.updated_at).getTime()).toBe(new Date(before!.updated_at).getTime());

    // The emailed link still works: the address just counts as typed now.
    const prefill = (await q.requestDetail(owner, saved.id))!.prefill;
    expect(prefill.place).toEqual({ text: TEST_HOUSE, typed: true });
  });
});
