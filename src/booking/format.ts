// Dates and windows, always in the business's time zone.
export const TZ = 'America/New_York';

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts });

/** "2026-11-20", for grouping windows by day. */
export function dayKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** "Fri, Nov 20" */
export const shortDay = (iso: string) => fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso));

/** "Fri" and "Nov 20", for a day button that stacks them. */
export const weekday = (iso: string) => fmt({ weekday: 'short' }).format(new Date(iso));
export const monthDay = (iso: string) => fmt({ month: 'short', day: 'numeric' }).format(new Date(iso));

/** "Friday, November 20" */
export const longDay = (iso: string) => fmt({ weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(iso));

function hourParts(iso: string): { h: number; m: number; pm: boolean } {
  const parts = fmt({ hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const pm = (parts.find((p) => p.type === 'dayPeriod')?.value ?? '').toLowerCase().startsWith('p');
  return { h, m, pm };
}

function clock(p: { h: number; m: number }): string {
  return p.m ? `${p.h}:${String(p.m).padStart(2, '0')}` : String(p.h);
}

/** "8 to 10 am", "10 am to noon", "noon to 2 pm", "2 to 4 pm" */
export function windowLabel(startIso: string, endIso: string): string {
  const a = hourParts(startIso);
  const b = hourParts(endIso);
  const isNoon = (p: typeof a) => p.h === 12 && p.m === 0 && p.pm;
  const left = isNoon(a) ? 'noon' : clock(a);
  const right = isNoon(b) ? 'noon' : `${clock(b)} ${b.pm ? 'pm' : 'am'}`;
  if (isNoon(a) || isNoon(b) || a.pm !== b.pm) {
    const leftFull = isNoon(a) ? 'noon' : `${clock(a)} ${a.pm ? 'pm' : 'am'}`;
    return `${leftFull} to ${right}`;
  }
  return `${left} to ${right}`;
}

/** "Friday, November 20, 8 to 10 am" */
export const whenLabel = (startIso: string, endIso: string) => `${longDay(startIso)}, ${windowLabel(startIso, endIso)}`;

/** "K7M3QX" to "K7M-3QX", easier to read over the phone. */
/** A calendar date (YYYY-MM-DD) as "Fri, Dec 4" and "Friday, December 4". Noon UTC keeps it on the same local day. */
export const dateShort = (date: string) => shortDay(`${date}T12:00:00Z`);
export const dateLong = (date: string) => longDay(`${date}T12:00:00Z`);

/** Dollars from cents: 1234500 is "$12,345". */
export function money(cents: number): string {
  const dollars = cents / 100;
  const whole = Number.isInteger(dollars);
  return '$' + dollars.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

export const refLabel = (ref: string) => (ref.length === 6 ? `${ref.slice(0, 3)}-${ref.slice(3)}` : ref);

/** "Holden Beach" from "12 Ocean Blvd W, Holden Beach, NC 28462": the town, for short lists. */
export function townOf(address: string): string {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length >= 3 ? parts[parts.length - 2]! : (parts[0] ?? address);
}
