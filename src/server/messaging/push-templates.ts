// What the owners' phones show: who, when or where, and the one thing to do.
// Short enough to read on a lock screen. No customer email or gate code.
import { money, shortDay, townOf, windowLabel } from '../../booking/format';
import { formatMobile } from '../../booking/rules';
import { facts } from '../../facts';
import type { PushMessage } from '../push';
import { waited } from './request-templates';

interface Visit {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  address: string;
}

const when = (v: Visit) => `${shortDay(v.startsAt)}, ${windowLabel(v.startsAt, v.endsAt)}`;

export function pushNewBooking(v: Visit): PushMessage {
  return { title: 'New inspection booked', body: `${v.name}, ${when(v)}. ${townOf(v.address)}.`, url: `/app/#/booking/${v.id}`, tag: `booking-${v.id}` };
}

export function pushBookingChanged(kind: 'rescheduled' | 'cancelled', v: Visit): PushMessage {
  return kind === 'rescheduled'
    ? { title: 'Moved by the customer', body: `${v.name} is now ${when(v)}. ${townOf(v.address)}.`, url: `/app/#/booking/${v.id}`, tag: `booking-${v.id}` }
    : { title: 'Cancelled by the customer', body: `${v.name}, ${when(v)}. That time is open again.`, url: `/app/#/booking/${v.id}`, tag: `booking-${v.id}` };
}

export function pushNewRequest(r: { id: string; name: string; mobile: string; address: string }): PushMessage {
  const promise = facts.estimate.callback ? ` They were told: a call ${facts.estimate.callback}.` : '';
  return {
    title: 'New estimate request',
    body: `${r.name}, ${townOf(r.address)}. Call ${formatMobile(r.mobile)}.${promise}`,
    url: `/app/#/request/${r.id}`,
    tag: `request-${r.id}`,
  };
}

export function pushRequestReminder(r: { id: string; name: string; mobile: string }, minutesWaiting: number): PushMessage {
  return {
    title: 'Still to call',
    body: `${r.name} asked for an estimate ${waited(minutesWaiting)} ago. ${formatMobile(r.mobile)}.`,
    url: `/app/#/request/${r.id}`,
    tag: `request-${r.id}`,
  };
}

export function pushTextIn(who: string, text: string, bookingId: string | null): PushMessage {
  return { title: `Text from ${who}`, body: text.slice(0, 180), url: bookingId ? `/app/#/booking/${bookingId}` : '/app/' };
}

export function pushEstimateAnswer(
  kind: 'accepted' | 'declined' | 'question',
  c: { id: string; name: string },
  amountCents: number | null,
  note: string,
): PushMessage {
  const url = `/app/#/booking/${c.id}`;
  if (kind === 'accepted') {
    return { title: 'They said yes', body: `${c.name} said yes to the estimate${amountCents ? ` of ${money(amountCents)}` : ''}. Time to schedule the job.`, url, tag: `estimate-${c.id}` };
  }
  if (kind === 'declined') return { title: 'Estimate declined', body: `${c.name} said no thanks to the estimate.`, url, tag: `estimate-${c.id}` };
  return { title: `A question from ${c.name}`, body: note ? note.slice(0, 180) : 'About their estimate.', url, tag: `estimate-${c.id}` };
}
