// After the inspection: the estimate, the customer's answer, follow-ups and roof jobs.
//   Owner actions run as the signed-in owner, so row level security checks them.
//   The customer answers through wb_api with their private link.
//   The scheduled job sends follow-ups and job reminders as the service role.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { facts } from '../facts';
import { asOwner, asPublic, asService, dbErrorCode } from './db';
import { config } from './env';
import { addDays, local } from './reminders';
import { send, type Outcome } from './messaging/send';
import type { Email } from './messaging/templates';
import * as t from './messaging/pipeline-templates';
import { ownerRecipients } from './notify';
import { asRoofSheet, imageryMonth } from './roofsheet';
import { createUpload, viewUrl } from './storage';
import { looksLikeToken, manageToken, manageUrl, tokenHash } from './tokens';
import type { Owner } from './auth';

export type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; status: number; message: string; code?: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
const fail = (status: number, message: string, code?: string) => ({ ok: false as const, status, message, ...(code ? { code } : {}) });
const today = () => local(new Date()).date;
const actor = (owner: Owner) => `owner:${owner.email}`;

/** Follow-ups and review requests need a mailing address in the footer (CAN-SPAM). */
export const followUpsHeld = () => !facts.business.mailingAddress;

// Who the customer is, and their private link.

async function customer(bookingId: string): Promise<{ c: t.PipelineCustomer; link: string } | null> {
  const [r] = await asService(
    (tx) => tx`select id, name, address, email, mobile, sms_consent, idempotency_key from wb.bookings where id = ${bookingId}`,
  );
  if (!r) return null;
  return {
    c: { id: r.id, name: r.name, address: r.address, email: r.email, mobile: r.mobile, smsConsent: r.sms_consent },
    link: manageUrl(config.siteUrl(), manageToken(r.idempotency_key)),
  };
}

/** Email always; a text only when they agreed to texts. */
async function tell(
  bookingId: string,
  kind: string,
  dedupe: string,
  build: (c: t.PipelineCustomer, link: string, site: string) => { email?: Email; sms?: string },
): Promise<{ email: Outcome; sms: Outcome }> {
  const found = await customer(bookingId);
  if (!found) return { email: 'no_recipient', sms: 'no_recipient' };
  const { c, link } = found;
  const msg = build(c, link, config.siteUrl());
  const [email, sms] = await Promise.all([
    msg.email
      ? send({ bookingId, channel: 'email', audience: 'customer', kind, to: c.email, ...msg.email, dedupeKey: `${dedupe}:email` })
      : Promise.resolve<Outcome>('no_recipient'),
    msg.sms && c.smsConsent
      ? send({ bookingId, channel: 'sms', audience: 'customer', kind, to: c.mobile, text: msg.sms, dedupeKey: `${dedupe}:sms` })
      : Promise.resolve<Outcome>('no_recipient'),
  ]);
  return { email, sms };
}

/** An owner marked the inspection done: thank the customer and say when the estimate comes. */
export async function inspected(bookingId: string): Promise<void> {
  await tell(bookingId, 'inspected', `inspected:${bookingId}`, (c, link, site) => ({
    email: t.emailInspected(c, link, site),
    sms: t.smsInspected(),
  }));
}

// Estimates (owner).

export interface EstimateInfo {
  status: string;
  amountCents: number | null;
  summary: string;
  fileName: string;
  fileUrl: string | null;
  sentAt: string | null;
  sendCount: number;
  viewedAt: string | null;
  decidedAt: string | null;
  repliedAt: string | null;
  customerNote: string;
  followUpsSent: number;
  followUpsTotal: number;
  followUpsStoppedAt: string | null;
  /** The roof's size and pitch as this estimate states them (rise in inches per 12). */
  roofSqft: number | null;
  roofPitch: number | null;
}

/** What the measurement from above says, as a starting point for the estimate's roof size and pitch. */
export interface RoofSuggestion {
  sqft: number;
  pitch: number | null;
  source: 'google' | 'outline';
  imagery: string;
}

export interface JobInfo {
  status: string;
  crewId: string | null;
  crewName: string;
  day: string | null;
  doneAt: string | null;
}

export interface CrewInfo {
  id: string;
  name: string;
  jobsPerDay: number;
  active: boolean;
}

const crewRow = (r: Record<string, unknown>): CrewInfo => ({
  id: r.id as string,
  name: r.name as string,
  jobsPerDay: Number(r.jobs_per_day),
  active: Boolean(r.active),
});

/** The estimate, the job and the crews, for one booking in the owner app. */
export async function forBooking(owner: Owner, bookingId: string) {
  const { e, j, crews, roof } = await asOwner(owner.userId, async (tx) => {
    const [e] = await tx`select * from wb.estimates where booking_id = ${bookingId}`;
    const [b] = await tx`select roof from wb.bookings where id = ${bookingId}`;
    const [j] = await tx`
      select j.status, j.crew_id, c.name as crew_name, to_char(j.day, 'YYYY-MM-DD') as day, j.done_at
      from wb.jobs j left join wb.crews c on c.id = j.crew_id where j.booking_id = ${bookingId}`;
    const crews = await tx`select * from wb.crews order by sort, created_at`;
    return { e, j, crews, roof: asRoofSheet(b?.roof) };
  });
  const rise = roof?.pitch ? Number(roof.pitch.split('/')[0]) : NaN;
  const roofSuggestion: RoofSuggestion | null = roof
    ? { sqft: roof.sqft[0], pitch: Number.isFinite(rise) ? rise : null, source: roof.source, imagery: imageryMonth(roof.imageryDate) }
    : null;
  const estimate: EstimateInfo | null = e
    ? {
        status: e.status,
        amountCents: e.amount_cents,
        summary: e.summary ?? '',
        fileName: e.file_name ?? '',
        fileUrl: e.file_path ? await viewUrl(e.file_path, 600, config.estimateBucket()) : null,
        sentAt: iso(e.sent_at),
        sendCount: e.send_count,
        viewedAt: iso(e.viewed_at),
        decidedAt: iso(e.decided_at),
        repliedAt: iso(e.replied_at),
        customerNote: e.customer_note ?? '',
        followUpsSent: e.followups_sent,
        followUpsTotal: facts.pipeline.followUpDays.length,
        followUpsStoppedAt: iso(e.followups_stopped_at),
        roofSqft: (e.roof_sqft as number | null) ?? null,
        roofPitch: (e.roof_pitch as number | null) ?? null,
      }
    : null;
  const job: JobInfo | null = j
    ? { status: j.status, crewId: j.crew_id, crewName: j.crew_name ?? '', day: j.day, doneAt: iso(j.done_at) }
    : null;
  return { estimate, job, crews: crews.map(crewRow), followUpsHeld: followUpsHeld(), roofSuggestion };
}

const EstimateInput = z.object({
  amountCents: z.number().int().min(100).max(1_000_000_000).nullable().optional(),
  summary: z.string().max(4000).optional(),
  filePath: z.string().regex(/^estimates\/[0-9a-f-]{36}\.pdf$/).nullable().optional(),
  fileName: z.string().max(200).nullable().optional(),
  roofSqft: z.number().int().min(100).max(200_000).nullable().optional(),
  roofPitch: z.number().int().min(0).max(24).nullable().optional(),
  send: z.boolean().optional(),
});

/** Save the estimate, and send it when asked. Sending again sends the updated estimate and restarts follow-ups. */
export async function saveEstimate(owner: Owner, bookingId: string, input: unknown): Promise<Result<{ sent: boolean }>> {
  const p = EstimateInput.safeParse(input);
  if (!p.success) {
    const field = String(p.error.issues[0]?.path[0] ?? '');
    if (field === 'roofSqft') return fail(400, 'Check the roof size: square feet, like 2400.');
    if (field === 'roofPitch') return fail(400, 'Check the pitch: the rise per 12, from 0 to 24.');
    return fail(400, 'Check the price: whole dollars, like 12500.');
  }
  const v = p.data;
  const out = await asOwner(owner.userId, async (tx) => {
    const [b] = await tx`select status from wb.bookings where id = ${bookingId}`;
    if (!b) return fail(404, 'Booking not found.');
    if (b.status !== 'done') return fail(409, 'Mark the inspection done first.');
    const [before] = await tx`select * from wb.estimates where booking_id = ${bookingId} for update`;
    if (before && ['accepted', 'declined'].includes(before.status)) {
      return fail(409, 'The customer already answered this estimate. Call them to change it.');
    }
    if (before?.status === 'sent' && !v.send) {
      return fail(409, 'This estimate was already sent. Use "Send updated estimate" so the customer hears about the change.');
    }
    const amount = v.amountCents === undefined ? (before?.amount_cents ?? null) : v.amountCents;
    const summary = v.summary === undefined ? (before?.summary ?? null) : v.summary.trim() || null;
    const filePath = v.filePath === undefined ? (before?.file_path ?? null) : v.filePath;
    const fileName = v.fileName === undefined ? (before?.file_name ?? null) : v.fileName;
    const roofSqft = v.roofSqft === undefined ? (before?.roof_sqft ?? null) : v.roofSqft;
    const roofPitch = v.roofPitch === undefined ? (before?.roof_pitch ?? null) : v.roofPitch;
    if (v.send && amount === null && filePath === null) return fail(400, 'Add the price or attach the estimate before sending.');
    await tx`
      insert into wb.estimates (booking_id, amount_cents, summary, file_path, file_name, roof_sqft, roof_pitch)
      values (${bookingId}, ${amount}, ${summary}, ${filePath}, ${fileName}, ${roofSqft}, ${roofPitch})
      on conflict (booking_id) do update
      set amount_cents = excluded.amount_cents, summary = excluded.summary,
          file_path = excluded.file_path, file_name = excluded.file_name,
          roof_sqft = excluded.roof_sqft, roof_pitch = excluded.roof_pitch,
          status = case when wb.estimates.status = 'withdrawn' then 'draft' else wb.estimates.status end`;
    if (!v.send) return { ok: true as const, sent: false, sendCount: 0 };
    const [e] = await tx`
      update wb.estimates
      set status = 'sent', sent_at = now(), send_count = send_count + 1, viewed_at = null,
          followups_sent = 0, last_followup_at = null, followups_stopped_at = null
      where booking_id = ${bookingId}
      returning send_count`;
    await tx`insert into wb.booking_events (booking_id, actor, kind, detail)
             values (${bookingId}, ${actor(owner)}, 'estimate_sent', ${tx.json({ amount_cents: amount, version: e!.send_count })})`;
    return { ok: true as const, sent: true, sendCount: Number(e!.send_count) };
  });
  if (!out.ok) return out;
  if (out.sent) {
    const updated = out.sendCount > 1;
    await tell(bookingId, 'estimate_ready', `estimate_ready:${bookingId}:${out.sendCount}`, (c, link, site) => ({
      email: t.emailEstimateReady(c, link, site, updated),
      sms: t.smsEstimateReady(link, updated),
    }));
  }
  return { ok: true, sent: out.sent };
}

/** A short-lived link to upload the estimate PDF straight to storage. */
export async function estimateUpload(owner: Owner, bookingId: string): Promise<Result<{ path: string; upload: Awaited<ReturnType<typeof createUpload>> }>> {
  const found = await asOwner(owner.userId, (tx) => tx`select id from wb.bookings where id = ${bookingId}`);
  if (found.length === 0) return fail(404, 'Booking not found.');
  const path = `estimates/${randomUUID()}.pdf`;
  return { ok: true, path, upload: await createUpload(path, 'application/pdf', config.estimateBucket()) };
}

const OwnerEstimateAction = z.enum(['stop_followups', 'accepted', 'declined', 'withdraw']);

/** Stop follow-ups, record an answer the customer gave by phone, or take the estimate back. */
export async function estimateAction(owner: Owner, bookingId: string, action: unknown): Promise<Result> {
  const a = OwnerEstimateAction.safeParse(action);
  if (!a.success) return fail(400, 'Pick an action.');
  return asOwner(owner.userId, async (tx) => {
    const [e] = await tx`select * from wb.estimates where booking_id = ${bookingId} for update`;
    if (!e) return fail(404, 'No estimate yet.');
    if (a.data === 'stop_followups') {
      if (e.status !== 'sent') return fail(409, 'Follow-ups only run while an estimate waits for an answer.');
      await tx`update wb.estimates set followups_stopped_at = now() where id = ${e.id}`;
      await tx`insert into wb.booking_events (booking_id, actor, kind, detail) values (${bookingId}, ${actor(owner)}, 'followups_stopped', '{}'::jsonb)`;
      return { ok: true as const };
    }
    if (a.data === 'withdraw') {
      if (!['draft', 'sent'].includes(e.status)) return fail(409, 'The customer already answered this estimate.');
      await tx`update wb.estimates set status = 'withdrawn' where id = ${e.id}`;
      await tx`insert into wb.booking_events (booking_id, actor, kind, detail) values (${bookingId}, ${actor(owner)}, 'estimate_withdrawn', '{}'::jsonb)`;
      return { ok: true as const };
    }
    if (e.status !== 'sent') return fail(409, e.status === 'draft' ? 'Send the estimate first.' : 'The customer already answered this estimate.');
    await tx`update wb.estimates set status = ${a.data}, decided_at = now() where id = ${e.id}`;
    if (a.data === 'accepted') {
      await tx`insert into wb.jobs (booking_id) values (${bookingId})
               on conflict (booking_id) do update set status = 'to_schedule', crew_id = null, day = null
               where wb.jobs.status = 'cancelled'`;
    }
    await tx`insert into wb.booking_events (booking_id, actor, kind, detail)
             values (${bookingId}, ${actor(owner)}, ${`estimate_${a.data}`}, ${tx.json({ by: 'phone' })})`;
    return { ok: true as const };
  });
}

// The customer's answer, from their private link.

const CustomerAnswer = z.enum(['accept', 'decline', 'question']);

export async function customerAnswer(token: unknown, answer: unknown, note: unknown): Promise<Result<{ booking: unknown }>> {
  if (!looksLikeToken(token)) return fail(404, "We couldn't find that estimate. Use the link from your email or text.");
  const a = CustomerAnswer.safeParse(answer);
  if (!a.success) return fail(400, 'Choose an answer.');
  const text = typeof note === 'string' ? note.slice(0, 1000) : '';
  let summary: Record<string, unknown> | null = null;
  try {
    const [r] = await asPublic((tx) => tx`select wb_api.estimate_answer(${tokenHash(token)}, ${a.data}, ${text}) as s`);
    summary = r?.s ?? null;
  } catch (err) {
    const code = dbErrorCode(err);
    if (code === 'not_found') return fail(404, "We couldn't find that estimate. Use the link from your email or text.");
    if (code === 'bad_request') return fail(400, 'Type your question first.');
    if (code === 'cannot_change') return fail(409, `You already answered. To change your answer, call or text ${facts.contact.phone}.`);
    throw err;
  }
  const bookingId = summary?.id as string;
  const kind: t.Answer = a.data === 'accept' ? 'accepted' : a.data === 'decline' ? 'declined' : 'question';
  // Same answer twice sends one alert; every question is its own alert.
  const key = kind === 'question' ? `answer:${bookingId}:question:${Date.now()}` : `answer:${bookingId}:${kind}`;
  await alertOwners(bookingId, kind, text.trim(), key);
  return { ok: true, booking: summary };
}

async function alertOwners(bookingId: string, kind: t.Answer, note: string, key: string) {
  const found = await customer(bookingId);
  if (!found) return;
  const [e] = await asService((tx) => tx`select amount_cents from wb.estimates where booking_id = ${bookingId}`);
  const site = config.siteUrl();
  const appUrl = `${site}/app/#/booking/${bookingId}`;
  const amount = (e?.amount_cents as number | null) ?? null;
  const email = t.ownerAnswerEmail(kind, found.c, amount, note, appUrl, site);
  const text = t.ownerAnswerSms(kind, found.c, amount, note, appUrl);
  const jobs: Promise<Outcome>[] = [];
  for (const r of await ownerRecipients()) {
    if (r.email) jobs.push(send({ bookingId, channel: 'email', audience: 'owner', kind: `owner_${kind}`, to: r.email, ...email, dedupeKey: `${key}:${r.email}` }));
    if (r.mobile) jobs.push(send({ bookingId, channel: 'sms', audience: 'owner', kind: `owner_${kind}`, to: r.mobile, text, dedupeKey: `${key}:${r.mobile}` }));
  }
  await Promise.allSettled(jobs);
}

/** A few minutes' link to the customer's estimate PDF. */
export async function customerEstimateFile(token: unknown): Promise<string | null> {
  if (!looksLikeToken(token)) return null;
  const [r] = await asPublic((tx) => tx`select wb_api.estimate_file(${tokenHash(token)}) as path`);
  return r?.path ? viewUrl(r.path, 600, config.estimateBucket()) : null;
}

// Crews and jobs (owner).

export async function listCrews(owner: Owner): Promise<CrewInfo[]> {
  const rows = await asOwner(owner.userId, (tx) => tx`select * from wb.crews order by sort, created_at`);
  return rows.map(crewRow);
}

const CrewsInput = z
  .array(
    z.object({
      id: z.uuid().optional(),
      name: z.string().trim().min(1).max(60),
      jobsPerDay: z.number().int().min(1).max(5),
      active: z.boolean(),
    }),
  )
  .min(1)
  .max(10);

export async function saveCrews(owner: Owner, input: unknown): Promise<Result> {
  const p = CrewsInput.safeParse(input);
  if (!p.success) return fail(400, 'Each crew needs a name and 1 to 5 jobs a day.');
  await asOwner(owner.userId, async (tx) => {
    for (const [i, c] of p.data.entries()) {
      if (c.id) {
        await tx`update wb.crews set name = ${c.name}, jobs_per_day = ${c.jobsPerDay}, active = ${c.active}, sort = ${i + 1} where id = ${c.id}`;
      } else {
        await tx`insert into wb.crews (name, jobs_per_day, active, sort) values (${c.name}, ${c.jobsPerDay}, ${c.active}, ${i + 1})`;
      }
    }
  });
  return { ok: true };
}

const ScheduleInput = z.object({ crewId: z.uuid(), day: z.string().regex(DATE), force: z.boolean().optional() });

/** Put a job on a crew's day, or move it. Warns when the crew already has its jobs for that day. */
export async function scheduleJob(owner: Owner, bookingId: string, input: unknown): Promise<Result> {
  const p = ScheduleInput.safeParse(input);
  if (!p.success) return fail(400, 'Pick a crew and a day.');
  const { crewId, day, force } = p.data;
  if (day < today()) return fail(400, 'Pick today or a later day.');
  const out = await asOwner(owner.userId, async (tx) => {
    const [j] = await tx`select id, status, to_char(day, 'YYYY-MM-DD') as day from wb.jobs where booking_id = ${bookingId} for update`;
    if (!j) return fail(404, "This customer hasn't said yes yet.");
    if (['done', 'cancelled'].includes(j.status)) return fail(409, `This job is ${j.status === 'done' ? 'done' : 'cancelled'}.`);
    const [crew] = await tx`select * from wb.crews where id = ${crewId} and active`;
    if (!crew) return fail(400, 'Pick a crew.');
    const [load] = await tx`
      select count(*)::int as n from wb.jobs
      where crew_id = ${crewId} and day = ${day}::date and status = 'scheduled' and id <> ${j.id}`;
    if (load!.n >= crew.jobs_per_day && !force) {
      return fail(409, `${crew.name} already has ${load!.n === 1 ? 'a job' : `${load!.n} jobs`} that day.`, 'crew_full');
    }
    const previous = j.status === 'scheduled' ? (j.day as string) : null;
    await tx`update wb.jobs set status = 'scheduled', crew_id = ${crewId}, day = ${day}::date where id = ${j.id}`;
    await tx`insert into wb.booking_events (booking_id, actor, kind, detail)
             values (${bookingId}, ${actor(owner)}, ${previous ? 'job_moved' : 'job_scheduled'},
                     ${tx.json({ from: previous, to: day, crew: crew.name })})`;
    return { ok: true as const, previous };
  });
  if (!out.ok) return out;
  if (!out.previous) {
    await tell(bookingId, 'job_scheduled', `job_scheduled:${bookingId}:${day}`, (c, link, site) => ({
      email: t.emailJobScheduled(c, day, link, site),
      sms: t.smsJobScheduled(day),
    }));
  } else if (out.previous !== day) {
    await jobMovedMessage(bookingId, out.previous, day, false);
  }
  return { ok: true };
}

async function jobMovedMessage(bookingId: string, from: string, to: string, weather: boolean) {
  await tell(bookingId, 'job_moved', `job_moved:${bookingId}:${from}:${to}:${Date.now()}`, (c, link, site) => ({
    email: t.emailJobMoved(c, from, to, weather, link, site),
    sms: t.smsJobMoved(from, to, weather),
  }));
}

const JobStatus = z.enum(['done', 'cancelled', 'to_schedule']);

/** Done (thanks and a review request go out), cancelled, or back to "needs a day". */
export async function setJobStatus(owner: Owner, bookingId: string, status: unknown): Promise<Result> {
  const s = JobStatus.safeParse(status);
  if (!s.success) return fail(400, 'Pick a status.');
  const out = await asOwner(owner.userId, async (tx) => {
    const [j] = await tx`select id, status from wb.jobs where booking_id = ${bookingId} for update`;
    if (!j) return fail(404, 'No job for this customer.');
    if (j.status === s.data) return { ok: true as const, changed: false };
    if (s.data === 'done' && j.status !== 'scheduled') return fail(409, 'Put the job on a day first.');
    await tx`update wb.jobs set status = ${s.data},
               done_at = case when ${s.data} = 'done' then now() else null end,
               crew_id = case when ${s.data} = 'to_schedule' then null else crew_id end,
               day = case when ${s.data} = 'to_schedule' then null else day end
             where id = ${j.id}`;
    await tx`insert into wb.booking_events (booking_id, actor, kind, detail)
             values (${bookingId}, ${actor(owner)}, ${`job_${s.data}`}, '{}'::jsonb)`;
    return { ok: true as const, changed: true };
  });
  if (!out.ok) return out;
  if (out.changed && s.data === 'done') {
    const review = facts.pipeline.reviewUrl || facts.reviews.google.url;
    await tell(bookingId, 'job_done', `job_done:${bookingId}`, (c, _link, site) => ({ email: t.emailJobDone(c, site, review) }));
  }
  return { ok: true };
}

const MoveDayInput = z.object({
  from: z.string().regex(DATE),
  to: z.string().regex(DATE),
  weather: z.boolean().default(true),
  force: z.boolean().optional(),
});

/** Weather: move every job on one day to another, and tell each customer. */
export async function moveDay(owner: Owner, input: unknown): Promise<Result<{ moved: number }>> {
  const p = MoveDayInput.safeParse(input);
  if (!p.success) return fail(400, 'Pick the day to move and the new day.');
  const { from, to, weather, force } = p.data;
  if (to === from) return fail(400, 'Pick a different day.');
  if (to < today()) return fail(400, 'Pick today or a later day.');
  const out = await asOwner(owner.userId, async (tx) => {
    const jobs = await tx`
      select j.id, j.booking_id, j.crew_id from wb.jobs j
      where j.status = 'scheduled' and j.day = ${from}::date for update`;
    if (jobs.length === 0) return fail(404, 'No jobs on that day.');
    const full = await tx`
      select c.name, c.jobs_per_day,
             (select count(*)::int from wb.jobs x where x.crew_id = c.id and x.status = 'scheduled' and x.day = ${to}::date) as already,
             (select count(*)::int from wb.jobs y where y.crew_id = c.id and y.status = 'scheduled' and y.day = ${from}::date) as moving
      from wb.crews c where c.id = any(${jobs.map((j) => j.crew_id)}::uuid[])`;
    const over = full.filter((c) => c.already + c.moving > c.jobs_per_day);
    if (over.length > 0 && !force) {
      return fail(409, `${over.map((c) => c.name).join(' and ')} would have more jobs than usual that day.`, 'crew_full');
    }
    await tx`update wb.jobs set day = ${to}::date where id = any(${jobs.map((j) => j.id)}::uuid[])`;
    for (const j of jobs) {
      await tx`insert into wb.booking_events (booking_id, actor, kind, detail)
               values (${j.booking_id}, ${actor(owner)}, 'job_moved', ${tx.json({ from, to, weather })})`;
    }
    return { ok: true as const, ids: jobs.map((j) => j.booking_id as string) };
  });
  if (!out.ok) return out;
  for (const id of out.ids) await jobMovedMessage(id, from, to, weather);
  return { ok: true, moved: out.ids.length };
}

// Lists for the owner app.

/** Everything after the inspection, in the order an owner works it. */
export async function pipeline(owner: Owner) {
  return asOwner(owner.userId, async (tx) => {
    const needsEstimate = await tx`
      select l.id, l.name, l.address, l.starts_at, e.status as estimate_status
      from wb.booking_list l left join wb.estimates e on e.booking_id = l.id
      where l.status = 'done' and (e.id is null or e.status = 'draft')
      order by l.starts_at desc limit 100`;
    const waiting = await tx`
      select l.id, l.name, l.address, e.amount_cents, e.sent_at, e.viewed_at, e.replied_at, e.customer_note,
             e.followups_sent, e.followups_stopped_at
      from wb.estimates e join wb.booking_list l on l.id = e.booking_id
      where e.status = 'sent' order by e.sent_at`;
    const saidYes = await tx`
      select l.id, l.name, l.address, e.amount_cents, e.decided_at
      from wb.jobs j join wb.booking_list l on l.id = j.booking_id left join wb.estimates e on e.booking_id = j.booking_id
      where j.status = 'to_schedule' order by e.decided_at nulls last`;
    const closed = await tx`
      select l.id, l.name, l.address, e.status, e.decided_at, e.customer_note
      from wb.estimates e join wb.booking_list l on l.id = e.booking_id
      where e.status in ('declined', 'withdrawn') and e.updated_at > now() - interval '60 days'
      order by e.updated_at desc limit 50`;
    return {
      followUpsHeld: followUpsHeld(),
      needsEstimate: needsEstimate.map((r) => ({ id: r.id, name: r.name, address: r.address, inspectedAt: iso(r.starts_at), draft: r.estimate_status === 'draft' })),
      waiting: waiting.map((r) => ({
        id: r.id,
        name: r.name,
        address: r.address,
        amountCents: r.amount_cents,
        sentAt: iso(r.sent_at),
        viewedAt: iso(r.viewed_at),
        repliedAt: r.replied_at && r.replied_at > r.sent_at ? iso(r.replied_at) : null,
        question: r.replied_at && r.replied_at > r.sent_at ? (r.customer_note ?? '') : '',
        followUpsSent: r.followups_sent,
        followUpsTotal: facts.pipeline.followUpDays.length,
        followUpsStopped: Boolean(r.followups_stopped_at),
      })),
      saidYes: saidYes.map((r) => ({ id: r.id, name: r.name, address: r.address, amountCents: r.amount_cents, decidedAt: iso(r.decided_at) })),
      closed: closed.map((r) => ({ id: r.id, name: r.name, address: r.address, status: r.status, decidedAt: iso(r.decided_at), note: r.customer_note ?? '' })),
    };
  });
}

/** Crews and their jobs, day by day, from a date. */
export async function jobsCalendar(owner: Owner, from: string, days = 28) {
  if (!DATE.test(from)) from = today();
  return asOwner(owner.userId, async (tx) => {
    const crews = await tx`select * from wb.crews order by sort, created_at`;
    const jobs = await tx`
      select j.booking_id, j.crew_id, to_char(j.day, 'YYYY-MM-DD') as day, l.name, l.address, l.mobile
      from wb.jobs j join wb.booking_list l on l.id = j.booking_id
      where j.status = 'scheduled' and j.day >= ${from}::date and j.day < ${from}::date + ${days}::int
      order by j.day, l.name`;
    const toSchedule = await tx`
      select l.id, l.name, l.address from wb.jobs j join wb.booking_list l on l.id = j.booking_id
      where j.status = 'to_schedule' order by j.created_at`;
    const byDay = new Map<string, { bookingId: string; crewId: string; name: string; address: string; mobile: string }[]>();
    for (const j of jobs) {
      const list = byDay.get(j.day) ?? [];
      list.push({ bookingId: j.booking_id, crewId: j.crew_id, name: j.name, address: j.address, mobile: j.mobile });
      byDay.set(j.day, list);
    }
    return {
      crews: crews.map(crewRow),
      days: [...byDay.entries()].map(([day, list]) => ({ day, jobs: list })),
      toSchedule: toSchedule.map((r) => ({ id: r.id, name: r.name, address: r.address })),
    };
  });
}

// The scheduled job.

/** Follow-up emails, on the days in facts.yaml, between 9 am and 6 pm, one per run per estimate, at least a day apart. */
export async function runFollowUps(now = new Date()): Promise<number | 'held'> {
  if (followUpsHeld()) return 'held';
  const days = facts.pipeline.followUpDays;
  const l = local(now);
  if (days.length === 0 || l.minutes < 9 * 60 || l.minutes >= 18 * 60) return 0;
  const rows = await asService(
    (tx) => tx`
      select e.id, e.booking_id, e.sent_at, e.followups_sent from wb.estimates e
      where e.status = 'sent' and e.followups_stopped_at is null
        and (e.replied_at is null or e.replied_at < e.sent_at)
        and e.followups_sent < ${days.length}
        and (e.last_followup_at is null or e.last_followup_at < ${new Date(now.getTime() - 20 * 3_600_000)})`,
  );
  let sent = 0;
  for (const r of rows) {
    const n = Number(r.followups_sent);
    const due = new Date(r.sent_at).getTime() + days[n]! * 86_400_000;
    if (now.getTime() < due) continue;
    const claimed = await asService(
      (tx) => tx`update wb.estimates set followups_sent = followups_sent + 1, last_followup_at = ${now}
                 where id = ${r.id} and followups_sent = ${n} and status = 'sent' returning id`,
    );
    if (claimed.length === 0) continue;
    const found = await customer(r.booking_id);
    if (!found) continue;
    const email = t.emailFollowUp(found.c, found.link, config.siteUrl(), n, days.length);
    const outcome = await send({
      bookingId: r.booking_id,
      channel: 'email',
      audience: 'customer',
      kind: `followup_${n + 1}`,
      to: found.c.email,
      ...email,
      dedupeKey: `followup:${r.id}:${n}:${new Date(r.sent_at).getTime()}`,
    });
    if (outcome === 'sent' || outcome === 'logged') sent++;
  }
  return sent;
}

/** The evening before a roof job (6 to 9 pm): a text if they agreed to texts, otherwise an email. */
export async function runJobReminders(now = new Date()): Promise<number> {
  const l = local(now);
  if (l.minutes < 18 * 60 || l.minutes >= 21 * 60) return 0;
  const tomorrow = addDays(l.date, 1);
  const rows = await asService(
    (tx) => tx`select j.booking_id, b.sms_consent from wb.jobs j join wb.bookings b on b.id = j.booking_id
               where j.status = 'scheduled' and j.day = ${tomorrow}::date`,
  );
  let sent = 0;
  const ok = (o: Outcome) => o === 'sent' || o === 'logged';
  for (const r of rows) {
    const key = `job_reminder:${r.booking_id}:${tomorrow}`;
    let out = r.sms_consent ? await tell(r.booking_id, 'job_reminder', key, () => ({ sms: t.smsJobReminder(tomorrow) })) : null;
    if (!out || (!ok(out.sms) && out.sms !== 'duplicate')) {
      out = await tell(r.booking_id, 'job_reminder', key, (c, link, site) => ({ email: t.emailJobReminder(c, tomorrow, link, site) }));
    }
    if (ok(out.email) || ok(out.sms)) sent++;
  }
  return sent;
}
