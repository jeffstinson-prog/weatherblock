// The homeowner portal: a message from the private page (checked, limited, saved,
// follow-ups stopped, a task made, the owners told), and what a customer can see:
// their own messages and photos, never the owners' alerts, a team photo nobody
// shared, or another booking's anything.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { facts } from '../../src/facts';
import type { Owner } from '../../src/server/auth';
import { createBooking, getByToken, openSlots } from '../../src/server/booking';
import { asService, closeDatabase, db, useDatabase } from '../../src/server/db';
import { rateOk } from '../../src/server/http';
import { bookingCreated } from '../../src/server/notify';
import * as o from '../../src/server/owner';
import * as p from '../../src/server/pipeline';
import { customerPhotos, customerThread, portalView, sendPortalMessage } from '../../src/server/portal';
import * as push from '../../src/server/push';
import { local } from '../../src/server/reminders';
import { checkLocalSignature } from '../../src/server/storage';

const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/wb_test';
const justin: Owner = { userId: randomUUID(), email: 'justin@example.com' };
const jt: Owner = { userId: randomUUID(), email: 'jt@example.com' };
const quiet: Owner = { userId: randomUUID(), email: 'quiet@example.com' };
const DEVICE = 'https://fcm.googleapis.com/fcm/send/justins-phone';

beforeAll(async () => {
  process.env.APP_ENV = 'test';
  execFileSync('bash', ['scripts/db-local.sh'], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  useDatabase(url);
  for (const [who, name, email] of [
    [justin, 'Justin Coffey', true],
    [jt, 'JT Stinson', true],
    [quiet, 'No Email Alerts', false],
  ] as const) {
    await db()`insert into auth.users (id, email) values (${who.userId}, ${who.email})`;
    await asService((tx) => tx`insert into wb.owners (user_id, name, email, alert_email) values (${who.userId}, ${name}, ${who.email}, ${email})`);
  }
  await push.subscribe(justin, { endpoint: DEVICE, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } }, 'iPhone');
});
afterAll(() => closeDatabase());
beforeEach(async () => {
  push.loggedPushes.length = 0;
  await asService(async (tx) => {
    await tx`delete from wb.tasks`;
    await tx`delete from wb.messages`;
    await tx`delete from wb.booking_events`;
    await tx`delete from wb.booking_photos`;
    await tx`delete from wb.bookings`;
  });
});

let n = 6100;
let slotIndex = 0;
async function book(name = 'Pat Tester') {
  const slots = await openSlots();
  const slot = slots[slotIndex++ % slots.length]!;
  const r = await createBooking({
    draftKey: randomUUID(),
    startedAt: Date.now() - 60_000,
    address: { text: '101 Test Beach Dr W, Ocean Isle Beach, NC 28469', typed: true },
    relationship: 'owner',
    roof: { material: 'shingle', age: '15-20', reason: 'leak', notes: '' },
    slotId: slot.id,
    visit: { someoneHome: 'no', gateCode: '', pets: '' },
    contact: { name, mobile: `910555${++n}`, email: 'pat@example.com', smsConsent: true },
    source: { heardAbout: '', referralCode: '', utm: {}, viaAssistant: false },
  });
  if (!r.ok) throw new Error(r.message);
  return { id: r.booking.id, token: r.token, mobile: r.mobile };
}

/** The visit happened and the estimate went out. */
async function withEstimate(bookingId: string) {
  expect(await o.setStatus(justin, bookingId, 'done', false)).toEqual({ ok: true });
  expect(await p.saveEstimate(justin, bookingId, { amountCents: 1_200_000, send: true })).toEqual({ ok: true, sent: true });
}

const portalRows = (bookingId: string) =>
  asService((tx) => tx`select * from wb.messages where booking_id = ${bookingId} and channel = 'portal' order by created_at`);
const ownerAlerts = (bookingId: string) =>
  asService(
    (tx) => tx`select channel, to_addr, status, subject, body from wb.messages
               where booking_id = ${bookingId} and audience = 'owner' and kind = 'owner_portal_message' order by to_addr`,
  );
const tasks = (bookingId: string) => asService((tx) => tx`select *, to_char(due_on, 'YYYY-MM-DD') as due from wb.tasks where booking_id = ${bookingId}`);

describe('a message from the private page', () => {
  it('is saved as written, stops estimate follow-ups, makes a task to reply, and tells the owners', async () => {
    const b = await book();
    await withEstimate(b.id);
    await asService((tx) => tx`update wb.bookings set assigned_to = ${jt.userId} where id = ${b.id}`);
    push.loggedPushes.length = 0;

    const r = await sendPortalMessage(b.token, '  Is the driveway OK for the dumpster?\r\nWe park two cars there.  ');
    if (!r.ok) throw new Error(r.message);
    const words = 'Is the driveway OK for the dumpster?\nWe park two cars there.';

    // Saved: from the customer, to the team, never sent anywhere.
    const [m, ...more] = await portalRows(b.id);
    expect(more).toHaveLength(0);
    expect(m).toMatchObject({
      channel: 'portal',
      direction: 'in',
      audience: 'customer',
      kind: 'portal_message',
      to_addr: 'team',
      from_addr: b.mobile,
      body: words,
      provider: 'portal',
      status: 'received',
    });

    // The updated thread ends with it.
    expect(r.messages.at(-1)).toMatchObject({ id: m!.id, from: 'you', channels: ['portal'], text: words });

    // A person takes it from here: no more follow-up emails. Not a question about the estimate, so no second task.
    const [e] = await asService((tx) => tx`select followups_stopped_at, replied_at from wb.estimates where booking_id = ${b.id}`);
    expect(e!.followups_stopped_at).not.toBeNull();
    expect(e!.replied_at).toBeNull();

    // A task to reply, due today, for the visit's inspector.
    const t = (await tasks(b.id)).filter((x) => String(x.auto_key).startsWith('message:'));
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({
      auto_key: `message:${m!.id}`,
      title: "Reply to Pat Tester's message",
      due: local(new Date()).date,
      mobile: b.mobile,
      booking_id: b.id,
      assignee: jt.userId,
      status: 'open',
    });

    // An email to each owner who gets email alerts (logged in tests), and a ping on their phones.
    const alerts = await ownerAlerts(b.id);
    expect(alerts.map((a) => `${a.channel}:${a.to_addr}:${a.status}`)).toEqual(['email:jt@example.com:logged', 'email:justin@example.com:logged']);
    expect(alerts[0]!.subject).toBe('Message from Pat Tester: 101 Test Beach Dr W, Ocean Isle Beach, NC 28469');
    expect(alerts[0]!.body).toContain(words);
    expect(alerts[0]!.body).toContain('Follow-ups about their estimate have stopped.');
    expect(push.loggedPushes).toEqual([
      { endpoint: DEVICE, message: { title: 'Message from Pat Tester', body: words, url: `/app/#/booking/${b.id}`, tag: `message-${b.id}` } },
    ]);
  });

  it('with no estimate out, there is nothing to stop; the task goes to whoever looks after the customer', async () => {
    const b = await book('Robin Lane');
    await asService((tx) => tx`insert into wb.customer_profiles (mobile, assigned_to) values (${b.mobile}, ${justin.userId})`);
    const r = await sendPortalMessage(b.token, 'Can you come a little earlier?');
    expect(r.ok).toBe(true);
    const [t] = await tasks(b.id);
    expect(t).toMatchObject({ title: "Reply to Robin Lane's message", assignee: justin.userId });
    const alerts = await ownerAlerts(b.id);
    expect(alerts).toHaveLength(2);
    expect(alerts[0]!.body).not.toContain('Follow-ups');
  });

  it('keeps the first time follow-ups stopped', async () => {
    const b = await book();
    await withEstimate(b.id);
    const earlier = new Date(Date.now() - 3 * 86_400_000);
    await asService((tx) => tx`update wb.estimates set followups_stopped_at = ${earlier} where booking_id = ${b.id}`);
    await sendPortalMessage(b.token, 'One more question.');
    const [e] = await asService((tx) => tx`select followups_stopped_at from wb.estimates where booking_id = ${b.id}`);
    expect(new Date(e!.followups_stopped_at).getTime()).toBe(earlier.getTime());
  });

  it('the same words twice within a minute (a double tap) are one message, one task, one alert', async () => {
    const b = await book();
    await sendPortalMessage(b.token, 'Hello there');
    const again = await sendPortalMessage(b.token, 'Hello there');
    if (!again.ok) throw new Error(again.message);
    expect(await portalRows(b.id)).toHaveLength(1);
    expect(again.messages.filter((m) => m.from === 'you')).toHaveLength(1);
    expect(await tasks(b.id)).toHaveLength(1);
    expect(await ownerAlerts(b.id)).toHaveLength(2);
    expect(push.loggedPushes).toHaveLength(1);
    // Different words are a new message.
    await sendPortalMessage(b.token, 'And one more thing');
    expect(await portalRows(b.id)).toHaveLength(2);
    expect(await tasks(b.id)).toHaveLength(2);
  });

  it('checks the words and the link before saving anything', async () => {
    const b = await book();
    expect(await sendPortalMessage(b.token, '')).toMatchObject({ ok: false, status: 400, message: 'Type your message first.' });
    expect(await sendPortalMessage(b.token, ' \n\t ')).toMatchObject({ ok: false, status: 400 });
    expect(await sendPortalMessage(b.token, 42)).toMatchObject({ ok: false, status: 400 });
    expect(await sendPortalMessage(b.token, 'x'.repeat(1001))).toMatchObject({ ok: false, status: 400, error: 'too_long' });
    expect(await sendPortalMessage('not-a-token', 'Hello')).toMatchObject({ ok: false, status: 404 });
    expect(await sendPortalMessage('a'.repeat(43), 'Hello')).toMatchObject({ ok: false, status: 404 });
    expect(await portalRows(b.id)).toHaveLength(0);
    expect(await tasks(b.id)).toHaveLength(0);
    expect(await sendPortalMessage(b.token, 'x'.repeat(1000))).toMatchObject({ ok: true });
  });

  it('through /api/manage: the action answers with the thread; a bad message never counts against the limit', async () => {
    const { POST } = await import('../../src/pages/api/manage');
    const b = await book();
    const call = async (payload: object) => {
      const request = new Request('http://localhost/api/manage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const res = await POST({ request, clientAddress: '203.0.113.7' } as never);
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    const ok = await call({ action: 'message', token: b.token, body: 'Is Tuesday still on?' });
    expect(ok.status).toBe(200);
    expect((ok.body.messages as { text: string }[]).at(-1)!.text).toBe('Is Tuesday still on?');
    expect(await call({ action: 'message', token: b.token, body: '' })).toMatchObject({ status: 400, body: { error: 'empty' } });
    expect(await call({ action: 'message', token: 'short', body: 'Hi' })).toMatchObject({ status: 404 });
    // The page itself: everything at once, and never the booking's id.
    const page = await call({ action: 'get', token: b.token });
    expect(page.status).toBe(200);
    const view = page.body.booking as Record<string, unknown>;
    expect(view.id).toBeUndefined();
    expect(view).toMatchObject({ status: 'booked', photos: [] });
    expect((view.messages as { text: string }[]).map((m) => m.text)).toContain('Is Tuesday still on?');
  });

  it('is limited to 10 an hour from one place, except in tests', async () => {
    for (let i = 0; i < 12; i++) expect(await rateOk('portal_message', '198.51.100.4', 10, 3600)).toBe(true);
    process.env.APP_ENV = 'development';
    try {
      const results: boolean[] = [];
      for (let i = 0; i < 11; i++) results.push(await rateOk('portal_message', '198.51.100.5', 10, 3600));
      expect(results.slice(0, 10).every(Boolean)).toBe(true);
      expect(results[10]).toBe(false);
      // Another address has its own count.
      expect(await rateOk('portal_message', '198.51.100.6', 10, 3600)).toBe(true);
    } finally {
      process.env.APP_ENV = 'test';
    }
  });
});

describe('what a customer can see', () => {
  const msg = (bookingId: string, fields: Record<string, unknown>) =>
    asService(
      (tx) => tx`insert into wb.messages ${tx({
        booking_id: bookingId,
        channel: 'email',
        direction: 'out',
        audience: 'customer',
        kind: 'test',
        to_addr: 'x',
        body: 'body',
        provider: 'log',
        status: 'logged',
        ...fields,
      })}`,
    );

  it('their messages, both ways, and never the owners\' alerts or another booking\'s', async () => {
    const a = await book();
    const other = await book('Someone Else');
    await asService((tx) => tx`delete from wb.messages`);
    const t0 = Date.now() - 3 * 3_600_000;
    const at = (minutes: number) => new Date(t0 + minutes * 60_000);

    // An email and a text sent together about the same thing: one item, with the text's words.
    await msg(a.id, { kind: 'estimate_ready', subject: 'Your estimate is ready', created_at: at(0) });
    await msg(a.id, { kind: 'estimate_ready', channel: 'sms', body: `${facts.business.name}: your estimate is ready. See it and let us know what you'd like to do: https://example.com/b/#x`, created_at: at(0) });
    // Owners only.
    await msg(a.id, { kind: 'owner_new', audience: 'owner', subject: 'New inspection: owners only', body: 'GATE CODE 1234', created_at: at(1) });
    await msg(a.id, { kind: 'forward', audience: 'owner', channel: 'sms', body: 'Text from Pat: owners only', created_at: at(2) });
    // Never reached them.
    await msg(a.id, { kind: 'job_moved', subject: 'This one failed', status: 'failed', created_at: at(3) });
    // What they sent: a text to our number, and a message from the page.
    await msg(a.id, { kind: 'inbound', channel: 'sms', direction: 'in', provider: 'twilio', status: 'received', body: 'Running late, sorry', created_at: at(4) });
    await msg(a.id, { kind: 'portal_message', channel: 'portal', direction: 'in', provider: 'portal', status: 'received', to_addr: 'team', body: 'See you then', created_at: at(5) });
    // A question asked with the estimate's buttons.
    await asService(
      (tx) => tx`insert into wb.booking_events (booking_id, at, actor, kind, detail)
                 values (${a.id}, ${at(6)}, 'customer', 'estimate_question', ${tx.json({ note: 'Does it include gutters?' })})`,
    );
    // Someone else's.
    await msg(other.id, { kind: 'confirmation', subject: 'Not yours', created_at: at(1) });
    await msg(other.id, { kind: 'portal_message', channel: 'portal', direction: 'in', provider: 'portal', status: 'received', body: 'Also not yours', created_at: at(2) });

    const thread = await customerThread(a.id);
    expect(thread.map((m) => [m.from, m.channels.join('+'), m.text])).toEqual([
      ['us', 'email+sms', 'Your estimate is ready.'],
      ['you', 'sms', 'Running late, sorry'],
      ['you', 'portal', 'See you then'],
      ['you', 'estimate', 'Does it include gutters?'],
    ]);
    const all = JSON.stringify(thread);
    for (const hidden of ['owners only', 'GATE CODE', 'This one failed', 'Not yours', 'Also not yours']) expect(all).not.toContain(hidden);

    // The same through the private link.
    const found = await getByToken(a.token);
    if (!found.ok) throw new Error('not found');
    expect((await portalView(found.booking)).messages).toEqual(thread);
  });

  it("their photos and the team's shared ones, newest first, with captions and short-lived links; never one nobody shared, or another booking's", async () => {
    const a = await book();
    const other = await book('Someone Else');
    const t0 = Date.now() - 86_400_000;
    const photo = (bookingId: string, path: string, fields: Record<string, unknown>, minutes: number) =>
      asService(
        (tx) => tx`insert into wb.booking_photos ${tx({
          booking_id: bookingId,
          draft_key: randomUUID(),
          path,
          content_type: 'image/jpeg',
          bytes: 1000,
          created_at: new Date(t0 + minutes * 60_000),
          ...fields,
        })}`,
      );
    await photo(a.id, 'uploads/aaaaaaaa-0000-4000-8000-000000000001.jpg', {}, 0);
    await photo(a.id, 'team/aaaaaaaa-0000-4000-8000-000000000002.jpg', { source: 'team', shared: true, caption: 'Ridge vent, north side' }, 10);
    await photo(a.id, 'team/aaaaaaaa-0000-4000-8000-000000000003.jpg', { source: 'team', shared: false, caption: 'Not for the customer' }, 20);
    await photo(other.id, 'team/aaaaaaaa-0000-4000-8000-000000000004.jpg', { source: 'team', shared: true, caption: 'Another home' }, 30);

    const photos = await customerPhotos(a.id);
    expect(photos.map((ph) => [ph.source, ph.caption])).toEqual([
      ['team', 'Ridge vent, north side'],
      ['customer', ''],
    ]);
    // Signed links to storage (a local folder in tests), one per photo.
    for (const ph of photos) {
      const u = new URL(ph.url, 'http://localhost');
      expect(u.pathname).toBe('/api/photos/local');
      expect(checkLocalSignature('get', u.searchParams.get('path')!, u.searchParams.get('sig')!)).toBe(true);
    }
    expect(JSON.stringify(photos)).not.toMatch(/Not for the customer|Another home|000000000003|000000000004/);
  });

  it('the page has the day they booked, and no booking id', async () => {
    const a = await book();
    const found = await getByToken(a.token);
    if (!found.ok) throw new Error('not found');
    const view = await portalView(found.booking);
    expect(view).not.toHaveProperty('id');
    const [row] = await asService((tx) => tx`select created_at from wb.bookings where id = ${a.id}`);
    expect(view.bookedAt).toBe(new Date(row!.created_at).toISOString());
    expect(view.messages).toEqual([]);
    // The confirmation goes out by email and text together (and the owners hear): one item, the customer's.
    await bookingCreated(found.booking, 'https://example.com/b/#x');
    const after = await portalView(found.booking);
    expect(after.messages.map((m) => [m.from, m.channels.join('+')])).toEqual([['us', 'email+sms']]);
    expect(after.messages[0]!.text).toMatch(/^You're booked for /);
  });
});
