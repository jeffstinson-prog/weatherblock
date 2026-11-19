// "Add to calendar". The .ics file is made on the phone, so the address
// never goes into a link. The Google link carries only the time and our name.

interface Event {
  ref: string;
  startsAt: string;
  endsAt: string;
  title: string;
  location: string;
  description: string;
  domain: string;
}

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

/** Lines longer than 75 bytes are folded, as the calendar format requires. */
function fold(line: string): string {
  const out: string[] = [];
  let current = '';
  for (const ch of line) {
    if (new TextEncoder().encode(current + ch).length > 75) {
      out.push(current);
      current = ' ' + ch;
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.join('\r\n');
}

export function icsText(e: Event): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//roof-inspection//booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.ref}@${e.domain}`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(e.startsAt)}`,
    `DTEND:${stamp(e.endsAt)}`,
    `SUMMARY:${escapeText(e.title)}`,
    `LOCATION:${escapeText(e.location)}`,
    `DESCRIPTION:${escapeText(e.description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function downloadIcs(e: Event): void {
  const blob = new Blob([icsText(e)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'roof-inspection.ics';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function googleCalendarUrl(e: Pick<Event, 'ref' | 'startsAt' | 'endsAt' | 'title'>, phone: string): string {
  const u = new URL('https://calendar.google.com/calendar/render');
  u.searchParams.set('action', 'TEMPLATE');
  u.searchParams.set('text', e.title);
  u.searchParams.set('dates', `${stamp(e.startsAt)}/${stamp(e.endsAt)}`);
  u.searchParams.set('details', `Reference ${e.ref}. Questions: ${phone}.`);
  return u.toString();
}
