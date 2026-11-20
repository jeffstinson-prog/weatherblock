// What our texts and emails say. Plain, short, and only facts.
import { facts } from '../../facts';
import { icsText } from '../../booking/calendar';
import { refLabel, shortDay, whenLabel, windowLabel } from '../../booking/format';
import { formatMobile, labelOf, MATERIALS, REASONS, RELATIONSHIPS, AGES, SOMEONE_HOME } from '../../booking/rules';

export interface BookingDetails {
  id: string;
  ref: string;
  startsAt: string;
  endsAt: string;
  address: string;
  name: string;
  mobile: string;
  email: string;
  smsConsent: boolean;
  relationship: string;
  roofMaterial: string;
  roofAge: string;
  reason: string;
  notes: string;
  someoneHome: string;
  hasGateCode: boolean;
  pets: string;
  leadSource: string;
  referralCode: string;
  photos: number;
}

const name = () => facts.business.name;
const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? '';

/** The end of an earlier window of the same length. */
function previousEnd(previousStartsAt: string, b: { startsAt: string; endsAt: string }): string {
  return new Date(Date.parse(previousStartsAt) + (Date.parse(b.endsAt) - Date.parse(b.startsAt))).toISOString();
}

/** "8 to 10 am" becomes "between 8 and 10 am" for sentences. */
function between(startsAt: string, endsAt: string): string {
  return `between ${windowLabel(startsAt, endsAt).replace(' to ', ' and ')}`;
}

// Customer texts. Each ends with how to stop texts, as carriers require.

export function smsConfirmation(b: BookingDetails, manageUrl: string): string {
  return `${name()}: you're booked for ${shortDay(b.startsAt)}, ${windowLabel(b.startsAt, b.endsAt)}. Ref ${refLabel(b.ref)}. Change or cancel: ${manageUrl} Reply STOP to opt out.`;
}

export function smsDayBefore(b: BookingDetails, manageUrl: string): string {
  return `${name()}: reminder, we'll be at your home tomorrow ${between(b.startsAt, b.endsAt)}. Change or cancel: ${manageUrl}`;
}

export function smsMorning(b: BookingDetails): string {
  return `${name()}: see you today ${between(b.startsAt, b.endsAt)}. Questions: ${facts.contact.phone}.`;
}

export function smsOnMyWay(who: string, minutes: number): string {
  return `${name()}: ${who} is on the way. About ${minutes} minutes.`;
}

export function smsRescheduled(b: BookingDetails, manageUrl: string): string {
  return `${name()}: your inspection is now ${shortDay(b.startsAt)}, ${windowLabel(b.startsAt, b.endsAt)}. Ref ${refLabel(b.ref)}. Change or cancel: ${manageUrl}`;
}

export function smsCancelled(b: BookingDetails, siteUrl: string): string {
  return `${name()}: your inspection on ${shortDay(b.startsAt)} is cancelled. To book again: ${siteUrl}/book/`;
}

// Owner alerts.

export function ownerSms(kind: 'new' | 'rescheduled' | 'cancelled', b: BookingDetails, appUrl: string, previousStartsAt?: string): string {
  const when = `${shortDay(b.startsAt)}, ${windowLabel(b.startsAt, b.endsAt)}`;
  const who = `${b.name}, ${formatMobile(b.mobile)}`;
  if (kind === 'new') {
    return `New inspection: ${when}. ${b.address}. ${who}. ${labelOf(REASONS, b.reason)}. ${appUrl}`;
  }
  if (kind === 'rescheduled') {
    const from = previousStartsAt ? `${shortDay(previousStartsAt)}, ${windowLabel(previousStartsAt, previousEnd(previousStartsAt, b))}` : 'another time';
    return `Moved by customer: ${b.address} is now ${when} (was ${from}). ${who}. ${appUrl}`;
  }
  return `Cancelled by customer: ${when}, ${b.address}. ${who}. ${appUrl}`;
}

// Emails: plain HTML that works in every mail app, plus a text version.

export function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function layout(
  siteUrl: string,
  title: string,
  paragraphs: string[],
  button?: { label: string; href: string },
  /** Extra footer lines, already escaped (follow-up emails: how to stop, the mailing address). */
  footer: string[] = [],
): string {
  const p = paragraphs.map((x) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#0f2b3a">${x}</p>`).join('');
  const btn = button
    ? `<p style="margin:20px 0"><a href="${escape(button.href)}" style="display:inline-block;background:#1a6a93;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:999px">${escape(button.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f8f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:14px;padding:24px" cellpadding="0" cellspacing="0"><tr><td>
<img src="${escape(siteUrl)}/brand/logo.png" alt="${escape(name())}" width="150" style="display:block;margin:0 0 16px;height:auto">
<h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;color:#0f2b3a">${escape(title)}</h1>
${p}${btn}
${footer.map((f) => `<p style="margin:16px 0 0;font-size:14px;color:#4a6170">${f}</p>`).join('')}
<p style="margin:24px 0 0;font-size:14px;color:#4a6170">${escape(name())}, ${escape(facts.business.city)}, ${escape(facts.business.state)}. Call or text ${escape(facts.contact.phone)}.</p>
</td></tr></table></td></tr></table></body></html>`;
}

export interface Email {
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: string; contentType: string }[];
}

export function emailConfirmation(b: BookingDetails, manageUrl: string, siteUrl: string): Email {
  const when = whenLabel(b.startsAt, b.endsAt);
  const lines = [
    `Hi ${firstName(b.name)}, you're booked.`,
    `When: ${when}`,
    `Where: ${b.address}`,
    `Reference: ${refLabel(b.ref)}`,
    facts.inspection.byDrone ? 'We inspect your roof by drone during your window.' : '',
    facts.inspection.deliverables ? `You get ${facts.inspection.deliverables}.` : '',
    `To change or cancel, use your private link: ${manageUrl}`,
    `Questions? Call or text ${facts.contact.phone}.`,
  ].filter(Boolean);
  const ics = icsText({
    ref: refLabel(b.ref),
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    title: `Roof inspection: ${name()}`,
    location: b.address,
    description: `Reference ${refLabel(b.ref)}. Questions: ${facts.contact.phone}. Change or cancel: ${manageUrl}`,
    domain: facts.web.domain,
  });
  return {
    subject: `Your roof inspection: ${shortDay(b.startsAt)}, ${windowLabel(b.startsAt, b.endsAt)}`,
    text: lines.join('\n\n'),
    html: layout(
      siteUrl,
      "You're booked",
      [
        `Hi ${escape(firstName(b.name))},`,
        `<strong>When:</strong> ${escape(when)}<br><strong>Where:</strong> ${escape(b.address)}<br><strong>Reference:</strong> ${escape(refLabel(b.ref))}`,
        facts.inspection.byDrone ? 'We inspect your roof by drone during your window.' : '',
        facts.inspection.deliverables ? `You get ${escape(facts.inspection.deliverables)}.` : '',
        'The attached calendar file adds the visit to your calendar. Keep your private link below to change or cancel. Anyone with the link can change this booking.',
      ].filter(Boolean),
      { label: 'Change or cancel', href: manageUrl },
    ),
    attachments: [{ filename: 'roof-inspection.ics', content: Buffer.from(ics).toString('base64'), contentType: 'text/calendar' }],
  };
}

export function emailDayBefore(b: BookingDetails, manageUrl: string, siteUrl: string): Email {
  const when = whenLabel(b.startsAt, b.endsAt);
  return {
    subject: `Tomorrow: your roof inspection, ${windowLabel(b.startsAt, b.endsAt)}`,
    text: [`Hi ${firstName(b.name)}, a reminder: we'll be at ${b.address} tomorrow, ${between(b.startsAt, b.endsAt)}.`, `Change or cancel: ${manageUrl}`, `Questions? ${facts.contact.phone}.`].join('\n\n'),
    html: layout(siteUrl, 'See you tomorrow', [`Hi ${escape(firstName(b.name))}, a reminder: we'll be at ${escape(b.address)} on ${escape(when)}.`], {
      label: 'Change or cancel',
      href: manageUrl,
    }),
  };
}

export function emailRescheduled(b: BookingDetails, manageUrl: string, siteUrl: string): Email {
  const when = whenLabel(b.startsAt, b.endsAt);
  return {
    subject: `New time for your roof inspection: ${shortDay(b.startsAt)}, ${windowLabel(b.startsAt, b.endsAt)}`,
    text: [`Hi ${firstName(b.name)}, your inspection is now ${when}.`, `Where: ${b.address}`, `Reference: ${refLabel(b.ref)}`, `Change or cancel: ${manageUrl}`].join('\n\n'),
    html: layout(siteUrl, 'Your new time', [`Hi ${escape(firstName(b.name))}, your inspection is now <strong>${escape(when)}</strong> at ${escape(b.address)}.`, `Reference: ${escape(refLabel(b.ref))}`], {
      label: 'Change or cancel',
      href: manageUrl,
    }),
  };
}

export function emailCancelled(b: BookingDetails, siteUrl: string): Email {
  return {
    subject: 'Your roof inspection is cancelled',
    text: [`Hi ${firstName(b.name)}, your inspection on ${whenLabel(b.startsAt, b.endsAt)} is cancelled.`, `To book again: ${siteUrl}/book/`].join('\n\n'),
    html: layout(siteUrl, 'Cancelled', [`Hi ${escape(firstName(b.name))}, your inspection on ${escape(whenLabel(b.startsAt, b.endsAt))} is cancelled.`], {
      label: facts.derived.bookLabel,
      href: `${siteUrl}/book/`,
    }),
  };
}

export function emailOwner(kind: 'new' | 'rescheduled' | 'cancelled', b: BookingDetails, appUrl: string, siteUrl: string, previousStartsAt?: string): Email {
  const when = whenLabel(b.startsAt, b.endsAt);
  const heading = kind === 'new' ? 'New inspection' : kind === 'rescheduled' ? 'Moved by the customer' : 'Cancelled by the customer';
  const facts_ = [
    ['When', when + (previousStartsAt ? ` (was ${whenLabel(previousStartsAt, previousEnd(previousStartsAt, b))})` : '')],
    ['Where', b.address],
    ['Customer', `${b.name}, ${formatMobile(b.mobile)}, ${b.email}`],
    ['Their home?', labelOf(RELATIONSHIPS, b.relationship)],
    ['Roof', `${labelOf(MATERIALS, b.roofMaterial)}, ${labelOf(AGES, b.roofAge).toLowerCase()}`],
    ['Why', labelOf(REASONS, b.reason)],
    ['Notes', b.notes || 'None'],
    ['Someone home', labelOf(SOMEONE_HOME, b.someoneHome)],
    ['Gate code', b.hasGateCode ? 'Yes, in the app' : 'No'],
    ['Pets', b.pets || 'None mentioned'],
    ['Photos', String(b.photos)],
    ['Texts OK', b.smsConsent ? 'Yes' : 'No'],
    ['Source', b.referralCode ? `${b.leadSource} (${b.referralCode})` : b.leadSource],
    ['Reference', refLabel(b.ref)],
  ];
  return {
    subject: `${heading}: ${shortDay(b.startsAt)}, ${windowLabel(b.startsAt, b.endsAt)}, ${b.address}`,
    text: [heading, ...facts_.map(([k, v]) => `${k}: ${v}`), `Open in the app: ${appUrl}`].join('\n'),
    html: layout(
      siteUrl,
      heading,
      [facts_.map(([k, v]) => `<strong>${escape(k!)}:</strong> ${escape(v!)}`).join('<br>')],
      { label: 'Open in the app', href: appUrl },
    ),
  };
}
