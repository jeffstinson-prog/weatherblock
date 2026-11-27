// The owner portal's customers: everyone who asked for an estimate or booked a
// visit, one record per mobile number. Where each one stands, who owns them,
// their tasks and notes, and everything that happened, newest first.
import { z } from 'zod';
import { money, shortDay, townOf, whenLabel, windowLabel } from '../booking/format';
import { formatMobile, normalizeMobile } from '../booking/rules';
import { STAGES, STAGE_LABEL, type Stage } from '../booking/stages';
import { MANUAL_SOURCES, sourceLabel } from '../booking/sources';
import { facts } from '../facts';
import type { Owner } from './auth';
import { tellAssignee } from './handoff';
import { asOwner } from './db';
import { config } from './env';
import { send } from './messaging/send';
import { escape, layout } from './messaging/templates';
import { randomBytes, randomUUID } from 'node:crypto';

export type Result<T = object> = ({ ok: true } & T) | { ok: false; status: number; message: string };
const fail = (status: number, message: string) => ({ ok: false as const, status, message });

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** A request reference like the website's: 6 characters, no I, L, O or U. */
export function newRef(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  return [...randomBytes(6)].map((b) => alphabet[b % 32]).join('');
}
const MOBILE = /^\+1[2-9]\d{9}$/;

// ---------- Stages ----------

export { STAGES, STAGE_LABEL, type Stage };

interface Req {
  id: string;
  mobile: string;
  name: string;
  email: string | null;
  address: string;
  status: string;
  created_at: Date;
  called_at: Date | null;
  closed_at: Date | null;
  close_reason: string | null;
  lead_source: string;
}

interface Visit {
  id: string;
  ref: string;
  mobile: string;
  name: string;
  email: string | null;
  address: string;
  status: string;
  starts_at: Date;
  ends_at: Date;
  created_at: Date;
  assigned_to: string | null;
  lead_source: string;
  reason: string;
  est_status: string | null;
  est_amount: number | null;
  est_sent_at: Date | null;
  est_viewed_at: Date | null;
  est_decided_at: Date | null;
  est_replied_at: Date | null;
  est_note: string | null;
  job_status: string | null;
  job_day: string | null;
  job_done_at: Date | null;
  crew_id: string | null;
  crew_name: string | null;
}

const newest = <T extends { created_at: Date }>(list: T[]) =>
  list.reduce<T | null>((a, b) => (!a || +b.created_at > +a.created_at ? b : a), null);

/** Where a customer stands, from what actually happened. Only "lost" is ever set by hand. */
export function stageOf(reqs: Pick<Req, 'status' | 'created_at'>[], visits: Omit<Partial<Visit>, 'created_at'> & Pick<Visit, 'created_at'>[] | Visit[], lost: boolean): Stage {
  if (lost) return 'lost';
  const all = visits as Visit[];
  const v = newest(all.filter((b) => b.status !== 'cancelled'));
  if (v) {
    if (v.job_status === 'done') return 'done';
    if (v.job_status === 'scheduled') return 'scheduled';
    if (v.job_status === 'to_schedule' || v.est_status === 'accepted') return 'won';
    if (v.est_status === 'declined' || v.est_status === 'withdrawn') return 'lost';
    if (v.est_status === 'sent') return 'estimate_sent';
    if (v.status === 'done') return 'inspected';
    if (v.status === 'no_show') return 'contacted';
    return 'booked';
  }
  const r = newest(reqs as Req[]);
  if (r) {
    if (r.status === 'new') return 'new';
    if (r.status === 'called' || r.status === 'booked') return 'contacted';
    return 'lost';
  }
  return all.length ? 'lost' : 'new';
}

// ---------- Reading it all ----------

async function load(owner: Owner, mobile?: string) {
  return asOwner(owner.userId, async (tx) => {
    const only = mobile ? tx`where mobile = ${mobile}` : tx``;
    const reqs = (await tx`
      select id, mobile, name, email, address, status, created_at, called_at, closed_at, close_reason, lead_source
      from wb.estimate_requests ${only}`) as unknown as Req[];
    const visits = (await tx`
      select l.id, l.ref, l.mobile, l.name, l.email, l.address, l.status, l.starts_at, l.ends_at, l.created_at, b.assigned_to,
             l.lead_source, l.reason,
             e.status as est_status, e.amount_cents as est_amount, e.sent_at as est_sent_at, e.viewed_at as est_viewed_at,
             e.decided_at as est_decided_at, e.replied_at as est_replied_at, e.customer_note as est_note,
             j.status as job_status, to_char(j.day, 'YYYY-MM-DD') as job_day, j.done_at as job_done_at, j.crew_id, c.name as crew_name
      from wb.booking_list l join wb.bookings b on b.id = l.id
      left join wb.estimates e on e.booking_id = l.id
      left join wb.jobs j on j.booking_id = l.id
      left join wb.crews c on c.id = j.crew_id
      ${mobile ? tx`where l.mobile = ${mobile}` : tx``}`) as unknown as Visit[];
    const profiles = await tx`select * from wb.customer_profiles ${only}`;
    const openTasks = await tx`
      select mobile, count(*)::int as n from wb.tasks where status = 'open' and mobile is not null
      ${mobile ? tx`and mobile = ${mobile}` : tx``} group by mobile`;
    const owners = await tx`select user_id, name from wb.owners order by created_at`;
    return { reqs, visits, profiles, openTasks, owners };
  });
}

function summarize(mobile: string, reqs: Req[], visits: Visit[], profile: Record<string, unknown> | undefined, openTasks: number, ownerName: Map<string, string>) {
  const latest = newest<{ created_at: Date; name: string; email: string | null; address: string; lead_source: string }>([...reqs, ...visits]);
  const email = [...visits, ...reqs].sort((a, b) => +b.created_at - +a.created_at).find((x) => x.email)?.email ?? '';
  const lost = Boolean(profile?.lost);
  const stage = stageOf(reqs, visits, lost);
  const times = [
    ...reqs.flatMap((r) => [r.created_at, r.called_at, r.closed_at]),
    ...visits.flatMap((v) => [v.created_at, v.est_sent_at, v.est_viewed_at, v.est_decided_at, v.est_replied_at, v.job_done_at]),
  ].filter(Boolean) as Date[];
  const lastAt = times.length ? new Date(Math.max(...times.map((t) => +t))) : null;
  const priced = visits.filter((v) => v.est_amount && v.est_status && ['sent', 'accepted'].includes(v.est_status));
  const next = visits
    .filter((v) => v.status === 'booked' && +v.ends_at > Date.now())
    .sort((a, b) => +a.starts_at - +b.starts_at)[0];
  const assignedTo = (profile?.assigned_to as string | null) ?? null;
  return {
    mobile,
    name: latest?.name ?? '',
    email,
    address: latest?.address ?? '',
    town: latest ? townOf(latest.address) : '',
    source: latest?.lead_source ?? '',
    stage,
    stageLabel: STAGE_LABEL[stage],
    lastAt: iso(lastAt),
    valueCents: priced.reduce((n, v) => Math.max(n, v.est_amount ?? 0), 0),
    assignedTo,
    assignedName: assignedTo ? (ownerName.get(assignedTo) ?? '') : '',
    tags: ((profile?.tags as string[] | undefined) ?? []).slice(0, 10),
    lostReason: (profile?.lost_reason as string | null) ?? '',
    openTasks,
    nextVisit: next ? { id: next.id, startsAt: iso(next.starts_at)!, endsAt: iso(next.ends_at)! } : null,
    requestId: newest(reqs)?.id ?? null,
    bookingId: newest(visits)?.id ?? null,
  };
}

export type CustomerRow = ReturnType<typeof summarize>;

/** Everyone, most recent activity first. */
export async function customers(owner: Owner): Promise<{ customers: CustomerRow[]; owners: { id: string; name: string }[] }> {
  const d = await load(owner);
  const ownerName = new Map(d.owners.map((o) => [o.user_id as string, o.name as string]));
  const mobiles = new Set([...d.reqs.map((r) => r.mobile), ...d.visits.map((v) => v.mobile)]);
  const rows = [...mobiles].map((m) =>
    summarize(
      m,
      d.reqs.filter((r) => r.mobile === m),
      d.visits.filter((v) => v.mobile === m),
      d.profiles.find((p) => p.mobile === m),
      Number(d.openTasks.find((t) => t.mobile === m)?.n ?? 0),
      ownerName,
    ),
  );
  rows.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
  return { customers: rows, owners: d.owners.map((o) => ({ id: o.user_id as string, name: o.name as string })) };
}

// ---------- One customer ----------

export interface TimelineEvent {
  at: string;
  kind: 'request' | 'call' | 'visit' | 'estimate' | 'job' | 'message_in' | 'message_out' | 'note' | 'task' | 'closed';
  text: string;
  by?: string;
  href?: string;
}

function nextStep(stage: Stage, c: CustomerRow, visits: Visit[]): { text: string; href?: string } {
  const v = newest(visits.filter((x) => x.status !== 'cancelled'));
  switch (stage) {
    case 'new':
      return { text: `Call ${c.name.split(' ')[0]} back, then mark it called or book a time.`, href: c.requestId ? `#/request/${c.requestId}` : undefined };
    case 'contacted':
      return { text: 'Book the inspection while you have them, or send them the booking link.', href: c.requestId ? `#/request/${c.requestId}` : undefined };
    case 'booked':
      return c.nextVisit
        ? { text: `Inspection ${whenLabel(c.nextVisit.startsAt, c.nextVisit.endsAt)}.`, href: `#/booking/${c.nextVisit.id}` }
        : { text: 'Mark the visit done once you have been out.', href: v ? `#/booking/${v.id}` : undefined };
    case 'inspected':
      return { text: 'Write the estimate and send it.', href: v ? `#/booking/${v.id}` : undefined };
    case 'estimate_sent':
      return { text: v?.est_viewed_at ? 'They opened the estimate. A call now helps them decide.' : "They haven't opened the estimate yet. Check they got it.", href: v ? `#/booking/${v.id}` : undefined };
    case 'won':
      return { text: 'They said yes. Put the job on a crew\'s day.', href: v ? `#/booking/${v.id}` : undefined };
    case 'scheduled':
      return { text: v?.job_day ? `Roof job ${shortDay(`${v.job_day}T12:00:00Z`)}${v.crew_name ? ` with ${v.crew_name}` : ''}.` : 'Roof job scheduled.', href: v ? `#/booking/${v.id}` : undefined };
    case 'done':
      return { text: 'Job done. Close out: final walk-through, photos and payment.' };
    case 'lost':
      return { text: c.lostReason ? `Marked lost: ${c.lostReason}.` : 'Not moving ahead right now.' };
  }
}

export async function customer(owner: Owner, mobileInput: string) {
  const mobile = normalizeMobile(mobileInput);
  if (!mobile || !MOBILE.test(mobile)) return null;
  const d = await load(owner, mobile);
  if (d.reqs.length === 0 && d.visits.length === 0) return null;
  const ownerName = new Map(d.owners.map((o) => [o.user_id as string, o.name as string]));
  const c = summarize(mobile, d.reqs, d.visits, d.profiles[0], Number(d.openTasks[0]?.n ?? 0), ownerName);
  const bookingIds = d.visits.map((v) => v.id);
  const requestIds = d.reqs.map((r) => r.id);

  const extra = await asOwner(owner.userId, async (tx) => {
    const notes = await tx`select id, author, body, created_at from wb.customer_notes where mobile = ${mobile} order by created_at desc limit 200`;
    const tasks = await tx`
      select id, title, notes, to_char(due_on, 'YYYY-MM-DD') as due_on, assignee, status, auto_key, created_at, done_at, done_by
      from wb.tasks where mobile = ${mobile} order by (status = 'open') desc, due_on nulls last, created_at desc limit 100`;
    const messages = await tx`
      select id, booking_id, request_id, channel, direction, kind, subject, body, status, created_at from wb.messages
      where audience = 'customer'
        and (booking_id = any(${bookingIds}::uuid[]) or request_id = any(${requestIds}::uuid[])
             or (direction = 'in' and from_addr = ${mobile}))
      order by created_at desc limit 300`;
    const events = await tx`
      select booking_id, at, actor, kind, detail from wb.booking_events
      where booking_id = any(${bookingIds}::uuid[]) order by at desc limit 300`;
    return { notes, tasks, messages, events };
  });

  const who = (id: unknown) => (id ? (ownerName.get(id as string) ?? '') : '');
  const timeline: TimelineEvent[] = [];
  const add = (at: unknown, kind: TimelineEvent['kind'], text: string, extraFields: Partial<TimelineEvent> = {}) => {
    const when = iso(at);
    if (when) timeline.push({ at: when, kind, text, ...extraFields });
  };
  for (const r of d.reqs) {
    const manual = (MANUAL_SOURCES as readonly string[]).includes(r.lead_source);
    add(
      r.created_at,
      'request',
      manual
        ? `Added as a lead by the team (${sourceLabel(r.lead_source).toLowerCase()}).`
        : `Asked for an estimate on the website${r.lead_source && r.lead_source !== 'direct' ? ` (from ${sourceLabel(r.lead_source)})` : ''}.`,
      { href: `#/request/${r.id}` },
    );
    if (r.called_at) add(r.called_at, 'call', 'Marked called.', { href: `#/request/${r.id}` });
    if (r.closed_at) add(r.closed_at, 'closed', `Request closed${r.close_reason ? `: ${r.close_reason}` : ''}.`);
  }
  for (const v of d.visits) {
    add(v.created_at, 'visit', `Inspection booked for ${whenLabel(iso(v.starts_at)!, iso(v.ends_at)!)}.`, { href: `#/booking/${v.id}` });
    if (v.est_sent_at) add(v.est_sent_at, 'estimate', `Estimate sent${v.est_amount ? `: ${money(v.est_amount)}` : ''}.`, { href: `#/booking/${v.id}` });
    if (v.est_viewed_at) add(v.est_viewed_at, 'estimate', 'Opened the estimate.');
    if (v.est_decided_at && v.est_status === 'accepted') add(v.est_decided_at, 'estimate', 'Said yes to the estimate.');
    if (v.est_decided_at && v.est_status === 'declined') add(v.est_decided_at, 'estimate', `Said no thanks${v.est_note ? `: "${v.est_note}"` : ''}.`);
    if (v.est_replied_at && v.est_note && v.est_status === 'sent') add(v.est_replied_at, 'message_in', `Asked about the estimate: "${v.est_note}"`);
    if (v.job_done_at) add(v.job_done_at, 'job', 'Roof job done.');
  }
  for (const e of extra.events) {
    const detail = (e.detail ?? {}) as Record<string, unknown>;
    const href = `#/booking/${e.booking_id}`;
    if (e.kind === 'rescheduled' && typeof detail.starts_at === 'string') add(e.at, 'visit', `Inspection moved to ${shortDay(detail.starts_at)}.`, { href });
    else if (e.kind === 'cancelled') add(e.at, 'visit', `Inspection cancelled${e.actor === 'customer' ? ' by the customer' : ''}${detail.reason ? `: ${detail.reason}` : ''}.`, { href });
    else if (e.kind === 'status' && detail.to === 'done') add(e.at, 'visit', 'Inspection done.', { href });
    else if (e.kind === 'status' && detail.to === 'no_show') add(e.at, 'visit', 'No one there for the inspection.', { href });
    else if (e.kind === 'on_my_way') add(e.at, 'visit', 'Told them: on the way.', { href });
    else if (e.kind === 'job_scheduled' || e.kind === 'job_moved') {
      const day = typeof detail.day === 'string' ? shortDay(`${detail.day}T12:00:00Z`) : '';
      add(e.at, 'job', `Roof job ${e.kind === 'job_moved' ? 'moved to' : 'set for'} ${day || 'a new day'}.`, { href });
    }
  }
  for (const m of extra.messages) {
    const label = m.channel === 'email' ? 'Email' : m.channel === 'sms' ? 'Text' : 'Message';
    if (m.direction === 'in') {
      add(m.created_at, 'message_in', `${m.channel === 'portal' ? 'Message from their link' : `${label} from them`}: "${String(m.body).slice(0, 280)}"`);
    } else {
      const what = m.subject ? String(m.subject) : String(m.body).split('\n')[0]!.slice(0, 120);
      add(m.created_at, 'message_out', `${label} sent: ${what}${m.status === 'logged' ? ' (recorded, not sent)' : m.status === 'failed' ? ' (failed)' : ''}`);
    }
  }
  for (const n of extra.notes) add(n.created_at, 'note', String(n.body), { by: who(n.author) });
  for (const t of extra.tasks) if (t.status === 'done' && t.done_at) add(t.done_at, 'task', `Done: ${t.title}`, { by: who(t.done_by) });
  timeline.sort((a, b) => b.at.localeCompare(a.at));

  return {
    ...c,
    mobileLabel: formatMobile(mobile),
    next: nextStep(c.stage, c, d.visits),
    visits: d.visits
      .sort((a, b) => +b.starts_at - +a.starts_at)
      .map((v) => ({
        id: v.id,
        ref: v.ref,
        startsAt: iso(v.starts_at)!,
        endsAt: iso(v.ends_at)!,
        when: whenLabel(iso(v.starts_at)!, iso(v.ends_at)!),
        window: windowLabel(iso(v.starts_at)!, iso(v.ends_at)!),
        status: v.status,
        address: v.address,
        assignedTo: v.assigned_to,
        assignedName: who(v.assigned_to),
        estimate: v.est_status ? { status: v.est_status, amountCents: v.est_amount } : null,
        job: v.job_status ? { status: v.job_status, day: v.job_day, crew: v.crew_name ?? '' } : null,
      })),
    requests: d.reqs
      .sort((a, b) => +b.created_at - +a.created_at)
      .map((r) => ({ id: r.id, status: r.status, createdAt: iso(r.created_at)!, address: r.address })),
    tasks: extra.tasks.map((t) => ({
      id: t.id as string,
      title: t.title as string,
      notes: (t.notes as string | null) ?? '',
      dueOn: (t.due_on as string | null) ?? null,
      assignee: (t.assignee as string | null) ?? null,
      assigneeName: who(t.assignee),
      status: t.status as string,
      auto: Boolean(t.auto_key),
    })),
    timeline,
    owners: d.owners.map((o) => ({ id: o.user_id as string, name: o.name as string })),
  };
}

export type CustomerDetail = NonNullable<Awaited<ReturnType<typeof customer>>>;

// ---------- Changing a customer ----------

const ProfileInput = z.object({
  assignedTo: z.uuid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  lost: z.boolean().optional(),
  lostReason: z.string().trim().max(200).optional(),
});

export async function saveProfile(owner: Owner, mobileInput: string, input: unknown): Promise<Result> {
  const mobile = normalizeMobile(mobileInput);
  if (!mobile) return fail(400, 'Which customer?');
  const p = ProfileInput.safeParse(input);
  if (!p.success) return fail(400, 'Check the details and try again.');
  const v = p.data;
  const handedTo = await asOwner(owner.userId, async (tx) => {
    await tx`insert into wb.customer_profiles (mobile) values (${mobile}) on conflict (mobile) do nothing`;
    const [before] = await tx`select assigned_to from wb.customer_profiles where mobile = ${mobile}`;
    if (v.assignedTo !== undefined) await tx`update wb.customer_profiles set assigned_to = ${v.assignedTo} where mobile = ${mobile}`;
    if (v.tags !== undefined) {
      const tags = [...new Set(v.tags.map((t) => t.replace(/\s+/g, ' ')))];
      await tx`update wb.customer_profiles set tags = ${tags} where mobile = ${mobile}`;
    }
    if (v.lost !== undefined) {
      await tx`update wb.customer_profiles set lost = ${v.lost}, lost_reason = ${v.lost ? (v.lostReason ?? null) : null} where mobile = ${mobile}`;
      // Lost: the system's to-dos for them are done with.
      if (v.lost) {
        await tx`update wb.tasks set status = 'done', done_at = now(), done_by = ${owner.userId}
                 where mobile = ${mobile} and status = 'open' and auto_key is not null`;
      }
    }
    if (!v.assignedTo || v.assignedTo === before?.assigned_to) return null;
    const [who] = await tx`
      select name, address from (
        select name, address, created_at from wb.bookings where mobile = ${mobile}
        union all select name, address, created_at from wb.estimate_requests where mobile = ${mobile}
      ) x order by created_at desc limit 1`;
    return who ? { to: v.assignedTo, name: who.name as string, town: townOf(who.address as string) } : null;
  });
  if (handedTo) {
    await tellAssignee(owner, handedTo.to, {
      title: 'gave you a customer',
      body: `${handedTo.name}${handedTo.town ? ` in ${handedTo.town}` : ''}. They're yours to follow through.`,
      url: `/app/#/customer/${mobile.slice(1)}`,
      tag: `customer-${mobile.slice(1)}`,
    });
  }
  return { ok: true };
}

export async function addNote(owner: Owner, mobileInput: string, body: unknown): Promise<Result> {
  const mobile = normalizeMobile(mobileInput);
  if (!mobile) return fail(400, 'Which customer?');
  if (typeof body !== 'string' || !body.trim()) return fail(400, 'Type the note first.');
  if (body.length > 4000) return fail(400, 'Keep a note under 4,000 characters.');
  await asOwner(owner.userId, (tx) => tx`insert into wb.customer_notes (mobile, author, body) values (${mobile}, ${owner.userId}, ${body.trim()})`);
  return { ok: true };
}

const EmailInput = z.object({ subject: z.string().trim().min(1).max(150), body: z.string().trim().min(1).max(5000) });

/** An email to the customer from the owner app. Replies come to the business inbox. */
export async function emailCustomer(owner: Owner, mobileInput: string, input: unknown): Promise<Result<{ outcome: string }>> {
  const mobile = normalizeMobile(mobileInput);
  if (!mobile) return fail(400, 'Which customer?');
  const p = EmailInput.safeParse(input);
  if (!p.success) return fail(400, 'Add a subject and a message.');
  const d = await load(owner, mobile);
  const email = [...d.visits, ...d.reqs].sort((a, b) => +b.created_at - +a.created_at).find((x) => x.email)?.email;
  if (!email) return fail(409, 'No email on file for them. Call or text instead.');
  const me = d.owners.find((o) => o.user_id === owner.userId);
  const sign = `${me?.name ?? facts.business.name}, ${facts.business.name}. ${facts.contact.phone}`;
  const site = config.siteUrl();
  const paragraphs = p.data.body.split(/\n{2,}/).map((x) => escape(x.trim()).replace(/\n/g, '<br>'));
  const outcome = await send({
    bookingId: newest(d.visits)?.id ?? null,
    requestId: d.visits.length ? undefined : (newest(d.reqs)?.id ?? undefined),
    channel: 'email',
    audience: 'customer',
    kind: 'owner_message',
    to: email,
    subject: p.data.subject,
    text: `${p.data.body}\n\n${sign}`,
    html: layout(site, p.data.subject, [...paragraphs, escape(sign)]),
  });
  if (outcome === 'failed') return fail(502, "The email didn't go out. Try again in a minute.");
  return { ok: true, outcome };
}

// ---------- A new lead from a phone call ----------

const LeadInput = z.object({
  name: z.string().trim().min(1).max(120),
  mobile: z.string().max(30),
  email: z.string().trim().max(254).optional().default(''),
  address: z.string().trim().min(5).max(300),
  source: z.enum(['phone_call', 'walk_in', 'referral', 'door_knock', 'other']).default('phone_call'),
  note: z.string().trim().max(4000).optional().default(''),
});

export async function createLead(owner: Owner, input: unknown): Promise<Result<{ mobile: string; requestId: string }>> {
  const p = LeadInput.safeParse(input);
  if (!p.success) return fail(400, 'Add their name, a 10 digit mobile number and the address.');
  const mobile = normalizeMobile(p.data.mobile);
  if (!mobile || !MOBILE.test(mobile)) return fail(400, 'Enter a 10 digit US mobile number.');
  const email = p.data.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.data.email) ? p.data.email.toLowerCase() : null;
  if (p.data.email && !email) return fail(400, 'Check the email address, like name@example.com.');
  const id = await asOwner(owner.userId, async (tx) => {
    const [r] = await tx`
      insert into wb.estimate_requests (ref, name, mobile, email, address, lead_source, token_hash, idempotency_key)
      values (${newRef()}, ${p.data.name}, ${mobile}, ${email}, ${p.data.address}, ${p.data.source}, ${randomBytes(32)}, ${randomUUID()})
      returning id`;
    if (p.data.note) await tx`insert into wb.customer_notes (mobile, author, body) values (${mobile}, ${owner.userId}, ${p.data.note})`;
    return r!.id as string;
  });
  return { ok: true, mobile, requestId: id };
}
