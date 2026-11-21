// A day's inspections in time order, with directions, call and text.
import { useEffect, useState } from 'preact/hooks';
import Icon from '../icons/Icon';
import { ApiError, api } from './api';
import { TZ, dayKey, longDay, windowLabel } from '../booking/format';
import { formatMobile } from '../booking/rules';

export interface Row {
  id: string;
  ref: string;
  status: string;
  startsAt: string;
  endsAt: string;
  address: string;
  lat: number | null;
  lng: number | null;
  name: string;
  mobile: string;
  reason: string;
  someoneHome: string;
  hasGateCode: boolean;
  pets: string;
  photos: number;
  onMyWayAt: string | null;
}

export const STATUS_LABEL: Record<string, string> = { booked: 'Booked', done: 'Done', cancelled: 'Cancelled', no_show: 'No show' };

export function directions(r: { lat: number | null; lng: number | null; address: string }): string {
  const dest = r.lat !== null && r.lng !== null ? `${r.lat},${r.lng}` : r.address;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}

const shift = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export default function Today(props: { date: string | null }) {
  const [date, setDate] = useState(props.date ?? dayKey(new Date().toISOString()));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (props.date) setDate(props.date);
  }, [props.date]);

  useEffect(() => {
    setRows(null);
    setError('');
    api<{ bookings: Row[] }>(`day?date=${date}`)
      .then((d) => setRows(d.bookings))
      .catch((e: ApiError) => setError(e.message));
  }, [date]);

  const isToday = date === dayKey(new Date().toISOString());
  const label = longDay(`${date}T17:00:00Z`);
  const active = rows?.filter((r) => r.status !== 'cancelled') ?? [];
  const cancelled = rows?.filter((r) => r.status === 'cancelled') ?? [];

  return (
    <section class="owner-pad">
      <h1>{isToday ? 'Today' : label}</h1>
      {isToday && <p class="muted">{label}</p>}
      <div class="day-nav">
        <a class="btn secondary" href={`#/day/${shift(date, -1)}`}>
          <Icon name="chevron-left" size={18} />
          Previous day
        </a>
        {!isToday && <a class="btn secondary" href="#/today">Today</a>}
        <a class="btn secondary" href={`#/day/${shift(date, 1)}`}>
          Next day
          <Icon name="chevron-right" size={18} />
        </a>
      </div>
      {error && <p class="error-box" role="alert">{error}</p>}
      {rows === null && !error && <p aria-live="polite">Loading...</p>}
      {rows !== null && active.length === 0 && <p>No inspections booked.</p>}
      <ol class="visits">
        {active.map((r) => (
          <li key={r.id} class="visit">
            <a class="visit-main" href={`#/booking/${r.id}`}>
              <span class="when">{windowLabel(r.startsAt, r.endsAt)}</span>
              <span class={`chip ${r.status}`}>{STATUS_LABEL[r.status]}</span>
              <strong class="addr">{r.address}</strong>
              <span>{r.name}. {r.reason}.</span>
              <span class="muted small">
                Home: {r.someoneHome.toLowerCase()}
                {r.hasGateCode && '. Gate code'}
                {r.pets && `. Pets: ${r.pets}`}
                {r.photos > 0 && `. ${r.photos} photo${r.photos === 1 ? '' : 's'}`}
                {r.onMyWayAt && '. On-my-way text sent'}
              </span>
            </a>
            <div class="visit-actions">
              <a class="btn secondary" href={directions(r)} target="_blank" rel="noopener">
                <Icon name="navigation" size={18} />
                Directions
              </a>
              <a class="btn secondary" href={`tel:${r.mobile}`} aria-label={`Call ${r.name}, ${formatMobile(r.mobile)}`}>
                <Icon name="phone" size={18} />
                Call
              </a>
              <a class="btn secondary" href={`sms:${r.mobile}`} aria-label={`Text ${r.name}`}>
                <Icon name="message-square" size={18} />
                Text
              </a>
            </div>
          </li>
        ))}
      </ol>
      {cancelled.length > 0 && (
        <details class="cancelled">
          <summary>{cancelled.length} cancelled</summary>
          <ul>
            {cancelled.map((r) => (
              <li key={r.id}>
                <a href={`#/booking/${r.id}`}>
                  {windowLabel(r.startsAt, r.endsAt)}: {r.address}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p class="muted small">Times are {TZ.replace('America/New_York', 'Eastern')}.</p>
    </section>
  );
}
