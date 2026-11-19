// Two-way sync with one Google Calendar.
//   Out: every booking appears on the calendar, and leaves it when cancelled.
//   In: anything else marked busy on the calendar takes one inspector out of
//       the windows it overlaps, so customers can't book over it.
// Reschedules and cancels happen in the app (the app is what tells the
// customer). An event we created that gets moved or deleted in Google is put
// back on the next sync.
//
// Google access is a service account the calendar is shared with
// ("Make changes to events"), so there is no sign-in that can expire.
import { SignJWT, importPKCS8 } from 'jose';
import { TZ } from '../booking/format';
import { labelOf, REASONS, formatMobile } from '../booking/rules';
import { refLabel } from '../booking/format';
import { asService } from './db';
import { appEnv, config, read } from './env';

export interface CalEvent {
  id: string;
  start: string; // ISO
  end: string;
  /** Marked "free" in Google: doesn't block anything. */
  transparent: boolean;
  /** Created by us for a booking. */
  bookingId: string | null;
  cancelled: boolean;
}

export interface EventBody {
  summary: string;
  location: string;
  description: string;
  start: string;
  end: string;
  bookingId: string;
}

export interface CalendarApi {
  list(calendarId: string, from: Date, to: Date): Promise<CalEvent[]>;
  /** Create, or update when eventId is given. Returns the event id. Throws NotFound if eventId is gone. */
  upsert(calendarId: string, eventId: string | null, body: EventBody): Promise<string>;
  remove(calendarId: string, eventId: string): Promise<void>;
}

export class NotFound extends Error {}

// ---------- Google ----------

let cachedToken: { token: string; expires: number } | undefined;

async function googleToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.token;
  const email = read('GOOGLE_SERVICE_ACCOUNT_EMAIL')!;
  const pem = read('GOOGLE_SERVICE_ACCOUNT_KEY')!.replace(/\\n/g, '\n');
  const key = await importPKCS8(pem, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/calendar.events' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(8000),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(`Google sign-in failed: ${data.error_description ?? res.status}`);
  cachedToken = { token: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}

interface GEvent {
  id: string;
  status?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

/** An all-day event runs from local midnight to local midnight. */
function localMidnight(date: string): string {
  // Find the UTC instant of 00:00 in the business time zone on that date.
  const guess = new Date(`${date}T05:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(guess));
  return new Date(guess.getTime() - hour * 3_600_000).toISOString();
}

const google: CalendarApi = {
  async list(calendarId, from, to) {
    const out: CalEvent[] = [];
    let pageToken: string | undefined;
    do {
      const u = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
      u.searchParams.set('timeMin', from.toISOString());
      u.searchParams.set('timeMax', to.toISOString());
      u.searchParams.set('singleEvents', 'true');
      u.searchParams.set('maxResults', '250');
      if (pageToken) u.searchParams.set('pageToken', pageToken);
      const res = await fetch(u, { headers: { Authorization: `Bearer ${await googleToken()}` }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Calendar list failed: ${res.status}`);
      const data = (await res.json()) as { items?: GEvent[]; nextPageToken?: string };
      for (const e of data.items ?? []) {
        const start = e.start?.dateTime ?? (e.start?.date ? localMidnight(e.start.date) : undefined);
        const end = e.end?.dateTime ?? (e.end?.date ? localMidnight(e.end.date) : undefined);
        if (!start || !end) continue;
        out.push({
          id: e.id,
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          transparent: e.transparency === 'transparent',
          bookingId: e.extendedProperties?.private?.bookingId ?? null,
          cancelled: e.status === 'cancelled',
        });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
    return out;
  },
  async upsert(calendarId, eventId, body) {
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const res = await fetch(eventId ? `${base}/${encodeURIComponent(eventId)}` : base, {
      method: eventId ? 'PUT' : 'POST',
      headers: { Authorization: `Bearer ${await googleToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: body.summary,
        location: body.location,
        description: body.description,
        start: { dateTime: body.start, timeZone: TZ },
        end: { dateTime: body.end, timeZone: TZ },
        transparency: 'opaque',
        status: 'confirmed',
        extendedProperties: { private: { bookingId: body.bookingId } },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (eventId && (res.status === 404 || res.status === 410)) throw new NotFound();
    if (!res.ok) throw new Error(`Calendar write failed: ${res.status}`);
    return ((await res.json()) as { id: string }).id;
  },
  async remove(calendarId, eventId) {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${await googleToken()}` }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`Calendar delete failed: ${res.status}`);
  },
};

// ---------- Test stand-in ----------

export const fakeCalendar = {
  events: new Map<string, CalEvent & { body?: EventBody }>(),
  reset() {
    this.events.clear();
  },
  addBusy(id: string, start: string, end: string, transparent = false) {
    this.events.set(id, { id, start, end, transparent, bookingId: null, cancelled: false });
  },
};

const fake: CalendarApi = {
  async list(_calendarId, from, to) {
    return [...fakeCalendar.events.values()].filter((e) => Date.parse(e.end) > from.getTime() && Date.parse(e.start) < to.getTime());
  },
  async upsert(_calendarId, eventId, body) {
    if (eventId && !fakeCalendar.events.has(eventId)) throw new NotFound();
    const id = eventId ?? `fake-${body.bookingId}-${Math.random().toString(36).slice(2, 8)}`;
    fakeCalendar.events.set(id, { id, start: body.start, end: body.end, transparent: false, bookingId: body.bookingId, cancelled: false, body });
    return id;
  },
  async remove(_calendarId, eventId) {
    fakeCalendar.events.delete(eventId);
  },
};

export function calendarApi(): CalendarApi | null {
  if (read('GOOGLE_SERVICE_ACCOUNT_EMAIL') && read('GOOGLE_SERVICE_ACCOUNT_KEY')) return google;
  if (appEnv() === 'test') return fake;
  return null;
}

export const serviceAccountEmail = (): string => read('GOOGLE_SERVICE_ACCOUNT_EMAIL') ?? '';

// ---------- Sync ----------

export interface SyncResult {
  status: 'not_connected' | 'ok' | 'error';
  pushed: number;
  removed: number;
  busy: number;
  error?: string;
}

async function calendarId(): Promise<string | null> {
  const [s] = await asService((tx) => tx`select calendar_id from wb.settings where id = 1`);
  return (s?.calendar_id as string | null) || read('GOOGLE_CALENDAR_ID') || null;
}

export async function syncCalendar(now = new Date(), api = calendarApi()): Promise<SyncResult> {
  const id = await calendarId();
  if (!api || !id) {
    await saveStatus('not_connected', null);
    return { status: 'not_connected', pushed: 0, removed: 0, busy: 0 };
  }
  try {
    const site = config.siteUrl();
    const [st] = await asService((tx) => tx`select horizon_days from wb.settings where id = 1`);
    const until = new Date(now.getTime() + (Number(st?.horizon_days ?? 21) + 2) * 86_400_000);
    const events = await api.list(id, now, until);
    const ours = new Map(events.filter((e) => e.bookingId && !e.cancelled).map((e) => [e.id, e]));

    // Out: bookings that are new, changed, or no longer right on the calendar.
    const active = await asService(
      (tx) => tx`
        select b.id, b.ref, b.name, b.mobile, b.address, b.reason, coalesce(b.notes, '') as notes,
               b.calendar_event_id, b.calendar_synced_at, b.updated_at, s.starts_at, s.ends_at
        from wb.bookings b join wb.slots s on s.id = b.slot_id
        where b.status = 'booked' and s.ends_at > ${now} and s.starts_at < ${until}`,
    );
    let pushed = 0;
    for (const b of active) {
      const start = new Date(b.starts_at).toISOString();
      const end = new Date(b.ends_at).toISOString();
      const event = b.calendar_event_id ? ours.get(b.calendar_event_id) : undefined;
      const stale = !b.calendar_synced_at || new Date(b.calendar_synced_at) < new Date(b.updated_at);
      const wrong = !event || event.start !== start || event.end !== end; // missing, or moved in Google
      if (!stale && !wrong) continue;
      const body: EventBody = {
        summary: `Roof inspection: ${String(b.name).split(' ')[0]} (${refLabel(b.ref)})`,
        location: b.address,
        description: [
          `${b.name}, ${formatMobile(b.mobile)}`,
          `Why: ${labelOf(REASONS, b.reason)}`,
          b.notes ? `Notes: ${b.notes}` : '',
          `Open in the app: ${site}/app/#/booking/${b.id}`,
        ]
          .filter(Boolean)
          .join('\n'),
        start,
        end,
        bookingId: b.id,
      };
      let eventId: string;
      try {
        eventId = await api.upsert(id, event ? b.calendar_event_id : null, body);
      } catch (err) {
        if (!(err instanceof NotFound)) throw err;
        eventId = await api.upsert(id, null, body); // deleted in Google: put it back
      }
      await asService((tx) => tx`update wb.bookings set calendar_event_id = ${eventId}, calendar_synced_at = now() where id = ${b.id}`);
      pushed++;
    }

    // Out: cancelled bookings leave the calendar.
    const toRemove = await asService(
      (tx) => tx`select id, calendar_event_id from wb.bookings where status = 'cancelled' and calendar_event_id is not null limit 100`,
    );
    for (const b of toRemove) {
      await api.remove(id, b.calendar_event_id);
      await asService((tx) => tx`update wb.bookings set calendar_event_id = null, calendar_synced_at = now() where id = ${b.id}`);
    }

    // In: everything else marked busy blocks those windows.
    const busy = events.filter((e) => !e.bookingId && !e.transparent && !e.cancelled);
    await asService(async (tx) => {
      const ids = busy.map((e) => e.id);
      await tx`delete from wb.calendar_busy where not (event_id = any(${ids}::text[]))`;
      for (const e of busy) {
        await tx`
          insert into wb.calendar_busy (event_id, starts_at, ends_at) values (${e.id}, ${e.start}, ${e.end})
          on conflict (event_id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, updated_at = now()
          where wb.calendar_busy.starts_at <> excluded.starts_at or wb.calendar_busy.ends_at <> excluded.ends_at`;
      }
    });
    await saveStatus('ok', null);
    return { status: 'ok', pushed, removed: toRemove.length, busy: busy.length };
  } catch (err) {
    const message = String((err as Error).message ?? err).slice(0, 300);
    await saveStatus('error', message);
    return { status: 'error', pushed: 0, removed: 0, busy: 0, error: message };
  }
}

async function saveStatus(status: string, error: string | null) {
  await asService(
    (tx) => tx`update wb.settings set calendar_status = ${status}, calendar_error = ${error}, calendar_synced_at = now() where id = 1`,
  );
}
