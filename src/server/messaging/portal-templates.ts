// The homeowner portal: how our messages read in the customer's thread, and
// what the owners hear when a customer writes to us from their private page.
// Plain, short, and only facts.
import { formatMobile } from '../../booking/rules';
import { facts } from '../../facts';
import type { PushMessage } from '../push';
import { escape, layout, type Email } from './templates';

export interface PortalCustomer {
  id: string;
  name: string;
  mobile: string;
  email: string;
  address: string;
}

const URL_IN_TEXT = /https?:\/\/\S+/g;
const OPT_OUT = /\s*Reply STOP to opt out\.?/gi;
// A label left hanging where a link was, like "Change or cancel:" at the end of a text.
const HANGING_LABEL = /(?:^|(?<=[.!?]))\s*[^.!?:]*:\s*$/;

/**
 * One line for the customer's thread. An email shows its subject. A text shows what it
 * says, without our name in front, its links (they lead to this page), our number (it's
 * on the page) or the opt-out line.
 */
export function messagePreview(channel: string, subject: string | null, body: string): string {
  if (channel === 'email' && subject?.trim()) return subject.trim();
  if (channel !== 'sms') return body.trim();
  let line = (body.split('\n').find((l) => l.trim()) ?? '').trim();
  const prefix = `${facts.business.name}:`;
  if (line.toLowerCase().startsWith(prefix.toLowerCase())) line = line.slice(prefix.length);
  if (facts.contact.phone) line = line.replace(`Questions: ${facts.contact.phone}.`, '');
  line = line.replace(OPT_OUT, '').replace(URL_IN_TEXT, '').replace(/\s+/g, ' ').trim();
  line = line.replace(HANGING_LABEL, '').trim();
  if (!line) return 'A text with a link to this page.';
  return line.charAt(0).toUpperCase() + line.slice(1);
}

// What the owners hear.

/** A ping on the owners' phones. Pings for the same customer replace each other on the lock screen. */
export function pushPortalMessage(c: Pick<PortalCustomer, 'id' | 'name'>, text: string): PushMessage {
  return { title: `Message from ${c.name}`, body: text.slice(0, 180), url: `/app/#/booking/${c.id}`, tag: `message-${c.id}` };
}

export function ownerPortalMessageEmail(c: PortalCustomer, text: string, followUpsStopped: boolean, appUrl: string, siteUrl: string): Email {
  const mobile = formatMobile(c.mobile);
  const details = [
    `${c.name}, ${mobile}, ${c.email}`,
    c.address,
    followUpsStopped ? 'Follow-ups about their estimate have stopped.' : '',
    `Reply by calling or texting ${mobile}, or by email to ${c.email}.`,
  ].filter(Boolean);
  return {
    subject: `Message from ${c.name}: ${c.address}`,
    text: [`${c.name} wrote from their private page:`, text, ...details, appUrl].join('\n\n'),
    html: layout(
      siteUrl,
      `Message from ${c.name}`,
      [`${escape(c.name)} wrote from their private page:`, `<strong>${escape(text).replace(/\n/g, '<br>')}</strong>`, ...details.map(escape)],
      { label: 'Open in the app', href: appUrl },
    ),
  };
}
