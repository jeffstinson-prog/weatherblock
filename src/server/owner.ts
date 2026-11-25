// What the owner app can see and do. Everything runs as the signed-in owner,
// so row level security checks every read and write.
import { z } from 'zod';
import { AGES, MATERIALS, REASONS, RELATIONSHIPS, SOMEONE_HOME, labelOf } from '../booking/rules';
import { TZ } from '../booking/format';
import { asOwner, dbErrorCode } from './db';
import { bookingChanged, onMyWay } from './notify';
import { forBooking, inspected } from './pipeline';
import { calendarApi, serviceAccountEmail, syncCalendar } from './calendar';
import { read } from './env';
import { roofImageUrl } from './maps';
import { asRoofSheet } from './roofsheet';
import { viewUrl } from './storage';
import type { BookingSummary } from './booking';
import type { Owner } from './auth';

const iso = (v: unknown) => new Date(String(v)).toISOString();

function row(r: Record<string, unknown>) {
  return {
    id: r.id as string,
    ref: r.ref as string,
    status: r.status as string,
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    address: r.address as string,
    lat: r.lat as number | null,
    lng: r.lng as number | null,
    name: r.name as string,
    mobile: r.mobile as string,
    email: r.email as string,
    reason: labelOf(REASONS, r.reason as string),
    someoneHome: labelOf(SOMEONE_HOME, r.someone_home as string),
    hasGateCode: Boolean(r.has_gate_code),
    pets: (r.pets as string | null) ?? '',
    photos: Number(r.photos ?? 0),
    smsConsent: Boolean(r.sms_consent),
    onMyWayAt: r.on_my_way_at ? iso(r.on_my_way_at) : null,
    ownerNotes: (r.owner_notes as string | null) ?? '',
  };
}

export type BookingRow = ReturnType<typeof row>;

/** Bookings on one local date (YYYY-MM-DD), in time order. */
export async function day(owner: Owner, date: string) {
  return asOwner(owner.userId, async (tx) => {
    const rows = await tx`
      select * from wb.booking_list
      where (starts_at at time zone ${TZ})::date = ${date}::date
      order by starts_at, created_at`;
    return rows.map(row);
  });
}

/** The next two weeks, with how full each window is. */
export async function upcoming(owner: Owner, days = 14) {
  return asOwner(owner.userId, async (tx) => {
    const rows = await tx`
      select * from wb.booking_list
      where status <> 'cancelled' and ends_at > now() and starts_at < now() + make_interval(days => ${days})
      order by starts_at, created_at`;
    const load = await tx`
      select id, starts_at, ends_at, capacity, booked from wb.slot_load
      where ends_at > now() and starts_at < now() + make_interval(days => ${days})
      order by starts_at`;
    return {
      bookings: rows.map(row),
      windows: load.map((l) => ({ id: l.id, startsAt: iso(l.starts_at), endsAt: iso(l.ends_at), capacity: l.capacity, booked: l.booked })),
    };
  });
}

export async function detail(owner: Owner, id: string) {
  const found = await asOwner(owner.userId, async (tx) => {
    const [r] = await tx`select l.*, b.gate_code, b.roof from wb.booking_list l join wb.bookings b on b.id = l.id where l.id = ${id}`;
    if (!r) return null;
    const [request] = await tx`select id, ref, created_at from wb.estimate_requests where booking_id = ${id} order by created_at desc limit 1`;
    const photos = await tx`select id, path from wb.booking_photos where booking_id = ${id} order by created_at`;
    const events = await tx`select at, actor, kind, detail from wb.booking_events where booking_id = ${id} order by at`;
    const messages = await tx`
      select created_at, channel, direction, audience, kind, status, to_addr, from_addr, coalesce(subject, body) as summary
      from wb.messages where booking_id = ${id} order by created_at`;
    return { r, photos, events, messages, request };
  });
  if (!found) return null;
  const { r, photos, events, messages, request } = found;
  const after = await forBooking(owner, id);
  const roofSheet = asRoofSheet(r.roof);
  return {
    ...after,
    ...row(r),
    // The roof as measured from above, and a ballpark. For the owners only.
    roofSheet,
    roofPicture: roofSheet?.box ? roofImageUrl(roofSheet.box) : null,
    request: request ? { id: request.id as string, ref: request.ref as string, createdAt: iso(request.created_at) } : null,
    gateCode: (r.gate_code as string | null) ?? '',
    relationship: labelOf(RELATIONSHIPS, r.relationship as string),
    roof: `${labelOf(MATERIALS, r.roof_material as string)}, ${labelOf(AGES, r.roof_age as string).toLowerCase()}`,
    notes: (r.notes as string | null) ?? '',
    leadSource: r.lead_source as string,
    heardAbout: (r.heard_about as string | null) ?? '',
    referralCode: (r.referral_code as string | null) ?? '',
    referrerName: (r.referrer_name as string | null) ?? '',
    createdAt: iso(r.created_at),
    cancelReason: (r.cancel_reason as string | null) ?? '',
    photoUrls: await Promise.all(photos.map(async (p) => ({ id: p.id as string, url: await viewUrl(p.path as string) }))),
    events: events.map((e) => ({ at: iso(e.at), actor: e.actor, kind: e.kind, detail: e.detail })),
    messages: messages.map((m) => ({
      at: iso(m.created_at),
      channel: m.channel,
      direction: m.direction,
      audience: m.audience,
      kind: m.kind,
      status: m.status,
      to: m.to_addr,
      summary: String(m.summary).slice(0, 300),
    })),
  };
}

function summaryFor(r: Record<string, unknown>): BookingSummary {
  return {
    id: r.id as string,
    ref: r.ref as string,
    status: r.status as BookingSummary['status'],
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    address: r.address as string,
    firstName: String(r.name).split(' ')[0] ?? '',
    smsConsent: Boolean(r.sms_consent),
    canChange: true,
  };
}

export type ActionResult = { ok: true } | { ok: false; status: number; message: string };

const Status = z.enum(['booked', 'done', 'cancelled', 'no_show']);

export async function setStatus(owner: Owner, id: string, status: unknown, tellCustomer: boolean): Promise<ActionResult> {
  const s = Status.safeParse(status);
  if (!s.success) return { ok: false, status: 400, message: 'Pick a status.' };
  let r: Record<string, unknown> | undefined;
  try {
    r = await asOwner(owner.userId, async (tx) => {
      const [before] = await tx`select status from wb.bookings where id = ${id}`;
      if (!before) return undefined;
      const [after] = await tx`
        update wb.bookings set status = ${s.data},
          cancelled_at = case when ${s.data} = 'cancelled' then now() else null end
        where id = ${id} returning id`;
      await tx`insert into wb.booking_events (booking_id, actor, kind, detail)
               values (${id}, ${`owner:${owner.email}`}, 'status', ${tx.json({ from: before.status, to: s.data })})`;
      const [full] = await tx`select * from wb.booking_list where id = ${id}`;
      return after ? full : undefined;
    });
  } catch (err) {
    if (dbErrorCode(err) === 'slot_full') return { ok: false, status: 409, message: 'That window is full now. Pick another time instead.' };
    throw err;
  }
  if (!r) return { ok: false, status: 404, message: 'Booking not found.' };
  if (s.data === 'cancelled' && tellCustomer) await bookingChanged(summaryFor(r), 'cancelled', { byOwner: true });
  if (s.data === 'done' && tellCustomer) await inspected(id);
  return { ok: true };
}

export async function setNotes(owner: Owner, id: string, notes: unknown): Promise<ActionResult> {
  if (typeof notes !== 'string' || notes.length > 5000) return { ok: false, status: 400, message: 'Notes are too long.' };
  const done = await asOwner(owner.userId, (tx) => tx`update wb.bookings set owner_notes = ${notes} where id = ${id} returning id`);
  return done.length ? { ok: true } : { ok: false, status: 404, message: 'Booking not found.' };
}

export async function reschedule(owner: Owner, id: string, slotId: unknown, tellCustomer: boolean): Promise<ActionResult> {
  if (typeof slotId !== 'string' || !/^[0-9a-f-]{36}$/.test(slotId)) return { ok: false, status: 400, message: 'Pick a new time.' };
  let r: Record<string, unknown> | undefined;
  let previous = '';
  try {
    r = await asOwner(owner.userId, async (tx) => {
      const [before] = await tx`select l.starts_at from wb.booking_list l where l.id = ${id}`;
      if (!before) return undefined;
      previous = iso(before.starts_at);
      await tx`update wb.bookings set slot_id = ${slotId}, status = 'booked', on_my_way_at = null where id = ${id}`;
      const [after] = await tx`select * from wb.booking_list where id = ${id}`;
      await tx`insert into wb.booking_events (booking_id, actor, kind, detail)
               values (${id}, ${`owner:${owner.email}`}, 'rescheduled', ${tx.json({ from: previous, to: iso(after!.starts_at) })})`;
      return after;
    });
  } catch (err) {
    if (dbErrorCode(err) === 'slot_full') return { ok: false, status: 409, message: 'That window is full. Pick another one, or raise its capacity in Availability.' };
    throw err;
  }
  if (!r) return { ok: false, status: 404, message: 'Booking not found.' };
  if (tellCustomer) await bookingChanged(summaryFor(r), 'rescheduled', { byOwner: true, previousStartsAt: previous });
  return { ok: true };
}

export async function sendOnMyWay(owner: Owner, id: string, minutes: unknown): Promise<ActionResult & { sent?: string }> {
  const m = Number(minutes);
  if (![10, 15, 20, 30, 45, 60].includes(m)) return { ok: false, status: 400, message: 'Pick how many minutes away you are.' };
  const me = await asOwner(owner.userId, async (tx) => {
    const [o] = await tx`select name from wb.owners where user_id = ${owner.userId}`;
    const [b] = await tx`select id from wb.bookings where id = ${id} and status = 'booked'`;
    return { name: (o?.name as string | undefined) ?? '', exists: Boolean(b) };
  });
  if (!me.exists) return { ok: false, status: 404, message: 'Booking not found or not active.' };
  const outcome = await onMyWay(id, me.name.split(' ')[0] || 'Your inspector', m);
  if (outcome === 'no_recipient') return { ok: false, status: 409, message: "They didn't agree to texts. Call them instead." };
  if (outcome === 'opted_out') return { ok: false, status: 409, message: 'They replied STOP to our texts. Call them instead.' };
  if (outcome === 'failed') return { ok: false, status: 502, message: "The text didn't go through. Call them instead." };
  await asOwner(owner.userId, async (tx) => {
    await tx`update wb.bookings set on_my_way_at = now() where id = ${id}`;
    await tx`insert into wb.booking_events (booking_id, actor, kind, detail) values (${id}, ${`owner:${owner.email}`}, 'on_my_way', ${tx.json({ minutes: m })})`;
  });
  return { ok: true, sent: outcome };
}

// ---------- Availability ----------

const Window = z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) });
const Availability = z.object({
  inspectors: z.number().int().min(0).max(20),
  horizonDays: z.number().int().min(1).max(90),
  minNoticeHours: z.number().int().min(0).max(168),
  calendarId: z.string().max(200).default(''),
  week: z.array(z.array(Window).max(8)).length(7), // index 0 = Sunday
});

export async function getAvailability(owner: Owner) {
  return asOwner(owner.userId, async (tx) => {
    const [s] = await tx`select * from wb.settings where id = 1`;
    const windows = await tx`select weekday, to_char(start_time, 'HH24:MI') as start, to_char(end_time, 'HH24:MI') as end from wb.weekly_windows order by weekday, start_time`;
    const daysOff = await tx`select to_char(day, 'YYYY-MM-DD') as day, coalesce(note, '') as note from wb.days_off where day >= current_date order by day`;
    const week: { start: string; end: string }[][] = [[], [], [], [], [], [], []];
    for (const w of windows) week[w.weekday as number]!.push({ start: w.start as string, end: w.end as string });
    return {
      inspectors: s!.inspectors as number,
      horizonDays: s!.horizon_days as number,
      minNoticeHours: s!.min_notice_hours as number,
      calendarId: (s!.calendar_id as string | null) ?? '',
      calendar: {
        status: s!.calendar_status as string,
        error: (s!.calendar_error as string | null) ?? '',
        syncedAt: s!.calendar_synced_at ? iso(s!.calendar_synced_at) : null,
        serviceAccount: serviceAccountEmail(),
        available: calendarApi() !== null,
        // A calendar ID set in Netlify (GOOGLE_CALENDAR_ID) is used when the field here is empty.
        serverId: read('GOOGLE_CALENDAR_ID') ?? '',
      },
      week,
      daysOff: daysOff.map((d) => ({ day: d.day as string, note: d.note as string })),
    };
  });
}

export async function saveAvailability(owner: Owner, input: unknown): Promise<ActionResult> {
  const a = Availability.safeParse(input);
  if (!a.success) return { ok: false, status: 400, message: 'Some availability settings are out of range.' };
  for (const day of a.data.week) {
    const sorted = [...day].sort((x, y) => x.start.localeCompare(y.start));
    for (const [i, w] of sorted.entries()) {
      if (w.end <= w.start) return { ok: false, status: 400, message: `A window ends before it starts (${w.start} to ${w.end}).` };
      const next = sorted[i + 1];
      if (next && next.start < w.end) return { ok: false, status: 400, message: `Two windows overlap (${w.start} and ${next.start}).` };
    }
  }
  await asOwner(owner.userId, async (tx) => {
    await tx`update wb.settings set inspectors = ${a.data.inspectors}, horizon_days = ${a.data.horizonDays},
             min_notice_hours = ${a.data.minNoticeHours}, calendar_id = ${a.data.calendarId.trim() || null}, updated_at = now() where id = 1`;
    await tx`delete from wb.weekly_windows`;
    for (const [weekday, day] of a.data.week.entries()) {
      for (const w of day) {
        await tx`insert into wb.weekly_windows (weekday, start_time, end_time) values (${weekday}, ${w.start}, ${w.end})`;
      }
    }
  });
  return { ok: true };
}

export async function addDayOff(owner: Owner, day: unknown, note: unknown): Promise<ActionResult> {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, status: 400, message: 'Pick a date.' };
  await asOwner(owner.userId, (tx) => tx`insert into wb.days_off (day, note) values (${day}, ${typeof note === 'string' ? note.slice(0, 200) : ''}) on conflict (day) do update set note = excluded.note`);
  return { ok: true };
}

export async function removeDayOff(owner: Owner, day: unknown): Promise<ActionResult> {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, status: 400, message: 'Pick a date.' };
  await asOwner(owner.userId, (tx) => tx`delete from wb.days_off where day = ${day}`);
  return { ok: true };
}

export async function syncNow(owner: Owner) {
  // The owner check already passed; the sync itself runs as the service role.
  void owner;
  return syncCalendar();
}

// ---------- Referral codes ----------

const Referrer = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,20}$/),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['agent', 'property_manager', 'other']),
  company: z.string().trim().max(120).default(''),
  phone: z.string().trim().max(30).default(''),
  email: z.string().trim().max(254).default(''),
  active: z.boolean().default(true),
});

export async function listReferrers(owner: Owner) {
  return asOwner(owner.userId, async (tx) => {
    const rows = await tx`
      select r.*, (select count(*)::int from wb.bookings b where b.referral_code = r.code) as bookings
      from wb.referrers r order by r.active desc, r.name`;
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      kind: r.kind,
      company: r.company ?? '',
      phone: r.phone ?? '',
      email: r.email ?? '',
      active: r.active,
      bookings: r.bookings,
    }));
  });
}

export async function saveReferrer(owner: Owner, input: unknown): Promise<ActionResult> {
  const r = Referrer.safeParse(input);
  if (!r.success) return { ok: false, status: 400, message: 'Codes are 2 to 20 letters and numbers. A name is required.' };
  const v = r.data;
  await asOwner(owner.userId, (tx) => tx`
    insert into wb.referrers (code, name, kind, company, phone, email, active)
    values (${v.code}, ${v.name}, ${v.kind}, ${v.company || null}, ${v.phone || null}, ${v.email || null}, ${v.active})
    on conflict (code) do update set name = excluded.name, kind = excluded.kind, company = excluded.company,
      phone = excluded.phone, email = excluded.email, active = excluded.active`);
  return { ok: true };
}

// ---------- Export ----------

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // Quote everything; neutralize spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function exportCsv(owner: Owner, from: string, to: string): Promise<string> {
  const rows = await asOwner(owner.userId, (tx) => tx`
    select * from wb.booking_list
    where (starts_at at time zone ${TZ})::date between ${from}::date and ${to}::date
    order by starts_at`);
  const header = [
    'Reference', 'Status', 'Date', 'Window', 'Address', 'City', 'ZIP', 'County', 'Name', 'Mobile', 'Email',
    'Relationship', 'Roof material', 'Roof age', 'Reason', 'Notes', 'Someone home', 'Pets', 'Photos', 'Texts OK',
    'Lead source', 'Heard about', 'Referral code', 'Referrer', 'Referrer type', 'Campaign source', 'Campaign medium',
    'Campaign', 'Came from site', 'Via assistant', 'Booked at', 'Cancelled at', 'Cancel reason',
  ];
  const fmtDate = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const lines = rows.map((r) => {
    const utm = (r.utm ?? {}) as Record<string, string>;
    return [
      r.ref, r.status, fmtDate.format(new Date(r.starts_at)),
      `${fmtTime.format(new Date(r.starts_at))} to ${fmtTime.format(new Date(r.ends_at))}`,
      r.address, r.city, r.zip, r.county, r.name, r.mobile, r.email,
      labelOf(RELATIONSHIPS, r.relationship), labelOf(MATERIALS, r.roof_material), labelOf(AGES, r.roof_age),
      labelOf(REASONS, r.reason), r.notes, labelOf(SOMEONE_HOME, r.someone_home), r.pets, r.photos,
      r.sms_consent ? 'Yes' : 'No', r.lead_source, r.heard_about, r.referral_code, r.referrer_name, r.referrer_kind,
      utm.source, utm.medium, utm.campaign, utm.referrer, r.via_assistant ? 'Yes' : 'No',
      new Date(r.created_at).toISOString(), r.cancelled_at ? new Date(r.cancelled_at).toISOString() : '', r.cancel_reason,
    ].map(csvCell).join(',');
  });
  return [header.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n';
}

// ---------- Assistant questions ----------

/** What people asked the assistant in the last 30 days, unanswered ones first. */
export async function questions(owner: Owner) {
  return asOwner(owner.userId, async (tx) => {
    const rows = await tx`
      select asked_at, question, answered, blocked_rule from wb.assistant_questions
      where asked_at > now() - interval '30 days'
      order by answered, asked_at desc limit 200`;
    return rows.map((r) => ({ at: iso(r.asked_at), question: r.question as string, answered: Boolean(r.answered), blocked: (r.blocked_rule as string | null) ?? '' }));
  });
}

// ---------- Me ----------

export async function me(owner: Owner) {
  return asOwner(owner.userId, async (tx) => {
    const [o] = await tx`select name, email, mobile, alert_sms, alert_email from wb.owners where user_id = ${owner.userId}`;
    return { name: o!.name, email: o!.email, mobile: o!.mobile ?? '', alertSms: o!.alert_sms, alertEmail: o!.alert_email };
  });
}

export async function saveMe(owner: Owner, input: unknown): Promise<ActionResult> {
  const v = z
    .object({ mobile: z.string().max(20).default(''), alertSms: z.boolean(), alertEmail: z.boolean() })
    .safeParse(input);
  if (!v.success) return { ok: false, status: 400, message: 'Check your settings.' };
  const digits = v.data.mobile.replace(/\D/g, '');
  const mobile = digits ? `+1${digits.slice(-10)}` : null;
  if (mobile && !/^\+1[2-9]\d{9}$/.test(mobile)) return { ok: false, status: 400, message: 'Enter a 10 digit mobile number.' };
  await asOwner(owner.userId, (tx) => tx`
    update wb.owners set mobile = ${mobile}, alert_sms = ${v.data.alertSms}, alert_email = ${v.data.alertEmail}
    where user_id = ${owner.userId}`);
  return { ok: true };
}
