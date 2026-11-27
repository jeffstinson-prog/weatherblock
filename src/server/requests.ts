// Estimate requests: someone asks for an estimate on /estimate/.
//   1. The request is saved, so it can't be lost.
//   2. The roof is measured from above (for the owners).
//   3. The owners hear about it right away, so one of them can call.
//   4. If the customer books a visit, the request is tied to that booking and
//      its roof sheet travels along, for the written estimate.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { normalizeMobile } from '../booking/rules';
import { validateRequest } from '../estimate/rules';
import { facts } from '../facts';
import type { Owner } from './auth';
import { leadSource } from './booking';
import { asOwner, asPublic, asService, dbErrorCode } from './db';
import { config } from './env';
import { details, inServiceArea, roofImageUrl, satelliteByAddress, signPlace, verifyPlace, type CheckedPlace } from './maps';
import { send } from './messaging/send';
import * as t from './messaging/request-templates';
import { ownerRecipients } from './notify';
import { pushNewRequest, pushRequestReminder } from './messaging/push-templates';
import { pushToOwners } from './push';
import { local } from './reminders';
import { asRoofSheet, customerBallpark, measureRoof, roofSummary, type RoofSheet } from './roofsheet';
import { requestToken, requestUrl, tokenHash } from './tokens';

const iso = (v: unknown) => new Date(String(v)).toISOString();
const isoOrNull = (v: unknown) => (v ? iso(v) : null);

const Body = z.object({
  key: z.uuid(),
  startedAt: z.number().int(),
  website: z.string().max(200).optional(), // honeypot: people never see it, bots fill it in
  address: z.object({
    text: z.string().trim().min(5).max(300),
    placeId: z.string().max(300).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    county: z.string().max(80).optional(),
    city: z.string().max(80).optional(),
    zip: z.string().max(10).optional(),
    state: z.string().max(2).optional(),
    typed: z.boolean().optional(),
    sig: z.string().max(100).optional(),
  }),
  contact: z.object({
    name: z.string().trim().max(120),
    mobile: z.string().max(30),
    email: z.string().trim().max(254).default(''),
  }),
  source: z
    .object({ utm: z.record(z.string(), z.string().max(200)).default({}) })
    .default({ utm: {} }),
});

const UTM_KEYS = ['source', 'medium', 'campaign', 'referrer', 'landing'] as const;

export type Ballpark = { low: string; high: string; material: string };

export type CreateRequestResult =
  | { ok: true; ref: string; firstName: string; mobile: string; existing: boolean; ballpark: Ballpark | null }
  | { ok: false; status: number; error: string; message: string; fields?: Record<string, string> };

export async function createRequest(raw: unknown): Promise<CreateRequestResult> {
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, status: 400, error: 'bad_request', message: 'Some details were missing. Check the form and try again.' };
  }
  const b = parsed.data;
  if (b.website) {
    return { ok: false, status: 400, error: 'bad_request', message: `Something went wrong. Call us at ${facts.contact.phone}.` };
  }
  const minMs = Number(process.env.BOT_MIN_SECONDS ?? 4) * 1000;
  if (Date.now() - b.startedAt < minMs) {
    return { ok: false, status: 400, error: 'too_fast', message: 'That was very fast. Check your details and send it again.' };
  }

  // Re-check everything with the same rules the page used.
  const a = b.address;
  const fields = validateRequest({ address: { text: a.text, placeId: a.placeId, typed: a.typed ?? false }, contact: b.contact });
  if (Object.keys(fields).length > 0) {
    return { ok: false, status: 422, error: 'invalid', message: 'A few details need fixing.', fields };
  }

  // Trust the map details only if our server signed them.
  const verified = a.placeId ? verifyPlace({ ...a, county: a.county ?? '', city: a.city ?? '', zip: a.zip ?? '', state: a.state ?? '' }) : false;
  if (a.placeId && !verified) {
    return { ok: false, status: 422, error: 'invalid', message: 'Pick your address from the list again.', fields: { address: 'Pick your address from the list again.' } };
  }
  if (verified && !inServiceArea({ county: a.county ?? '', state: a.state ?? '' })) {
    return {
      ok: false,
      status: 422,
      error: 'out_of_area',
      message: `We serve ${facts.serviceArea.summary}. Call us at ${facts.contact.phone} if you think that's wrong.`,
      fields: { address: `That address is outside our area. We serve ${facts.serviceArea.short}.` },
    };
  }

  const mobile = normalizeMobile(b.contact.mobile)!;
  const utm: Record<string, string> = {};
  for (const k of UTM_KEYS) if (b.source.utm[k]) utm[k] = b.source.utm[k]!.slice(0, 200);
  const payload = {
    address: a.text,
    place_id: verified ? a.placeId : '',
    lat: verified ? a.lat : null,
    lng: verified ? a.lng : null,
    county: verified ? a.county : '',
    city: verified ? a.city : '',
    zip: verified && /^\d{5}$/.test(a.zip ?? '') ? a.zip : '',
    state: verified ? a.state : '',
    name: b.contact.name.trim(),
    mobile,
    email: b.contact.email.trim().toLowerCase(),
    lead_source: leadSource({ heardAbout: '', referralCode: '', utm, viaAssistant: false }),
    utm,
  };

  const token = requestToken(b.key);
  let row: { id: string; ref: string; existing: boolean };
  try {
    row = await asPublic(async (tx) => {
      const [r] = await tx`select wb_api.create_estimate_request(${tx.json(payload)}, ${tokenHash(token)}, ${b.key}) as r`;
      return r!.r as { id: string; ref: string; existing: boolean };
    });
  } catch (err) {
    if (dbErrorCode(err) === 'too_many') {
      return {
        ok: false,
        status: 429,
        error: 'too_many',
        message: `We already have your requests from today. Call or text ${facts.contact.phone} and we'll help right away.`,
      };
    }
    throw err;
  }

  const firstName = payload.name.split(/\s+/)[0] ?? '';
  if (row.existing) {
    // A double tap, or the same person asking again today: nothing new to measure or send.
    const [saved] = await asService((tx) => tx`select roof from wb.estimate_requests where id = ${row.id}`);
    return { ok: true, ref: row.ref, firstName, mobile, existing: true, ballpark: customerBallpark(asRoofSheet(saved?.roof)) };
  }

  // The request is safe in the database. Measuring and alerting must never undo it.
  let roof: RoofSheet | null = null;
  try {
    if (verified && typeof a.lat === 'number' && typeof a.lng === 'number') {
      roof = await measureRoof(a.lat, a.lng);
      if (roof) {
        await asService((tx) => tx`update wb.estimate_requests set roof = ${tx.json(roof as never)}, roof_measured_at = now() where id = ${row.id}`);
      }
    }
  } catch (err) {
    console.error('roof measurement failed', err);
  }
  try {
    await requestCreated(
      { id: row.id, ref: row.ref, name: payload.name, mobile, email: payload.email, address: payload.address, leadSource: payload.lead_source, createdAt: new Date().toISOString(), roof },
      requestUrl(config.siteUrl(), token),
    );
  } catch (err) {
    console.error('request alert failed', err);
  }
  return { ok: true, ref: row.ref, firstName, mobile, existing: false, ballpark: customerBallpark(roof) };
}

/** The owners hear first. The customer gets a copy by email when they gave one. */
async function requestCreated(r: t.RequestDetails, link: string): Promise<void> {
  const site = config.siteUrl();
  const appUrl = `${site}/app/#/request/${r.id}`;
  const email = t.ownerRequestEmail(r, appUrl, site);
  const text = t.ownerRequestSms(r, appUrl);
  const jobs: Promise<unknown>[] = [pushToOwners(pushNewRequest(r))];
  for (const o of await ownerRecipients()) {
    if (o.email) jobs.push(send({ requestId: r.id, channel: 'email', audience: 'owner', kind: 'owner_request', to: o.email, ...email, dedupeKey: `request:${r.id}:${o.email}` }));
    if (o.mobile) jobs.push(send({ requestId: r.id, channel: 'sms', audience: 'owner', kind: 'owner_request', to: o.mobile, text, dedupeKey: `request:${r.id}:${o.mobile}` }));
  }
  if (r.email) {
    jobs.push(
      send({
        requestId: r.id,
        channel: 'email',
        audience: 'customer',
        kind: 'request_received',
        to: r.email,
        ...t.emailRequestReceived(r, link, site, customerBallpark(r.roof)),
        dedupeKey: `request_received:${r.id}`,
      }),
    );
  }
  await Promise.allSettled(jobs);
}

// The customer's link: what they already told us, for the booking form.

export interface RequestPrefill {
  /** The address, signed again when we still have its map position; otherwise as typed. */
  place: CheckedPlace | { text: string; typed: true };
  contact: { name: string; mobile: string; email: string };
}

function placeFrom(r: Record<string, unknown>): RequestPrefill['place'] {
  if (r.place_id && typeof r.lat === 'number' && typeof r.lng === 'number') {
    return signPlace({
      placeId: String(r.place_id),
      text: String(r.address),
      lat: r.lat,
      lng: r.lng,
      county: String(r.county ?? ''),
      city: String(r.city ?? ''),
      zip: String(r.zip ?? ''),
      state: String(r.state ?? ''),
    });
  }
  return { text: String(r.address), typed: true };
}

export async function requestForBooking(token: string): Promise<RequestPrefill | null> {
  const [row] = await asPublic((tx) => tx`select wb_api.estimate_request_get(${tokenHash(token)}) as r`);
  const r = row?.r as Record<string, unknown> | null | undefined;
  if (!r) return null;
  return { place: placeFrom(r), contact: { name: String(r.name), mobile: String(r.mobile), email: String(r.email ?? '') } };
}

// A booking was made: tie it to the request it came from, and give it a roof sheet.

// The same mobile number is what ties them: the booking form starts with the request's number
// filled in. (Matching on the address too would tie a neighbor's or a new owner's booking to
// someone else's request.)

export async function attachToBooking(b: { id: string; mobile: string; lat: number | null; lng: number | null }): Promise<void> {
  const linked = await asService(async (tx) => {
    const [r] = await tx`
      update wb.estimate_requests r set booking_id = ${b.id}, status = 'booked'
      where r.id = (
        select id from wb.estimate_requests
        where status in ('new', 'called') and booking_id is null and created_at > now() - interval '60 days'
          and mobile = ${b.mobile}
        order by created_at desc
        limit 1
      )
      returning r.roof, r.roof_measured_at, r.lead_source, r.utm`;
    if (r) {
      // The request knows where they came from (an ad, a search). A booking made later, or by an owner on the phone, doesn't.
      await tx`update wb.bookings set lead_source = ${r.lead_source}, utm = ${tx.json(r.utm as never)} where id = ${b.id} and lead_source = 'direct'`;
    }
    return r;
  });
  let roof = asRoofSheet(linked?.roof);
  let measuredAt: Date | null = roof && linked?.roof_measured_at ? new Date(linked.roof_measured_at) : null;
  if (!roof && b.lat !== null && b.lng !== null) {
    roof = await measureRoof(b.lat, b.lng);
    measuredAt = new Date();
  }
  if (roof) {
    await asService((tx) => tx`update wb.bookings set roof = ${tx.json(roof as never)}, roof_measured_at = ${measuredAt ?? new Date()} where id = ${b.id}`);
  }
}

// The owner app.

export type ActionResult = { ok: true } | { ok: false; status: number; message: string };

function listRow(r: Record<string, unknown>) {
  return {
    id: r.id as string,
    ref: r.ref as string,
    status: r.status as 'new' | 'called' | 'booked' | 'closed',
    name: r.name as string,
    mobile: r.mobile as string,
    address: r.address as string,
    createdAt: iso(r.created_at),
    calledAt: isoOrNull(r.called_at),
    bookingId: (r.booking_id as string | null) ?? null,
    roof: roofSummary(asRoofSheet(r.roof)),
  };
}

/** Open requests first (the oldest uncalled at the top), then what was booked or closed in the last 30 days. */
export async function listRequests(owner: Owner) {
  return asOwner(owner.userId, async (tx) => {
    const open = await tx`
      select * from wb.estimate_requests where status in ('new', 'called')
      order by (status = 'new') desc, created_at limit 200`;
    const recent = await tx`
      select * from wb.estimate_requests where status in ('booked', 'closed') and updated_at > now() - interval '30 days'
      order by updated_at desc limit 100`;
    return {
      toCall: open.filter((r) => r.status === 'new').map(listRow),
      called: open.filter((r) => r.status === 'called').map(listRow),
      booked: recent.filter((r) => r.status === 'booked').map(listRow),
      closed: recent.filter((r) => r.status === 'closed').map(listRow),
    };
  });
}

export async function requestDetail(owner: Owner, id: string) {
  const found = await asOwner(owner.userId, async (tx) => {
    const [r] = await tx`select * from wb.estimate_requests where id = ${id}`;
    if (!r) return null;
    const messages = await tx`
      select created_at, channel, audience, kind, status, to_addr, coalesce(subject, body) as summary
      from wb.messages where request_id = ${id} order by created_at`;
    return { r, messages };
  });
  if (!found) return null;
  const { r, messages } = found;
  const roof = asRoofSheet(r.roof);
  return {
    ...listRow(r),
    email: (r.email as string | null) ?? '',
    lat: (r.lat as number | null) ?? null,
    lng: (r.lng as number | null) ?? null,
    leadSource: r.lead_source as string,
    ownerNotes: (r.owner_notes as string | null) ?? '',
    closeReason: (r.close_reason as string | null) ?? '',
    remindedAt: isoOrNull(r.reminded_at),
    roofSheet: roof,
    // A close picture with the measured roof outlined when we have it; otherwise the satellite view of the address.
    picture: roof?.box ? roofImageUrl(roof.box) : satelliteByAddress(r.address as string),
    canMeasure: Boolean(r.place_id),
    // For "Book a time for them" and "Text them the link".
    prefill: { place: placeFrom(r), contact: { name: r.name as string, mobile: r.mobile as string, email: (r.email as string | null) ?? '' } } satisfies RequestPrefill,
    link: requestUrl(config.siteUrl(), requestToken(r.idempotency_key as string)),
    messages: messages.map((m) => ({
      at: iso(m.created_at),
      channel: m.channel as string,
      audience: m.audience as string,
      kind: m.kind as string,
      status: m.status as string,
      to: m.to_addr as string,
      summary: String(m.summary).slice(0, 300),
    })),
  };
}

const RequestStatus = z.enum(['new', 'called', 'closed']);

/** Called, not interested (closed), or back to "to call". "Booked" is set when a booking comes in. */
export async function setRequestStatus(owner: Owner, id: string, status: unknown, reason: unknown): Promise<ActionResult> {
  const s = RequestStatus.safeParse(status);
  if (!s.success) return { ok: false, status: 400, message: 'Pick a status.' };
  const why = typeof reason === 'string' ? reason.trim().slice(0, 200) : '';
  const done = await asOwner(
    owner.userId,
    (tx) => tx`
      update wb.estimate_requests set
        status = ${s.data},
        called_at = case when ${s.data} = 'called' then coalesce(called_at, now()) when ${s.data} = 'new' then null else called_at end,
        closed_at = case when ${s.data} = 'closed' then now() else null end,
        close_reason = case when ${s.data} = 'closed' then ${why || null} else null end
      where id = ${id} returning id`,
  );
  return done.length ? { ok: true } : { ok: false, status: 404, message: 'Request not found.' };
}

export async function setRequestNotes(owner: Owner, id: string, notes: unknown): Promise<ActionResult> {
  if (typeof notes !== 'string' || notes.length > 5000) return { ok: false, status: 400, message: 'Notes are too long.' };
  const done = await asOwner(owner.userId, (tx) => tx`update wb.estimate_requests set owner_notes = ${notes} where id = ${id} returning id`);
  return done.length ? { ok: true } : { ok: false, status: 404, message: 'Request not found.' };
}

/** Measure the roof again: Google's data is only kept for 30 days, and a first try can fail. */
export async function remeasureRequest(owner: Owner, id: string): Promise<ActionResult> {
  const [r] = await asOwner(owner.userId, (tx) => tx`select place_id, lat, lng from wb.estimate_requests where id = ${id}`);
  if (!r) return { ok: false, status: 404, message: 'Request not found.' };
  let at: { lat: number; lng: number } | null = typeof r.lat === 'number' && typeof r.lng === 'number' ? { lat: r.lat, lng: r.lng } : null;
  if (!at && r.place_id) {
    const place = await details(r.place_id as string, randomUUID()).catch(() => null);
    if (place) at = { lat: place.lat, lng: place.lng };
  }
  if (!at) return { ok: false, status: 409, message: "This address was typed by hand, so there's no spot on the map to measure. Measure it at the visit." };
  const spot = at;
  // The owner is waiting on the screen, and nobody else is: give Google a little longer.
  const roof = await measureRoof(spot.lat, spot.lng, 9000);
  if (!roof) return { ok: false, status: 409, message: 'No roof data for this address. Measure it at the visit.' };
  await asOwner(
    owner.userId,
    (tx) => tx`update wb.estimate_requests set roof = ${tx.json(roof as never)}, roof_measured_at = now() where id = ${id}`,
  );
  return { ok: true };
}

// The scheduled job: one nudge when a request has waited half an hour without a call.

export async function runRequestReminders(now = new Date()): Promise<number> {
  const l = local(now);
  if (l.minutes < 8 * 60 || l.minutes >= 20 * 60) return 0;
  const rows = await asService(
    (tx) => tx`
      update wb.estimate_requests set reminded_at = ${now}
      where status = 'new' and reminded_at is null
        and created_at < ${new Date(now.getTime() - 30 * 60_000)} and created_at > ${new Date(now.getTime() - 24 * 3_600_000)}
      returning id, ref, name, mobile, email, address, lead_source, created_at, roof`,
  );
  if (rows.length === 0) return 0;
  const owners = await ownerRecipients();
  const site = config.siteUrl();
  let sent = 0;
  for (const r of rows) {
    const d: t.RequestDetails = {
      id: r.id,
      ref: r.ref,
      name: r.name,
      mobile: r.mobile,
      email: r.email ?? '',
      address: r.address,
      leadSource: r.lead_source,
      createdAt: iso(r.created_at),
      roof: asRoofSheet(r.roof),
    };
    const minutes = (now.getTime() - new Date(r.created_at).getTime()) / 60_000;
    const text = t.ownerRequestReminderSms(d, `${site}/app/#/request/${r.id}`, minutes);
    const pinged = await pushToOwners(pushRequestReminder(d, minutes));
    const outcomes = await Promise.all(
      owners
        .filter((o) => o.mobile)
        .map((o) => send({ requestId: r.id, channel: 'sms', audience: 'owner', kind: 'owner_request_reminder', to: o.mobile!, text, dedupeKey: `request_reminder:${r.id}:${o.mobile}` })),
    );
    if (pinged > 0 || outcomes.some((o) => o === 'sent' || o === 'logged')) sent++;
  }
  return sent;
}
