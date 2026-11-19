// Dates and windows, always in the business's time zone.
export const TZ = 'America/New_York';

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts });

/** "2026-11-20", for grouping windows by day. */
export function dayKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** "Fri, Nov 20" */
export const shortDay = (iso: string) => fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso));

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
export const refLabel = (ref: string) => (ref.length === 6 ? `${ref.slice(0, 3)}-${ref.slice(3)}` : ref);
