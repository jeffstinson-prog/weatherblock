// Booking: list open windows, create a booking, and the customer's manage link.
import { z } from 'zod';
import {
  AGES,
  MATERIALS,
  REASONS,
  RELATIONSHIPS,
  SOMEONE_HOME,
  normalizeMobile,
  smsConsentText,
  validateStep,
  type Draft,
  type Errors,
} from '../booking/rules';
import { facts } from '../facts';
import { asPublic, dbErrorCode } from './db';
import { config } from './env';
import { inServiceArea, satelliteByAddress, verifyPlace } from './maps';
import { manageToken, manageUrl, tokenHash } from './tokens';

export interface SlotOut {
  id: string;
  startsAt: string;
  endsAt: string;
}

/** The estimate as the customer sees it, once it's sent. */
export interface CustomerEstimate {
  status: 'sent' | 'accepted' | 'declined';
  amountCents: number | null;
  summary: string;
  hasFile: boolean;
  sentAt: string;
  decidedAt: string | null;
  askedAt: string | null;
  /** The roof's size and pitch (rise per 12), when the estimate states them. */
  roofSqft: number | null;
  roofPitch: number | null;
}

/** The roof job as the customer sees it, once they've said yes. */
export interface CustomerJob {
  status: 'to_schedule' | 'scheduled' | 'done';
  day: string | null;
  doneAt: string | null;
}

export interface BookingSummary {
  id: string;
  ref: string;
  status: 'booked' | 'done' | 'cancelled' | 'no_show';
  startsAt: string;
  endsAt: string;
  address: string;
  firstName: string;
  smsConsent: boolean;
  canChange: boolean;
  estimate?: CustomerEstimate | null;
  job?: CustomerJob | null;
  /** A satellite view of the home, shown with an estimate that states the roof's size. */
  roofPicture?: string | null;
}

export const TIMEZONE = 'America/New_York';

const isoOrNull = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

export function toSummary(row: Record<string, unknown>): BookingSummary {
  const e = row.estimate as Record<string, unknown> | null | undefined;
  const j = row.job as Record<string, unknown> | null | undefined;
  return {
    id: String(row.id),
    ref: String(row.ref),
    status: row.status as BookingSummary['status'],
    startsAt: new Date(String(row.starts_at)).toISOString(),
    endsAt: new Date(String(row.ends_at)).toISOString(),
    address: String(row.address),
    firstName: String(row.first_name ?? ''),
    smsConsent: Boolean(row.sms_consent),
    canChange: Boolean(row.can_change),
    estimate: e
      ? {
          status: e.status as CustomerEstimate['status'],
          amountCents: (e.amount_cents as number | null) ?? null,
          summary: String(e.summary ?? ''),
          hasFile: Boolean(e.has_file),
          sentAt: new Date(String(e.sent_at)).toISOString(),
          decidedAt: isoOrNull(e.decided_at),
          askedAt: isoOrNull(e.asked_at),
          roofSqft: (e.roof_sqft as number | null) ?? null,
          roofPitch: (e.roof_pitch as number | null) ?? null,
        }
      : null,
    job: j ? { status: j.status as CustomerJob['status'], day: (j.day as string | null) ?? null, doneAt: isoOrNull(j.done_at) } : null,
  };
}

export async function openSlots(): Promise<SlotOut[]> {
  return asPublic(async (tx) => {
    const rows = await tx`select slot_id, starts_at, ends_at from wb_api.available_slots()`;
    return rows.map((r) => ({
      id: String(r.slot_id),
      startsAt: new Date(r.starts_at).toISOString(),
      endsAt: new Date(r.ends_at).toISOString(),
    }));
  });
}

/** The open windows closest in time to the one someone wanted. */
export async function nearestSlots(wantedStart: string | null, count = 3): Promise<SlotOut[]> {
  const slots = await openSlots();
  if (!wantedStart) return slots.slice(0, count);
  const t = Date.parse(wantedStart);
  return [...slots].sort((a, b) => Math.abs(Date.parse(a.startsAt) - t) - Math.abs(Date.parse(b.startsAt) - t)).slice(0, count);
}

const values = <T extends readonly { value: string }[]>(list: T) =>
  list.map((o) => o.value) as unknown as [T[number]['value'], ...T[number]['value'][]];

const Body = z.object({
  draftKey: z.uuid(),
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
  relationship: z.enum(values(RELATIONSHIPS)),
  roof: z.object({
    material: z.enum(values(MATERIALS)),
    age: z.enum(values(AGES)),
    reason: z.enum(values(REASONS)),
    notes: z.string().max(2000).default(''),
  }),
  slotId: z.uuid(),
  slotStartsAt: z.string().max(40).optional(),
  visit: z.object({
    someoneHome: z.enum(values(SOMEONE_HOME)),
    gateCode: z.string().max(100).default(''),
    pets: z.string().max(300).default(''),
  }),
  contact: z.object({
    name: z.string().trim().min(1).max(120),
    mobile: z.string().max(30),
    email: z.string().trim().max(254),
    smsConsent: z.boolean(),
  }),
  source: z
    .object({
      heardAbout: z.string().max(60).default(''),
      referralCode: z.string().max(20).default(''),
      utm: z.record(z.string(), z.string().max(200)).default({}),
      viaAssistant: z.boolean().default(false),
    })
    .default({ heardAbout: '', referralCode: '', utm: {}, viaAssistant: false }),
});
export type BookingBody = z.infer<typeof Body>;

const SEARCH_HOSTS = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave)\./;
const SOCIAL_HOSTS = /(^|\.)(facebook|instagram|nextdoor|x|twitter|tiktok|youtube|linkedin|threads)\./;

/** Where a booking came from, in a few words. A valid referral code wins (decided in the database). */
export function leadSource(source: BookingBody['source']): string {
  if (source.viaAssistant) return 'assistant';
  const utm = source.utm;
  if (utm.source) return `${utm.source}${utm.medium ? `_${utm.medium}` : ''}`.toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 40);
  if (source.heardAbout) return `said_${source.heardAbout}`.slice(0, 40);
  if (utm.referrer) {
    const host = utm.referrer.toLowerCase();
    if (SEARCH_HOSTS.test(host)) return 'search';
    if (SOCIAL_HOSTS.test(host)) return 'social';
    return `web_${host.replace(/^www\./, '')}`.slice(0, 40);
  }
  return 'direct';
}

const UTM_KEYS = ['source', 'medium', 'campaign', 'referrer', 'landing'] as const;

export type CreateResult =
  | { ok: true; booking: BookingSummary; token: string; manageUrl: string; existing: boolean; mobile: string; email: string; body: BookingBody }
  | { ok: false; status: number; error: string; message: string; fields?: Errors; alternatives?: SlotOut[] };

export async function createBooking(raw: unknown): Promise<CreateResult> {
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, status: 400, error: 'bad_request', message: 'Some details were missing. Go back through the steps and try again.' };
  }
  const b = parsed.data;

  if (b.website) {
    return { ok: false, status: 400, error: 'bad_request', message: 'Something went wrong. Call us and we\'ll book it for you.' };
  }
  const minMs = Number(process.env.BOT_MIN_SECONDS ?? 4) * 1000;
  if (Date.now() - b.startedAt < minMs) {
    return { ok: false, status: 400, error: 'too_fast', message: 'That was very fast. Check your details and tap Book again.' };
  }

  // Re-check everything with the same rules the page used.
  const draftLike: Draft = {
    draftKey: b.draftKey,
    startedAt: b.startedAt,
    address: { ...b.address, typed: b.address.typed ?? false },
    relationship: b.relationship,
    roof: b.roof,
    photos: [],
    slot: { id: b.slotId, startsAt: b.slotStartsAt ?? '', endsAt: '' },
    visit: b.visit,
    contact: b.contact,
    source: b.source,
  };
  const fields = validateStep('review', draftLike);
  if (Object.keys(fields).length > 0) {
    return { ok: false, status: 422, error: 'invalid', message: 'A few details need fixing.', fields };
  }

  // Trust the map details only if our server signed them.
  const a = b.address;
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
  const email = b.contact.email.trim().toLowerCase();
  const utm: Record<string, string> = {};
  for (const k of UTM_KEYS) if (b.source.utm[k]) utm[k] = b.source.utm[k]!.slice(0, 200);

  const payload = {
    slot_id: b.slotId,
    address: a.text,
    place_id: verified ? a.placeId : '',
    lat: verified ? a.lat : null,
    lng: verified ? a.lng : null,
    county: verified ? a.county : '',
    city: verified ? a.city : '',
    zip: verified && /^\d{5}$/.test(a.zip ?? '') ? a.zip : '',
    relationship: b.relationship,
    roof_material: b.roof.material,
    roof_age: b.roof.age,
    reason: b.roof.reason,
    notes: b.roof.notes.trim(),
    someone_home: b.visit.someoneHome,
    gate_code: b.visit.gateCode.trim(),
    pets: b.visit.pets.trim(),
    name: b.contact.name.trim(),
    mobile,
    email,
    sms_consent: b.contact.smsConsent,
    sms_consent_text: smsConsentText(facts.business.name, facts.texts.maxPerBooking),
    lead_source: leadSource(b.source),
    heard_about: b.source.heardAbout,
    referral_code: b.source.referralCode.trim().toUpperCase(),
    utm,
    via_assistant: b.source.viaAssistant,
  };

  const token = manageToken(b.draftKey);
  try {
    const row = await asPublic(async (tx) => {
      const [r] = await tx`
        select wb_api.create_booking(${tx.json(payload)}, ${tokenHash(token)}, ${b.draftKey}) as booking`;
      return r!.booking as Record<string, unknown>;
    });
    return {
      ok: true,
      booking: toSummary(row),
      token,
      manageUrl: manageUrl(config.siteUrl(), token),
      existing: Boolean(row.existing),
      mobile,
      email,
      body: b,
    };
  } catch (err) {
    const code = dbErrorCode(err);
    if (code === 'slot_full' || code === 'slot_not_offered' || code === 'not_found') {
      return {
        ok: false,
        status: 409,
        error: 'slot_full',
        message: 'That time just filled up. Pick another time. Everything else you entered is saved.',
        alternatives: await nearestSlots(b.slotStartsAt ?? null),
      };
    }
    if (code === 'too_many') {
      return {
        ok: false,
        status: 429,
        error: 'too_many_bookings',
        message: `This number already has 3 upcoming inspections. To change one, use the link in your confirmation, or call ${facts.contact.phone}.`,
      };
    }
    throw err;
  }
}

// The manage link

export type ManageResult =
  | { ok: true; booking: BookingSummary; previousStartsAt?: string }
  | { ok: false; status: number; error: string; message: string; alternatives?: SlotOut[] };

const NOT_FOUND: ManageResult = {
  ok: false,
  status: 404,
  error: 'not_found',
  message: `We couldn't find that booking. The link may be old. Call ${facts.contact.phone} and we'll help.`,
};

export async function getByToken(token: string): Promise<ManageResult> {
  const row = await asPublic(async (tx) => {
    const [r] = await tx`select wb_api.manage_get(${tokenHash(token)}) as booking`;
    return r?.booking as Record<string, unknown> | null;
  });
  if (!row) return NOT_FOUND;
  const booking = toSummary(row);
  // A satellite view of the home goes with an estimate that states the roof's size. Google finds the
  // spot from the address when the picture loads, so no map position is kept for it. Only for an
  // address picked from the list: one typed by hand could land on the wrong house.
  if (booking.estimate?.roofSqft && row.has_place) booking.roofPicture = satelliteByAddress(booking.address);
  return { ok: true, booking };
}

export async function rescheduleByToken(token: string, slotId: string): Promise<ManageResult> {
  const before = await getByToken(token);
  if (!before.ok) return before;
  try {
    const row = await asPublic(async (tx) => {
      const [r] = await tx`select wb_api.manage_reschedule(${tokenHash(token)}, ${slotId}) as booking`;
      return r!.booking as Record<string, unknown>;
    });
    return { ok: true, booking: toSummary(row), previousStartsAt: before.booking.startsAt };
  } catch (err) {
    const code = dbErrorCode(err);
    if (code === 'slot_full' || code === 'slot_not_offered') {
      return {
        ok: false,
        status: 409,
        error: 'slot_full',
        message: 'That time just filled up. Pick another time.',
        alternatives: await nearestSlots(null),
      };
    }
    if (code === 'cannot_change') {
      return { ok: false, status: 409, error: 'cannot_change', message: `This booking can't be changed online anymore. Call ${facts.contact.phone}.` };
    }
    if (code === 'not_found') return NOT_FOUND;
    throw err;
  }
}

export async function cancelByToken(token: string, reason: string): Promise<ManageResult> {
  try {
    const row = await asPublic(async (tx) => {
      const [r] = await tx`select wb_api.manage_cancel(${tokenHash(token)}, ${reason.slice(0, 500)}) as booking`;
      return r!.booking as Record<string, unknown>;
    });
    return { ok: true, booking: toSummary(row) };
  } catch (err) {
    const code = dbErrorCode(err);
    if (code === 'cannot_change') {
      return { ok: false, status: 409, error: 'cannot_change', message: `This booking can't be cancelled online anymore. Call ${facts.contact.phone}.` };
    }
    if (code === 'not_found') return NOT_FOUND;
    throw err;
  }
}
