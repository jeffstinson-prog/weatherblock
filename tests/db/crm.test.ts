// The owner portal's server side: customers and where they stand, tasks that make
// and close themselves, notes, emails, new leads, the schedule, the team and reports.
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Owner } from '../../src/server/auth';
import { createBooking, openSlots } from '../../src/server/booking';
import * as crm from '../../src/server/crm';
import { asService, closeDatabase, db, useDatabase } from '../../src/server/db';
import * as o from '../../src/server/owner';
import * as p from '../../src/server/pipeline';
import * as sched from '../../src/server/schedule';
import * as t from '../../src/server/tasks';
import * as team from '../../src/server/team';

const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/wb_test';
let justin: Owner;
let jt: Owner;

beforeAll(async () => {
  process.env.APP_ENV = 'test';
  execFileSync('bash', ['scripts/db-local.sh'], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  useDatabase(url);
  for (const [name, email] of [
    ['Justin Coffey', 'justin@example.com'],
    ['JT Stinson', 'jt@example.com'],
  ] as const) {
    const id = randomUUID();
    await db()`insert into auth.users (id, email) values (${id}, ${email})`;
    await asService((tx) => tx`insert into wb.owners (user_id, name, email) values (${id}, ${name}, ${email})`);
    if (name === 'Justin Coffey') justin = { userId: id, email };
    else jt = { userId: id, email };
  }
});
afterAll(() => closeDatabase());
beforeEach(async () => {
  await asService(async (tx) => {
    await tx`delete from wb.tasks`;
    await tx`delete from wb.customer_notes`;
    await tx`delete from wb.customer_profiles`;
    await tx`delete from wb.messages`;
    await tx`delete from wb.estimate_requests`;
    await tx`delete from wb.booking_events`;
    await tx`delete from wb.bookings`;
    await tx`update wb.crews set jobs_per_day = 1, active = true`;
  });
});

let n = 9100;
const nextMobile = () => `+1910555${++n}`;

async function request(name = 'Robert Hayes', mobile = nextMobile()) {
  const [r] = await asService(
    (tx) => tx`insert into wb.estimate_requests (ref, name, mobile, address, lead_source, token_hash, idempotency_key)
               values (${crm.newRef()}, ${name}, ${mobile}, '77 Cedar Ln, Supply, NC 28462', 'google_cpc', ${randomBytes(32)}, ${randomUUID()})
               returning id, mobile`,
  );
  return { id: r!.id as string, mobile: r!.mobile as string };
}

async function book(mobile = nextMobile(), name = 'Dana Whitley', skip = 0) {
  const slot = (await openSlots()).filter((s) => Date.parse(s.startsAt) > Date.now() + 2 * 86_400_000)[skip]!;
  const r = await createBooking({
    draftKey: randomUUID(),
    startedAt: Date.now() - 60_000,
    address: { text: '12 Ocean Blvd W, Holden Beach, NC 28462', typed: true },
    relationship: 'owner',
    roof: { material: 'shingle', age: '15-20', reason: 'storm', notes: '' },
    slotId: slot.id,
    visit: { someoneHome: 'no', gateCode: '', pets: '' },
    contact: { name, mobile: mobile.slice(2), email: 'dana@example.com', smsConsent: false },
    source: { heardAbout: '', referralCode: '', utm: { source: 'google', medium: 'gbp' }, viaAssistant: false },
  });
  if (!r.ok) throw new Error(r.message);
  return { ...r, mobile: r.mobile, slot };
}

const tasksFor = (mobile: string) => asService((tx) => tx`select title, status, auto_key from wb.tasks where mobile = ${mobile} order by created_at`);
const stage = async (mobile: string) => (await crm.customers(justin)).customers.find((c) => c.mobile === mobile)?.stage;

describe('tasks that make and close themselves', () => {
  it('a new request: call them back today; marking it called closes the task', async () => {
    const r = await request();
    expect(await tasksFor(r.mobile)).toEqual([{ title: 'Call Robert Hayes back', status: 'open', auto_key: `call:${r.id}` }]);
    await asService((tx) => tx`update wb.estimate_requests set status = 'called', called_at = now() where id = ${r.id}`);
    expect((await tasksFor(r.mobile))[0]!.status).toBe('done');
  });

  it('the whole job: write the estimate, schedule the job, close it out, each closing as the work is done', async () => {
    const b = await book();
    await o.setStatus(justin, b.booking.id, 'done', false);
    expect((await tasksFor(b.mobile)).map((x) => `${x.title}:${x.status}`)).toEqual(['Write the estimate for Dana Whitley:open']);

    expect(await p.saveEstimate(justin, b.booking.id, { amountCents: 1_240_000, send: true })).toMatchObject({ ok: true, sent: true });
    expect((await tasksFor(b.mobile))[0]!.status).toBe('done');
    expect(await stage(b.mobile)).toBe('estimate_sent');

    expect(await p.customerAnswer(b.token, 'accept', '')).toMatchObject({ ok: true });
    expect((await tasksFor(b.mobile)).map((x) => `${x.title}:${x.status}`)).toContain("Schedule Dana Whitley's roof job:open");
    expect(await stage(b.mobile)).toBe('won');

    const crew = (await p.listCrews(justin))[0]!;
    const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    expect(await p.scheduleJob(justin, b.booking.id, { crewId: crew.id, day })).toMatchObject({ ok: true });
    expect((await tasksFor(b.mobile)).find((x) => x.title.startsWith('Schedule'))!.status).toBe('done');
    expect(await stage(b.mobile)).toBe('scheduled');

    expect(await p.setJobStatus(justin, b.booking.id, 'done')).toMatchObject({ ok: true });
    expect((await tasksFor(b.mobile)).map((x) => x.title)).toContain("Close out Dana Whitley's job: final walk-through, photos and payment");
    expect(await stage(b.mobile)).toBe('done');
  });

  it('a question on the estimate makes a task to answer it', async () => {
    const b = await book();
    await o.setStatus(justin, b.booking.id, 'done', false);
    await p.saveEstimate(justin, b.booking.id, { amountCents: 900_000, send: true });
    expect(await p.customerAnswer(b.token, 'question', 'Does it include gutters?')).toMatchObject({ ok: true });
    expect((await tasksFor(b.mobile)).map((x) => x.title)).toContain("Answer Dana Whitley's question about the estimate");
  });

  it('a cancelled visit takes its open tasks with it', async () => {
    const b = await book();
    await o.setStatus(justin, b.booking.id, 'done', false);
    await o.setStatus(justin, b.booking.id, 'cancelled', false);
    expect((await tasksFor(b.mobile)).every((x) => x.status === 'done')).toBe(true);
  });
});

describe('customers', () => {
  it('one record per mobile number, with the furthest stage, the latest name and the request and visit together', async () => {
    const mobile = nextMobile();
    await request('Robert Hayes', mobile);
    expect(await stage(mobile)).toBe('new');
    await book(mobile, 'Robert Hayes');
    const list = (await crm.customers(justin)).customers.filter((c) => c.mobile === mobile);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Robert Hayes', stage: 'booked', stageLabel: 'Inspection booked', town: 'Holden Beach', openTasks: 1 });
    expect(list[0]!.nextVisit).not.toBeNull();
  });

  it('assignment, tags and lost, with lost closing the system tasks', async () => {
    const r = await request();
    expect(await crm.saveProfile(justin, r.mobile, { assignedTo: jt.userId, tags: ['Storm 11/26', ' Insurance '] })).toEqual({ ok: true });
    let c = (await crm.customers(justin)).customers.find((x) => x.mobile === r.mobile)!;
    expect(c).toMatchObject({ assignedTo: jt.userId, assignedName: 'JT Stinson', tags: ['Storm 11/26', 'Insurance'] });
    expect(await crm.saveProfile(justin, r.mobile, { lost: true, lostReason: 'Went with another roofer' })).toEqual({ ok: true });
    c = (await crm.customers(justin)).customers.find((x) => x.mobile === r.mobile)!;
    expect(c).toMatchObject({ stage: 'lost', lostReason: 'Went with another roofer', openTasks: 0 });
    expect(await crm.saveProfile(justin, r.mobile, { assignedTo: 'not-a-uuid' })).toMatchObject({ ok: false, status: 400 });
  });

  it('one customer: the timeline in order, notes, the next step, and never the owners\' own alerts', async () => {
    const mobile = nextMobile();
    const r = await request('Robert Hayes', mobile);
    const b = await book(mobile, 'Robert Hayes');
    await crm.addNote(jt, mobile, 'Wants it done before Christmas.');
    await asService(
      (tx) => tx`insert into wb.messages (booking_id, channel, direction, audience, kind, to_addr, body, provider, status)
                 values (${b.booking.id}, 'email', 'out', 'owner', 'owner_new', 'justin@example.com', 'Owner alert', 'log', 'logged')`,
    );
    const c = await crm.customer(justin, mobile.slice(1));
    expect(c).not.toBeNull();
    expect(c!.next.text).toMatch(/^Inspection /);
    expect(c!.requests.map((x) => x.id)).toEqual([r.id]);
    expect(c!.visits.map((x) => x.id)).toEqual([b.booking.id]);
    const kinds = c!.timeline.map((e) => e.kind);
    expect(kinds).toContain('request');
    expect(kinds).toContain('visit');
    expect(c!.timeline.find((e) => e.kind === 'note')).toMatchObject({ text: 'Wants it done before Christmas.', by: 'JT Stinson' });
    expect(c!.timeline.some((e) => e.text.includes('Owner alert'))).toBe(false);
    const times = c!.timeline.map((e) => e.at);
    expect([...times].sort().reverse()).toEqual(times);
    expect(await crm.customer(justin, '9105550000')).toBeNull();
  });

  it('emails the customer from the app, and says so plainly when there is no email', async () => {
    const r = await request();
    expect(await crm.emailCustomer(justin, r.mobile, { subject: 'Your estimate', body: 'Hi Robert,\n\nWe can come Tuesday.' })).toMatchObject({ ok: false, status: 409 });
    const b = await book();
    expect(await crm.emailCustomer(justin, b.mobile, { subject: 'Before Tuesday', body: 'Please move the cars.' })).toMatchObject({ ok: true });
    const [m] = await asService((tx) => tx`select audience, kind, to_addr, subject, body from wb.messages where kind = 'owner_message'`);
    expect(m).toMatchObject({ audience: 'customer', to_addr: 'dana@example.com', subject: 'Before Tuesday' });
    expect(m!.body).toContain('Please move the cars.');
    expect(m!.body).toContain('Justin Coffey');
  });

  it('a lead from a phone call: a request, a call-back task and the note', async () => {
    const res = await crm.createLead(justin, { name: 'Sam Caller', mobile: '(910) 555-7788', address: '9 Main St, Shallotte, NC 28470', note: 'Leak over the garage' });
    expect(res).toMatchObject({ ok: true, mobile: '+19105557788' });
    expect((await tasksFor('+19105557788')).map((x) => x.title)).toEqual(['Call Sam Caller back']);
    const c = await crm.customer(justin, '+19105557788');
    expect(c!.source).toBe('phone_call');
    expect(c!.timeline.some((e) => e.kind === 'note' && e.text === 'Leak over the garage')).toBe(true);
    expect(await crm.createLead(justin, { name: 'X', mobile: '555', address: '9 Main St' })).toMatchObject({ ok: false, status: 400 });
  });
});

describe('tasks by hand', () => {
  it('create, assign, finish, reopen and delete', async () => {
    const r = await request();
    const made = await t.createTask(justin, { title: 'Order shingles', dueOn: '2026-12-01', assignee: jt.userId, mobile: r.mobile });
    expect(made).toMatchObject({ ok: true });
    const id = (made as { id: string }).id;
    let open = await t.listTasks(justin, 'open');
    expect(open.tasks.find((x) => x.id === id)).toMatchObject({ title: 'Order shingles', dueOn: '2026-12-01', assigneeName: 'JT Stinson', customerName: 'Robert Hayes', auto: false });
    expect(open.owners.map((x) => x.name)).toEqual(['Justin Coffey', 'JT Stinson']);
    expect(await t.updateTask(jt, id, { status: 'done' })).toEqual({ ok: true });
    const done = await t.listTasks(justin, 'done');
    expect(done.tasks.find((x) => x.id === id)).toMatchObject({ status: 'done', doneByName: 'JT Stinson' });
    expect(await t.updateTask(justin, id, { status: 'open', dueOn: null })).toEqual({ ok: true });
    open = await t.listTasks(justin, 'open');
    expect(open.tasks.find((x) => x.id === id)).toMatchObject({ status: 'open', dueOn: null });
    expect(await t.deleteTask(justin, id)).toEqual({ ok: true });
    expect(await t.updateTask(justin, id, { title: 'x' })).toMatchObject({ ok: false, status: 404 });
    expect(await t.createTask(justin, { title: ' ' })).toMatchObject({ ok: false, status: 400 });
  });
});

describe('the schedule, the team and the numbers', () => {
  it('assigns the inspector and shows the week with jobs and crews', async () => {
    const b = await book();
    expect(await sched.assignInspector(justin, b.booking.id, justin.userId)).toEqual({ ok: true });
    const from = new Date(b.slot.startsAt).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const s = await sched.schedule(justin, from, 7);
    expect(s.visits.find((v) => v.id === b.booking.id)).toMatchObject({ assignedTo: justin.userId, name: 'Dana Whitley' });
    expect(s.crews.length).toBeGreaterThan(0);
    expect(s.owners.map((x) => x.name)).toEqual(['Justin Coffey', 'JT Stinson']);
    expect(await sched.assignInspector(justin, b.booking.id, 'nope')).toMatchObject({ ok: false, status: 400 });
    const tm = await team.team(justin);
    expect(tm.people.find((x) => x.name === 'Justin Coffey')).toMatchObject({ visitsThisWeek: expect.any(Number) });
    expect(tm.crews[0]).toMatchObject({ color: expect.any(String), leadName: '' });
  });

  it('crews keep a lead and a phone', async () => {
    const crews = await p.listCrews(justin);
    const input = crews.map((c, i) => ({ ...c, leadName: i === 0 ? 'Marco' : '', leadMobile: i === 0 ? '910 555 3434' : '' }));
    expect(await p.saveCrews(justin, input)).toEqual({ ok: true });
    expect((await p.listCrews(justin))[0]).toMatchObject({ leadName: 'Marco', leadMobile: '+19105553434' });
    expect(await p.saveCrews(justin, [{ ...input[0]!, leadMobile: '555' }])).toMatchObject({ ok: false, status: 400 });
  });

  it('reports count how far each lead got, by where they came from', async () => {
    await request();
    const b = await book();
    await o.setStatus(justin, b.booking.id, 'done', false);
    await p.saveEstimate(justin, b.booking.id, { amountCents: 1_000_000, send: true });
    await p.customerAnswer(b.token, 'accept', '');
    const r = await team.reports(justin, 90);
    expect(r.funnel.map((f) => f.n)).toEqual([2, 1, 1, 1, 1]);
    expect(r.sources.find((s) => s.source === 'google_gbp')).toMatchObject({ leads: 1, booked: 1, won: 1, wonCents: 1_000_000 });
    expect(r.sources.find((s) => s.source === 'google_cpc')).toMatchObject({ leads: 1, booked: 0, won: 0 });
    expect(r.wonByMonth.at(-1)).toMatchObject({ count: 1, cents: 1_000_000 });
  });
});
