// The homeowner portal. The customer's private link shows their booking (see
// booking.ts), and with it their photos, the messages between us, and a box to
// write to us. The link's token is checked through wb_api first, every time;
// only then does the server read that one booking's rows, as the service role.
//
// What a customer sees:
//   photos    the ones they sent us, and the team's photos marked shared
//   messages  what we sent them (email, text), and what they sent us (texts,
//             messages from this page, questions about their estimate)
// Never: messages to the owners, a team photo nobody shared, another booking's rows.
import type { BookingSummary } from './booking';
import { getByToken } from './booking';
import { asService, type Tx } from './db';
import { config } from './env';
import { send, type Outcome } from './messaging/send';
import { messagePreview, ownerPortalMessageEmail, pushPortalMessage, type PortalCustomer } from './messaging/portal-templates';
import { ownerRecipients } from './notify';
import { pushToOwners } from './push';
import { viewUrl } from './storage';
import { looksLikeToken } from './tokens';

export interface PortalPhoto {
  id: string;
  /** A signed link, good for an hour. */
  url: string;
  caption: string;
  source: 'customer' | 'team';
  at: string;
}

export type ThreadChannel = 'email' | 'sms' | 'portal' | 'estimate';

export interface ThreadItem {
  id: string;
  from: 'us' | 'you';
  /**
   * How it came or went. An email and a text we sent together about the same thing
   * are one item, by both. estimate: a question asked with the buttons on their estimate.
   */
  channels: ThreadChannel[];
  text: string;
  at: string;
}

export interface Portal {
  bookedAt: string;
  photos: PortalPhoto[];
  messages: ThreadItem[];
}

export const MESSAGE_MAX = 1000;
const PHOTO_SECONDS = 3600;
const THREAD_MAX = 100;

/** Rows read here bring Dates; keep their milliseconds, so messages a moment apart stay in order. */
const iso = (v: unknown) => (v instanceof Date ? v : new Date(String(v))).toISOString();

async function photoRows(tx: Tx, bookingId: string) {
  return tx`
    select id, path, coalesce(caption, '') as caption, source, created_at
    from wb.booking_photos
    where booking_id = ${bookingId} and (source = 'customer' or (source = 'team' and shared))
    order by created_at desc, id`;
}

async function threadRows(tx: Tx, bookingId: string) {
  const messages = await tx`
    select id, channel, direction, kind, subject, body, created_at
    from wb.messages
    where booking_id = ${bookingId} and audience = 'customer'
      and ((direction = 'out' and status <> 'failed') or (direction = 'in' and channel in ('portal', 'sms')))
    order by created_at desc, id desc
    limit ${THREAD_MAX}`;
  const questions = await tx`
    select id, at, detail ->> 'note' as note
    from wb.booking_events
    where booking_id = ${bookingId} and kind = 'estimate_question' and coalesce(detail ->> 'note', '') <> ''
    order by at desc
    limit 20`;
  return { messages, questions };
}

/** Each photo with a link that works for an hour. A photo storage can't sign is left out, not the page. */
async function signPhotos(rows: Awaited<ReturnType<typeof photoRows>>): Promise<PortalPhoto[]> {
  const signed = await Promise.all(
    rows.map(async (r): Promise<PortalPhoto | null> => {
      try {
        return { id: r.id as string, url: await viewUrl(r.path as string, PHOTO_SECONDS), caption: r.caption as string, source: r.source, at: iso(r.created_at) };
      } catch (err) {
        console.error('photo link failed', err);
        return null;
      }
    }),
  );
  return signed.filter((p): p is PortalPhoto => p !== null);
}

/** An email and a text about the same thing go out together; further apart than this, they're two messages. */
const TWINS_MS = 10 * 60_000;

/**
 * Oldest first, like any conversation. An email and a text we sent together about the
 * same thing (a confirmation, "your estimate is ready") show once, with the text's words:
 * they say more than the email's subject line.
 */
function toThread({ messages, questions }: Awaited<ReturnType<typeof threadRows>>): ThreadItem[] {
  const rows = [
    ...messages.map((m) => ({
      id: m.id as string,
      from: m.direction === 'out' ? ('us' as const) : ('you' as const),
      channel: m.channel as ThreadChannel,
      kind: m.kind as string,
      text: m.direction === 'out' ? messagePreview(m.channel, m.subject, m.body) : String(m.body).trim(),
      at: iso(m.created_at),
    })),
    ...questions.map((q) => ({
      id: `question-${q.id}`,
      from: 'you' as const,
      channel: 'estimate' as const,
      kind: 'estimate_question',
      text: String(q.note).trim(),
      at: iso(q.at),
    })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));

  const items: (ThreadItem & { kind: string })[] = [];
  for (const r of rows) {
    const twin =
      r.from === 'us' && (r.channel === 'email' || r.channel === 'sms')
        ? items.findLast(
            (i) =>
              i.from === 'us' &&
              i.kind === r.kind &&
              i.channels.length === 1 &&
              (i.channels[0] === 'email' || i.channels[0] === 'sms') &&
              i.channels[0] !== r.channel &&
              Date.parse(r.at) - Date.parse(i.at) < TWINS_MS,
          )
        : undefined;
    if (twin) {
      twin.channels = ['email', 'sms'];
      if (r.channel === 'sms') twin.text = r.text;
      continue;
    }
    items.push({ id: r.id, from: r.from, channels: [r.channel], kind: r.kind, text: r.text, at: r.at });
  }
  return items.slice(-THREAD_MAX).map(({ kind: _kind, ...item }) => item);
}

export async function customerPhotos(bookingId: string): Promise<PortalPhoto[]> {
  return signPhotos(await asService((tx) => photoRows(tx, bookingId)));
}

export async function customerThread(bookingId: string): Promise<ThreadItem[]> {
  return toThread(await asService((tx) => threadRows(tx, bookingId)));
}

/** Everything on the private page besides the booking itself. */
export async function portalFor(bookingId: string): Promise<Portal> {
  const found = await asService(async (tx) => {
    const [b] = await tx`select created_at from wb.bookings where id = ${bookingId}`;
    return { bookedAt: b?.created_at, photos: await photoRows(tx, bookingId), thread: await threadRows(tx, bookingId) };
  });
  return { bookedAt: found.bookedAt ? iso(found.bookedAt) : '', photos: await signPhotos(found.photos), messages: toThread(found.thread) };
}

/** What the private page gets: the booking (its id stays on the server), its photos and its messages. */
export async function portalView(booking: BookingSummary) {
  const { id, ...rest } = booking;
  return { ...rest, ...(await portalFor(id)) };
}

// A message from the private page.

export type MessageResult =
  | { ok: true; messages: ThreadItem[] }
  | { ok: false; status: number; error: string; message: string };

const NOT_FOUND = { ok: false as const, status: 404, error: 'not_found', message: 'That link looks incomplete. Open it again from your text or email.' };

/** The message as we keep it: line breaks evened out, control characters gone, trimmed. */
export function readMessage(body: unknown): { ok: true; text: string } | Extract<MessageResult, { ok: false }> {
  const text =
    typeof body === 'string'
      ? body
          .replace(/\r\n?/g, '\n')
          .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
          .trim()
      : '';
  if (!text) return { ok: false, status: 400, error: 'empty', message: 'Type your message first.' };
  if (text.length > MESSAGE_MAX) return { ok: false, status: 400, error: 'too_long', message: 'Keep it to 1,000 characters or fewer.' };
  return { ok: true, text };
}

/**
 * Save a message from the customer, stop estimate follow-ups (a person takes it from
 * here), make a task to reply, and tell the owners. Returns the thread with it in.
 */
export async function sendPortalMessage(token: unknown, body: unknown): Promise<MessageResult> {
  if (!looksLikeToken(token)) return NOT_FOUND;
  const read = readMessage(body);
  if (!read.ok) return read;
  const found = await getByToken(token);
  if (!found.ok) return { ok: false, status: found.status, error: found.error, message: found.message };
  const bookingId = found.booking.id;
  const text = read.text;

  const saved = await asService(async (tx) => {
    const [b] = await tx`
      select b.id, b.name, b.mobile, b.email, b.address, coalesce(b.assigned_to, p.assigned_to) as assignee
      from wb.bookings b left join wb.customer_profiles p on p.mobile = b.mobile
      where b.id = ${bookingId}`;
    if (!b) return null;
    // The same words again within a minute (a double tap, a retry on a slow connection) are one message.
    const [again] = await tx`
      select id from wb.messages
      where booking_id = ${bookingId} and channel = 'portal' and direction = 'in' and body = ${text}
        and created_at > now() - interval '1 minute'
      limit 1`;
    if (again) return { customer: b, messageId: null, followUpsStopped: false };
    const [m] = await tx`
      insert into wb.messages (booking_id, channel, direction, audience, kind, to_addr, from_addr, body, provider, status)
      values (${bookingId}, 'portal', 'in', 'customer', 'portal_message', 'team', ${b.mobile}, ${text}, 'portal', 'received')
      returning id`;
    const stopped = await tx`
      update wb.estimates set followups_stopped_at = coalesce(followups_stopped_at, now())
      where booking_id = ${bookingId} and status = 'sent'
      returning id`;
    await tx`
      insert into wb.tasks (auto_key, title, due_on, mobile, booking_id, assignee)
      values (${`message:${m!.id}`}, ${`Reply to ${b.name}'s message`.slice(0, 200)}, wb.local_today(), ${b.mobile}, ${bookingId}, ${b.assignee})
      on conflict (auto_key) do nothing`;
    return { customer: b, messageId: m!.id as string, followUpsStopped: stopped.length > 0 };
  });
  if (!saved) return NOT_FOUND;

  if (saved.messageId) {
    const c: PortalCustomer = {
      id: bookingId,
      name: saved.customer.name,
      mobile: saved.customer.mobile,
      email: saved.customer.email,
      address: saved.customer.address,
    };
    // The message is saved either way. An alert that fails is logged, never shown to the customer.
    await alertOwners(c, text, saved.followUpsStopped, saved.messageId).catch((e) => console.error('portal message alert failed', e));
  }
  return { ok: true, messages: await customerThread(bookingId) };
}

/** A ping on every owner's phone, and an email to each owner who gets email alerts. */
async function alertOwners(c: PortalCustomer, text: string, followUpsStopped: boolean, messageId: string): Promise<void> {
  const site = config.siteUrl();
  const appUrl = `${site}/app/#/booking/${c.id}`;
  const email = ownerPortalMessageEmail(c, text, followUpsStopped, appUrl, site);
  const jobs: Promise<Outcome | number>[] = [pushToOwners(pushPortalMessage(c, text))];
  for (const r of await ownerRecipients()) {
    if (!r.email) continue;
    jobs.push(
      send({
        bookingId: c.id,
        channel: 'email',
        audience: 'owner',
        kind: 'owner_portal_message',
        to: r.email,
        ...email,
        dedupeKey: `portal_message:${messageId}:${r.email}`,
      }),
    );
  }
  await Promise.allSettled(jobs);
}
