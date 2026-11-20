// Sending texts (Twilio) and email (Resend). Every message is written to
// wb.messages first, then delivered. Without keys, messages are only logged:
// nothing leaves the building, and nobody is told a message was sent.
import { facts } from '../../facts';
import { asService } from '../db';
import { read } from '../env';

export type Channel = 'sms' | 'email';
export type Outcome = 'sent' | 'logged' | 'failed' | 'duplicate' | 'opted_out' | 'no_recipient' | 'over_limit';

export interface OutMessage {
  bookingId?: string | null;
  channel: Channel;
  audience: 'customer' | 'owner';
  kind: string;
  to: string;
  subject?: string;
  /** The text message, or the plain-text version of an email. */
  text: string;
  html?: string;
  attachments?: { filename: string; content: string; contentType: string }[];
  /** Same key twice means the second is skipped (one reminder per window). */
  dedupeKey?: string;
}

export const smsProvider = (): 'twilio' | 'log' =>
  read('TWILIO_ACCOUNT_SID') && read('TWILIO_AUTH_TOKEN') && (read('TWILIO_FROM') || read('TWILIO_MESSAGING_SERVICE_SID'))
    ? 'twilio'
    : 'log';

export const emailProvider = (): 'resend' | 'log' => (read('RESEND_API_KEY') ? 'resend' : 'log');

export function emailFrom(): string {
  return read('EMAIL_FROM') ?? `${facts.business.name} <bookings@${facts.web.domain}>`;
}

/** Texts this booking's customer has had from us (sent, logged or still trying). */
export async function textsSent(bookingId: string): Promise<number> {
  const rows = await asService(
    (tx) => tx`select count(*)::int as n from wb.messages
               where booking_id = ${bookingId} and channel = 'sms' and direction = 'out' and audience = 'customer'
                 and status in ('queued', 'sent', 'logged', 'failed')`,
  );
  return rows[0]?.n ?? 0;
}

export async function optedOut(mobile: string): Promise<boolean> {
  const rows = await asService((tx) => tx`select 1 from wb.sms_optouts where mobile = ${mobile}`);
  return rows.length > 0;
}

async function deliverSms(to: string, body: string): Promise<string> {
  const sid = read('TWILIO_ACCOUNT_SID')!;
  const token = read('TWILIO_AUTH_TOKEN')!;
  const params = new URLSearchParams({ To: to, Body: body });
  const service = read('TWILIO_MESSAGING_SERVICE_SID');
  if (service) params.set('MessagingServiceSid', service);
  else params.set('From', read('TWILIO_FROM')!);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
    signal: AbortSignal.timeout(8000),
  });
  const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
  if (!res.ok || !data.sid) throw new Error(`Twilio ${res.status} ${data.code ?? ''}: ${data.message ?? 'no message id'}`);
  return data.sid;
}

async function deliverEmail(m: OutMessage, idempotencyKey: string): Promise<string> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${read('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      from: emailFrom(),
      to: [m.to],
      reply_to: facts.contact.email || undefined,
      subject: m.subject,
      text: m.text,
      html: m.html,
      attachments: m.attachments?.map((a) => ({ filename: a.filename, content: a.content, content_type: a.contentType })),
    }),
    signal: AbortSignal.timeout(8000),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok || !data.id) throw new Error(`Resend ${res.status}: ${data.message ?? 'no message id'}`);
  return data.id;
}

/** Record, then deliver. */
export async function send(m: OutMessage): Promise<Outcome> {
  if (!m.to) return 'no_recipient';
  if (m.channel === 'sms' && (await optedOut(m.to))) return 'opted_out';
  if (m.channel === 'sms' && m.audience === 'customer' && m.bookingId && (await textsSent(m.bookingId)) >= facts.texts.maxPerBooking) {
    // The booking form promises a limit. Past it, the customer still gets email.
    return 'over_limit';
  }
  const provider = m.channel === 'sms' ? smsProvider() : emailProvider();
  const id = await asService(async (tx) => {
    const rows = await tx`
      insert into wb.messages (booking_id, channel, audience, kind, to_addr, from_addr, subject, body, html, provider, dedupe_key)
      values (${m.bookingId ?? null}, ${m.channel}, ${m.audience}, ${m.kind}, ${m.to},
              ${m.channel === 'email' ? emailFrom() : (read('TWILIO_FROM') ?? null)},
              ${m.subject ?? null}, ${m.text}, ${m.html ?? null}, ${provider}, ${m.dedupeKey ?? null})
      on conflict (dedupe_key) do nothing
      returning id`;
    return rows[0]?.id as string | undefined;
  });
  if (!id) return 'duplicate';
  return deliver(id, m, provider);
}

async function deliver(id: string, m: OutMessage, provider: 'twilio' | 'resend' | 'log'): Promise<Outcome> {
  if (provider === 'log') {
    await asService((tx) => tx`update wb.messages set status = 'logged', attempts = attempts + 1 where id = ${id}`);
    return 'logged';
  }
  try {
    const providerId = m.channel === 'sms' ? await deliverSms(m.to, m.text) : await deliverEmail(m, id);
    await asService(
      (tx) => tx`update wb.messages set status = 'sent', provider_id = ${providerId}, sent_at = now(), attempts = attempts + 1, error = null where id = ${id}`,
    );
    return 'sent';
  } catch (err) {
    const error = String((err as Error).message ?? err).slice(0, 500);
    await asService((tx) => tx`update wb.messages set status = 'failed', error = ${error}, attempts = attempts + 1 where id = ${id}`);
    console.error('message failed', m.kind, error);
    return 'failed';
  }
}

/** The scheduled job retries failed messages a few times, for up to six hours. */
export async function retryFailed(): Promise<number> {
  const rows = await asService(
    (tx) => tx`
      select id, booking_id, channel, audience, kind, to_addr, subject, body, html, provider
      from wb.messages
      where direction = 'out' and status in ('failed', 'queued') and attempts < 4 and created_at > now() - interval '6 hours'
      order by created_at
      limit 50`,
  );
  let ok = 0;
  for (const r of rows) {
    const m: OutMessage = {
      bookingId: r.booking_id,
      channel: r.channel,
      audience: r.audience,
      kind: r.kind,
      to: r.to_addr,
      subject: r.subject ?? undefined,
      text: r.body,
      html: r.html ?? undefined,
    };
    const provider = (m.channel === 'sms' ? smsProvider() : emailProvider()) as 'twilio' | 'resend' | 'log';
    if ((await deliver(r.id, m, provider)) === 'sent') ok++;
  }
  return ok;
}
