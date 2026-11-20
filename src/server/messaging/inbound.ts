// Texts people send back to our number. We keep a copy, honor STOP and START,
// and forward everything to the owners so nobody's reply goes unread.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { formatMobile } from '../../booking/rules';
import { asService } from '../db';
import { send } from './send';
import { ownerRecipients } from '../notify';

const STOP = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|revoke|optout)\s*[.!]*\s*$/i;
const START = /^\s*(start|unstop|yes)\s*[.!]*\s*$/i;

/** Twilio signs each webhook: HMAC-SHA1 over the URL plus the sorted form fields. */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

export function validTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string): boolean {
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export interface Inbound {
  from: string;
  to: string;
  body: string;
  sid: string;
  optOutType?: string;
}

export async function handleInbound(m: Inbound): Promise<{ optedOut: boolean; optedIn: boolean; forwarded: number }> {
  const body = m.body.slice(0, 1600);
  const optOut = m.optOutType?.toUpperCase() === 'STOP' || STOP.test(body);
  const optIn = m.optOutType?.toUpperCase() === 'START' || START.test(body);

  const booking = await asService(async (tx) => {
    const [b] = await tx`
      select b.id, b.name from wb.bookings b join wb.slots s on s.id = b.slot_id
      where b.mobile = ${m.from}
      order by s.starts_at desc limit 1`;
    await tx`
      insert into wb.messages (booking_id, channel, direction, audience, kind, to_addr, from_addr, body, provider, provider_id, status)
      values (${b?.id ?? null}, 'sms', 'in', 'customer', 'inbound', ${m.to}, ${m.from}, ${body}, 'twilio', ${m.sid}, 'received')`;
    // Any text from a customer stops estimate follow-ups: a person takes it from here.
    await tx`update wb.estimates set replied_at = now()
             where status = 'sent' and booking_id in (select id from wb.bookings where mobile = ${m.from})`;
    if (optOut) await tx`insert into wb.sms_optouts (mobile) values (${m.from}) on conflict (mobile) do nothing`;
    if (optIn) await tx`delete from wb.sms_optouts where mobile = ${m.from}`;
    return b as { id: string; name: string } | undefined;
  });

  const who = booking ? `${booking.name} ${formatMobile(m.from)}` : formatMobile(m.from);
  const note = optOut ? ` (Replying "${body.trim().slice(0, 20)}" stops our texts to them until they reply START. Call them if they meant to cancel a visit.)` : '';
  const text = `Text from ${who}: ${body.slice(0, 300)}${note}`;
  let forwarded = 0;
  for (const r of await ownerRecipients()) {
    if (r.mobile && r.mobile !== m.from) {
      await send({ bookingId: booking?.id ?? null, channel: 'sms', audience: 'owner', kind: 'forward', to: r.mobile, text });
      forwarded++;
    }
    if (r.email) {
      await send({
        bookingId: booking?.id ?? null,
        channel: 'email',
        audience: 'owner',
        kind: 'forward',
        to: r.email,
        subject: `Text from ${who}`,
        text: `${body}${note}\n\nReply by texting ${formatMobile(m.from)} from your phone, or call them.`,
      });
      forwarded++;
    }
  }
  return { optedOut: optOut, optedIn: optIn, forwarded };
}
