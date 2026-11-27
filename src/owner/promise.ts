// The call-back promise on the estimate page ("within one business hour"), as a
// time on the owners' screen. Daytime (8 am to 7 pm Eastern) a request is due an
// hour after it came in; one that came in after hours is due by 9 the next morning.
import { TZ, dayKey } from '../booking/format';

const hourIn = (d: Date) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(d));

/** The instant of hour:00 on a local date (YYYY-MM-DD), Eastern. */
function at(date: string, hour: number): Date {
  const guess = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);
  return new Date(guess.getTime() + (hour - hourIn(guess)) * 3_600_000);
}

const nextDate = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export function callBy(createdIso: string): Date {
  const created = new Date(createdIso);
  const h = hourIn(created);
  if (h >= 8 && h < 19) return new Date(created.getTime() + 3_600_000);
  const date = dayKey(createdIso);
  return at(h >= 19 ? nextDate(date) : date, 9);
}

const clock = (d: Date) =>
  new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(d).replace(':00', '').replace(' AM', ' am').replace(' PM', ' pm');

/** "Call by 9:42 am", and how long is left: "38 min left", "12 min late", "2 hr late". */
export function promiseLabel(createdIso: string, now = Date.now()): { by: string; left: string; late: boolean } {
  const due = callBy(createdIso);
  const mins = Math.round((due.getTime() - now) / 60_000);
  const span = (m: number) => (m < 90 ? `${m} min` : `${Math.round(m / 60)} hr`);
  const sameDay = dayKey(due.toISOString()) === dayKey(new Date(now).toISOString());
  const by = `Call by ${clock(due)}${sameDay ? '' : ` ${new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(due)}`}`;
  return mins >= 0 ? { by, left: `${span(Math.max(mins, 1))} left`, late: false } : { by, left: `${span(-mins)} late`, late: true };
}

/** "Just now", "12 min ago", "3 hr ago", "Yesterday". */
export function ago(iso: string, now = Date.now()): string {
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} hr ago`;
  return mins < 48 * 60 ? 'Yesterday' : `${Math.round(mins / (24 * 60))} days ago`;
}
