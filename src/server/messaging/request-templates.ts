// What the owners and the customer hear when someone asks for an estimate.
// Plain, short, and only facts. The owners' messages carry the roof's size and
// a ballpark; the customer's carry no price unless the facts file says to show one.
import { facts } from '../../facts';
import { formatMobile } from '../../booking/rules';
import { imageryMonth, roofSummary, type RoofSheet } from '../roofsheet';
import { escape, layout, type Email } from './templates';

export interface RequestDetails {
  id: string;
  ref: string;
  name: string;
  mobile: string;
  email: string;
  address: string;
  leadSource: string;
  createdAt: string;
  roof: RoofSheet | null;
}

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? '';
const refLabel = (ref: string) => (ref.length === 6 ? `${ref.slice(0, 3)}-${ref.slice(3)}` : ref);

/** "12 minutes", "3 hours", "a day": how long a request has waited. */
export function waited(minutes: number): string {
  if (minutes < 90) {
    const n = Math.max(1, Math.round(minutes));
    return n === 1 ? '1 minute' : `${n} minutes`;
  }
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} hours` : 'a day';
}

// The owners.

export function ownerRequestSms(r: RequestDetails, appUrl: string): string {
  return `Estimate request: ${r.name}, ${formatMobile(r.mobile)}. ${r.address}. ${roofSummary(r.roof)} Call them, then open: ${appUrl}`;
}

export function ownerRequestReminderSms(r: RequestDetails, appUrl: string, minutesWaiting: number): string {
  return `Still to call: ${r.name}, ${formatMobile(r.mobile)}, asked for an estimate ${waited(minutesWaiting)} ago. ${appUrl}`;
}

export function ownerRequestEmail(r: RequestDetails, appUrl: string, siteUrl: string): Email {
  const roof = r.roof;
  const rows: [string, string][] = [
    ['Customer', [r.name, formatMobile(r.mobile), r.email].filter(Boolean).join(', ')],
    ['Home', r.address],
    ['Roof', roofSummary(roof)],
    ...(roof?.source === 'google' && roof.imageryDate ? [['Measured from', `Google's aerial imagery, ${imageryMonth(roof.imageryDate)}`] as [string, string]] : []),
    ...(roof?.source === 'google' ? [['With waste', `Up to ${roof.squares[1]} squares`] as [string, string]] : []),
    ['Source', r.leadSource],
    ['Reference', refLabel(r.ref)],
  ];
  const next = 'Call them to set up the visit. Then mark the request called in the app, or book a time for them from there.';
  return {
    subject: `Estimate request: ${r.name}, ${r.address}`,
    text: ['New estimate request', ...rows.map(([k, v]) => `${k}: ${v}`), next, `Open in the app: ${appUrl}`].join('\n'),
    html: layout(
      siteUrl,
      'New estimate request',
      [rows.map(([k, v]) => `<strong>${escape(k)}:</strong> ${escape(v)}`).join('<br>'), escape(next)],
      { label: 'Open in the app', href: appUrl },
    ),
  };
}

// The customer: a copy of what they asked for, and a link to pick a time themselves.

export function emailRequestReceived(
  r: RequestDetails,
  link: string,
  siteUrl: string,
  ballpark: { low: string; high: string; material: string } | null,
): Email {
  const free = facts.inspection.free ? 'free ' : '';
  const lines = [
    `Hi ${firstName(r.name)}, we got your request for a ${free}roof estimate at ${r.address}.`,
    `One of us will call you ${facts.derived.estimateCallback} at ${formatMobile(r.mobile)} to set it up.`,
    ballpark
      ? `Your ballpark for a new roof with ${ballpark.material}: ${ballpark.low} to ${ballpark.high}. A rough guide, not a quote. Your price is the one in your written estimate.`
      : '',
    `Rather pick a time yourself? Use this link: ${link}`,
    `Questions? Call or text ${facts.contact.phone}. Reference ${refLabel(r.ref)}.`,
  ].filter(Boolean);
  return {
    subject: 'We got your estimate request',
    text: lines.join('\n\n'),
    html: layout(
      siteUrl,
      'We got your request',
      [
        `Hi ${escape(firstName(r.name))}, we got your request for a ${free}roof estimate at ${escape(r.address)}.`,
        `One of us will call you ${escape(facts.derived.estimateCallback)} at ${escape(formatMobile(r.mobile))} to set it up.`,
        ballpark
          ? `Your ballpark for a new roof with ${escape(ballpark.material)}: <strong>${escape(ballpark.low)} to ${escape(ballpark.high)}</strong>. A rough guide, not a quote. Your price is the one in your written estimate.`
          : '',
        'Rather pick a time yourself? The button below opens the booking form with your details filled in.',
        `Reference ${escape(refLabel(r.ref))}.`,
      ].filter(Boolean),
      { label: 'Pick a time', href: link },
    ),
  };
}
