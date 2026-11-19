// Who hears about a booking, and how.
//   Customer: email always; texts only if they agreed and haven't replied STOP.
//   Owners: a text and an email each, as set in the owner app. Until owners
//   are set up, alerts go to the business email in facts.yaml.
import { facts } from '../facts';
import type { BookingSummary } from './booking';
import { asService } from './db';
import { config } from './env';
import { manageToken, manageUrl } from './tokens';
import { send, type Outcome } from './messaging/send';
import {
  emailCancelled,
  emailConfirmation,
  emailOwner,
  emailRescheduled,
  ownerSms,
  smsCancelled,
  smsConfirmation,
  smsOnMyWay,
  smsRescheduled,
  type BookingDetails,
} from './messaging/templates';

export interface Notified {
  email: boolean;
  sms: boolean;
}

export async function loadDetails(bookingId: string): Promise<(BookingDetails & { slotId: string; draftKey: string }) | null> {
  const rows = await asService(
    (tx) => tx`
      select b.id, b.ref, s.starts_at, s.ends_at, s.id as slot_id, b.address, b.name, b.mobile, b.email, b.sms_consent,
             b.relationship, b.roof_material, b.roof_age, b.reason, coalesce(b.notes, '') as notes, b.someone_home,
             b.gate_code is not null as has_gate_code, coalesce(b.pets, '') as pets, b.lead_source,
             coalesce(b.referral_code, '') as referral_code, b.idempotency_key,
             (select count(*)::int from wb.booking_photos p where p.booking_id = b.id) as photos
      from wb.bookings b join wb.slots s on s.id = b.slot_id
      where b.id = ${bookingId}`,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    ref: r.ref,
    startsAt: new Date(r.starts_at).toISOString(),
    endsAt: new Date(r.ends_at).toISOString(),
    slotId: r.slot_id,
    draftKey: r.idempotency_key,
    address: r.address,
    name: r.name,
    mobile: r.mobile,
    email: r.email,
    smsConsent: r.sms_consent,
    relationship: r.relationship,
    roofMaterial: r.roof_material,
    roofAge: r.roof_age,
    reason: r.reason,
    notes: r.notes,
    someoneHome: r.someone_home,
    hasGateCode: r.has_gate_code,
    pets: r.pets,
    leadSource: r.lead_source,
    referralCode: r.referral_code,
    photos: r.photos,
  };
}

interface Recipient {
  name: string;
  email: string | null;
  mobile: string | null;
}

export async function ownerRecipients(): Promise<Recipient[]> {
  const rows = await asService(
    (tx) => tx`select name, case when alert_email then email end as email, case when alert_sms then mobile end as mobile
               from wb.owners where active order by created_at`,
  );
  if (rows.length > 0) return rows.map((r) => ({ name: r.name, email: r.email, mobile: r.mobile }));
  return facts.contact.email ? [{ name: facts.business.name, email: facts.contact.email, mobile: null }] : [];
}

const counts = (o: Outcome) => o === 'sent';

async function alertOwners(kind: 'new' | 'rescheduled' | 'cancelled', b: BookingDetails, previousStartsAt?: string) {
  const site = config.siteUrl();
  const appUrl = `${site}/app/#/booking/${b.id}`;
  const email = emailOwner(kind, b, appUrl, site, previousStartsAt);
  const text = ownerSms(kind, b, appUrl, previousStartsAt);
  const jobs: Promise<Outcome>[] = [];
  for (const r of await ownerRecipients()) {
    if (r.email) jobs.push(send({ bookingId: b.id, channel: 'email', audience: 'owner', kind: `owner_${kind}`, to: r.email, ...email }));
    if (r.mobile) jobs.push(send({ bookingId: b.id, channel: 'sms', audience: 'owner', kind: `owner_${kind}`, to: r.mobile, text }));
  }
  await Promise.allSettled(jobs);
}

export async function bookingCreated(booking: BookingSummary, link: string): Promise<Notified> {
  const b = await loadDetails(booking.id);
  if (!b) return { email: false, sms: false };
  const site = config.siteUrl();
  const email = emailConfirmation(b, link, site);
  const [emailOutcome, smsOutcome] = await Promise.all([
    send({ bookingId: b.id, channel: 'email', audience: 'customer', kind: 'confirmation', to: b.email, ...email, dedupeKey: `confirmation:email:${b.id}` }),
    b.smsConsent
      ? send({ bookingId: b.id, channel: 'sms', audience: 'customer', kind: 'confirmation', to: b.mobile, text: smsConfirmation(b, link), dedupeKey: `confirmation:sms:${b.id}` })
      : Promise.resolve<Outcome>('no_recipient'),
    alertOwners('new', b),
  ]);
  return { email: counts(emailOutcome), sms: counts(smsOutcome) };
}

export async function bookingChanged(
  booking: BookingSummary,
  kind: 'rescheduled' | 'cancelled',
  opts: { previousStartsAt?: string; byOwner?: boolean } = {},
): Promise<void> {
  const b = await loadDetails(booking.id);
  if (!b) return;
  const site = config.siteUrl();
  const link = manageUrl(site, manageToken(b.draftKey));
  const email = kind === 'rescheduled' ? emailRescheduled(b, link, site) : emailCancelled(b, site);
  const text = kind === 'rescheduled' ? smsRescheduled(b, link) : smsCancelled(b, site);
  const key = `${kind}:${b.id}:${b.slotId}:${Date.now()}`;
  await Promise.allSettled([
    send({ bookingId: b.id, channel: 'email', audience: 'customer', kind, to: b.email, ...email, dedupeKey: `${key}:email` }),
    b.smsConsent ? send({ bookingId: b.id, channel: 'sms', audience: 'customer', kind, to: b.mobile, text, dedupeKey: `${key}:sms` }) : Promise.resolve(),
    // When the customer made the change, tell the owners. When an owner did, they already know.
    opts.byOwner ? Promise.resolve() : alertOwners(kind, b, opts.previousStartsAt),
  ]);
}

/** The inspector taps "On my way" in the owner app. Texts only if the customer agreed to texts. */
export async function onMyWay(bookingId: string, who: string, minutes: number): Promise<Outcome> {
  const b = await loadDetails(bookingId);
  if (!b) return 'no_recipient';
  if (!b.smsConsent) return 'no_recipient';
  return send({ bookingId: b.id, channel: 'sms', audience: 'customer', kind: 'on_my_way', to: b.mobile, text: smsOnMyWay(who, minutes) });
}
