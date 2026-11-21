// Reminders: the evening before (6 to 9 pm) and the morning of (from 7:30 am).
// The scheduled job runs every 15 minutes; each reminder goes out once per
// booking per window, even if the job runs again.
import { TZ } from '../booking/format';
import { asService } from './db';
import { config } from './env';
import { send } from './messaging/send';
import { emailDayBefore, smsDayBefore, smsMorning } from './messaging/templates';
import { loadDetails } from './notify';
import { manageToken, manageUrl } from './tokens';

interface Local {
  date: string; // YYYY-MM-DD in the business time zone
  minutes: number; // minutes after local midnight
}

export function local(at: Date): Local {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type ReminderKind = 'remind_eve' | 'remind_morn';

/** Which reminder (if any) is due for a window starting at `startsAt`, at time `now`. */
export function dueKind(startsAt: Date, now: Date): ReminderKind | null {
  const n = local(now);
  const s = local(startsAt);
  if (s.date === addDays(n.date, 1) && n.minutes >= 18 * 60 && n.minutes < 21 * 60) return 'remind_eve';
  if (s.date === n.date && n.minutes >= 7 * 60 + 30 && startsAt.getTime() - now.getTime() > 30 * 60_000) return 'remind_morn';
  return null;
}

export async function runReminders(now = new Date()): Promise<number> {
  const rows = await asService(
    (tx) => tx`
      select b.id, s.id as slot_id, s.starts_at, b.sms_consent,
             (select max(m.created_at) from wb.messages m
              where m.booking_id = b.id and m.audience = 'customer' and m.kind in ('confirmation', 'rescheduled')) as last_notice
      from wb.bookings b join wb.slots s on s.id = b.slot_id
      where b.status = 'booked'
        and s.starts_at > ${now}
        and s.starts_at < ${new Date(now.getTime() + 40 * 3_600_000)}`,
  );
  let sent = 0;
  for (const r of rows) {
    const kind = dueKind(new Date(r.starts_at), now);
    if (!kind) continue;
    // They just heard from us (booked or moved in the last 6 hours): no reminder needed.
    if (r.last_notice && now.getTime() - new Date(r.last_notice).getTime() < 6 * 3_600_000) continue;
    const b = await loadDetails(r.id);
    if (!b) continue;
    const link = manageUrl(config.siteUrl(), manageToken(b.draftKey));
    const key = `${kind}:${b.id}:${r.slot_id}`;
    if (b.smsConsent) {
      const text = kind === 'remind_eve' ? smsDayBefore(b, link) : smsMorning(b);
      const outcome = await send({ bookingId: b.id, channel: 'sms', audience: 'customer', kind, to: b.mobile, text, dedupeKey: key });
      if (outcome === 'sent' || outcome === 'logged') sent++;
      if (outcome !== 'opted_out') continue;
    }
    // No texts: an email the evening before instead.
    if (kind === 'remind_eve') {
      const email = emailDayBefore(b, link, config.siteUrl());
      const outcome = await send({ bookingId: b.id, channel: 'email', audience: 'customer', kind, to: b.email, ...email, dedupeKey: `${key}:email` });
      if (outcome === 'sent' || outcome === 'logged') sent++;
    }
  }
  return sent;
}
