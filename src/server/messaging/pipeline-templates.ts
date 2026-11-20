// After the inspection: what the customer and the owners hear about the
// estimate and the roof job. Plain, short, and only facts.
import { facts } from '../../facts';
import { dateLong, dateShort, money } from '../../booking/format';
import { formatMobile } from '../../booking/rules';
import { escape, layout, type Email } from './templates';

export interface PipelineCustomer {
  id: string;
  name: string;
  address: string;
  email: string;
  mobile: string;
  smsConsent: boolean;
}

const name = () => facts.business.name;
const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? '';
const phone = () => facts.contact.phone;
const turnaround = () => facts.pipeline.estimateTurnaround || 'soon';

/** Lines every follow-up and review email ends with: how to stop, and our mailing address (CAN-SPAM). */
function marketingFooter(stopText: string): { text: string[]; html: string[] } {
  const address = facts.business.mailingAddress;
  return {
    text: [stopText, `${facts.business.legalName || name()}, ${address}`],
    html: [escape(stopText), `${escape(facts.business.legalName || name())}, ${escape(address)}`],
  };
}

// The inspection is done.

export function smsInspected(): string {
  return `${name()}: thanks for having us today. Your estimate will be ready ${turnaround()}, and we'll send you a link to see it. Reply STOP to opt out.`;
}

export function emailInspected(c: PipelineCustomer, link: string, siteUrl: string): Email {
  const lines = [
    `Hi ${firstName(c.name)}, thanks for having us at ${c.address} today.`,
    `Your estimate will be ready ${turnaround()}. We'll email you when it is, and it will be on your private page: ${link}`,
    `Questions in the meantime? Call or text ${phone()}.`,
  ];
  return {
    subject: 'Thanks for having us',
    text: lines.join('\n\n'),
    html: layout(siteUrl, 'Thanks for having us', [
      `Hi ${escape(firstName(c.name))}, thanks for having us at ${escape(c.address)} today.`,
      `Your estimate will be ready ${escape(turnaround())}. We'll email you when it is, and it will be on your private page.`,
    ], { label: 'Your private page', href: link }),
  };
}

// The estimate is ready.

export function smsEstimateReady(link: string, updated: boolean): string {
  return `${name()}: your ${updated ? 'updated ' : ''}estimate is ready. See it and let us know what you'd like to do: ${link}`;
}

export function emailEstimateReady(c: PipelineCustomer, link: string, siteUrl: string, updated: boolean): Email {
  const what = updated ? 'Your updated estimate' : 'Your estimate';
  return {
    subject: `${what} is ready`,
    text: [
      `Hi ${firstName(c.name)}, ${what.toLowerCase()} for ${c.address} is ready.`,
      `Open it to see what's included, then tell us if you'd like to go ahead, have a question, or would rather not: ${link}`,
      `Or call or text ${phone()}.`,
    ].join('\n\n'),
    html: layout(siteUrl, `${what} is ready`, [
      `Hi ${escape(firstName(c.name))}, ${escape(what.toLowerCase())} for ${escape(c.address)} is ready.`,
      "Open it to see what's included, then tell us if you'd like to go ahead, have a question, or would rather not.",
    ], { label: 'See your estimate', href: link }),
  };
}

// Follow-ups: email only, and only until the customer answers.

export function emailFollowUp(c: PipelineCustomer, link: string, siteUrl: string, index: number, total: number): Email {
  const first = firstName(c.name);
  const last = index === total - 1 && total > 1;
  const body =
    index === 0
      ? {
          subject: 'Any questions about your estimate?',
          title: 'Any questions?',
          lines: [`Hi ${first}, checking in about your estimate for ${c.address}.`, `If anything isn't clear, reply to this email, call or text ${phone()}, or ask on your estimate page.`],
        }
      : last
        ? {
            subject: 'One last note about your estimate',
            title: 'One last note',
            lines: [`Hi ${first}, we won't keep emailing about your estimate for ${c.address}.`, `It stays on your page. If you'd like to go ahead later, or have a question, call or text ${phone()}.`],
          }
        : {
            subject: 'Still thinking it over?',
            title: 'Still thinking it over?',
            lines: [`Hi ${first}, no rush. Your estimate for ${c.address} is on your page whenever you're ready.`, `Questions about materials, timing or paying for it? Call or text ${phone()}.`],
          };
  const foot = marketingFooter("Not interested? Choose \"No thanks\" on your estimate page and we'll stop.");
  return {
    subject: body.subject,
    text: [...body.lines, `Your estimate: ${link}`, ...foot.text].join('\n\n'),
    html: layout(siteUrl, body.title, body.lines.map(escape), { label: 'See your estimate', href: link }, foot.html),
  };
}

// The roof job.

export function smsJobScheduled(day: string): string {
  return `${name()}: your roof job is set for ${dateShort(day)}. We'll text you the day before. Questions: ${phone()}.`;
}

export function emailJobScheduled(c: PipelineCustomer, day: string, link: string, siteUrl: string): Email {
  return {
    subject: `Your roof job: ${dateShort(day)}`,
    text: [
      `Hi ${firstName(c.name)}, your roof job at ${c.address} is set for ${dateLong(day)}.`,
      "Weather can move it. If it does, we'll tell you right away. We'll send a reminder the day before.",
      `Your page: ${link}`,
      `Questions? Call or text ${phone()}.`,
    ].join('\n\n'),
    html: layout(siteUrl, 'Your roof job is scheduled', [
      `Hi ${escape(firstName(c.name))}, your roof job at ${escape(c.address)} is set for <strong>${escape(dateLong(day))}</strong>.`,
      "Weather can move it. If it does, we'll tell you right away. We'll send a reminder the day before.",
    ], { label: 'Your page', href: link }),
  };
}

export function smsJobReminder(day: string): string {
  return `${name()}: reminder, we're working on your roof tomorrow, ${dateShort(day)}. Questions: ${phone()}.`;
}

export function emailJobReminder(c: PipelineCustomer, day: string, link: string, siteUrl: string): Email {
  return {
    subject: `Tomorrow: your roof job`,
    text: [`Hi ${firstName(c.name)}, a reminder: we're working on your roof at ${c.address} tomorrow, ${dateLong(day)}.`, `Questions? Call or text ${phone()}.`].join('\n\n'),
    html: layout(siteUrl, 'See you tomorrow', [`Hi ${escape(firstName(c.name))}, a reminder: we're working on your roof at ${escape(c.address)} tomorrow, ${escape(dateLong(day))}.`], {
      label: 'Your page',
      href: link,
    }),
  };
}

export function smsJobMoved(from: string, to: string, weather: boolean): string {
  return `${name()}: ${weather ? 'because of the weather, ' : ''}we moved your roof job from ${dateShort(from)} to ${dateShort(to)}. Questions: ${phone()}.`;
}

export function emailJobMoved(c: PipelineCustomer, from: string, to: string, weather: boolean, link: string, siteUrl: string): Email {
  const why = weather ? 'Because of the weather, we' : 'We';
  return {
    subject: `Your roof job moved to ${dateShort(to)}`,
    text: [`Hi ${firstName(c.name)}, ${why.toLowerCase()} moved your roof job at ${c.address} from ${dateLong(from)} to ${dateLong(to)}.`, `Questions? Call or text ${phone()}.`].join('\n\n'),
    html: layout(siteUrl, 'New day for your roof job', [
      `Hi ${escape(firstName(c.name))}, ${escape(why.toLowerCase())} moved your roof job at ${escape(c.address)} from ${escape(dateLong(from))} to <strong>${escape(dateLong(to))}</strong>.`,
    ], { label: 'Your page', href: link }),
  };
}

/** Job done: thanks, and (with a mailing address on file) a review request sent to every customer alike. */
export function emailJobDone(c: PipelineCustomer, siteUrl: string, reviewUrl: string): Email {
  const ask = Boolean(reviewUrl && facts.business.mailingAddress);
  const lines = [
    `Hi ${firstName(c.name)}, your roof at ${c.address} is done. Thank you for trusting us with it.`,
    `If anything doesn't look right, call or text ${phone()}.`,
  ];
  const foot = ask ? marketingFooter('This is the only review request we send.') : { text: [], html: [] };
  return {
    subject: 'Your roof is done. Thank you!',
    text: [...lines, ...(ask ? [`If you have a minute, a Google review helps neighbors find us: ${reviewUrl}`] : []), ...foot.text].join('\n\n'),
    html: layout(
      siteUrl,
      'Your roof is done',
      [...lines.map(escape), ...(ask ? ['If you have a minute, a Google review helps neighbors find us.'] : [])],
      ask ? { label: 'Leave a Google review', href: reviewUrl } : undefined,
      foot.html,
    ),
  };
}

// Owner alerts when a customer answers.

export type Answer = 'accepted' | 'declined' | 'question';

export function ownerAnswerSms(kind: Answer, c: PipelineCustomer, amountCents: number | null, note: string, appUrl: string): string {
  const who = `${c.name}, ${formatMobile(c.mobile)}`;
  const quoted = note ? ` "${note.slice(0, 300)}"` : '';
  if (kind === 'accepted') return `Said yes: ${who}, ${c.address}${amountCents ? `, ${money(amountCents)}` : ''}.${quoted} Pick a day: ${appUrl}`;
  if (kind === 'declined') return `Said no thanks: ${who}, ${c.address}.${quoted} ${appUrl}`;
  return `Question about an estimate: ${who}, ${c.address}.${quoted} ${appUrl}`;
}

export function ownerAnswerEmail(kind: Answer, c: PipelineCustomer, amountCents: number | null, note: string, appUrl: string, siteUrl: string): Email {
  const heading = kind === 'accepted' ? 'Said yes' : kind === 'declined' ? 'Said no thanks' : 'A question about an estimate';
  const lines = [
    `${c.name}, ${formatMobile(c.mobile)}, ${c.email}`,
    c.address,
    amountCents ? `Estimate: ${money(amountCents)}` : '',
    note ? `They wrote: "${note}"` : '',
    kind === 'accepted' ? 'Next: pick a crew and a day in the app.' : kind === 'question' ? 'Follow-ups have stopped. Call or text them back.' : '',
  ].filter(Boolean);
  return {
    subject: `${heading}: ${c.address}`,
    text: [...lines, appUrl].join('\n\n'),
    html: layout(siteUrl, heading, lines.map(escape), { label: 'Open in the app', href: appUrl }),
  };
}
