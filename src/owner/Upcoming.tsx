// The next two weeks: bookings by day, and any window holding more than it should.
import { useEffect, useState } from 'preact/hooks';
import { ApiError, api } from './api';
import { dayKey, longDay, windowLabel } from '../booking/format';
import { STATUS_LABEL, type Row } from './Today';

interface Window {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  booked: number;
}

export default function Upcoming() {
  const [data, setData] = useState<{ bookings: Row[]; windows: Window[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ bookings: Row[]; windows: Window[] }>('upcoming')
      .then(setData)
      .catch((e: ApiError) => setError(e.message));
  }, []);

  const days = new Map<string, Row[]>();
  for (const b of data?.bookings ?? []) days.set(dayKey(b.startsAt), [...(days.get(dayKey(b.startsAt)) ?? []), b]);
  const over = (data?.windows ?? []).filter((w) => w.booked > w.capacity);

  return (
    <section class="owner-pad">
      <h1>Upcoming</h1>
      <p class="muted">The next two weeks.</p>
      {error && <p class="error-box" role="alert">{error}</p>}
      {data === null && !error && <p aria-live="polite">Loading...</p>}
      {over.length > 0 && (
        <div class="error-box" role="status">
          <p>
            {over.length === 1 ? 'One window has' : `${over.length} windows have`} more bookings than inspectors, after a day off or a
            calendar event. Move one:
          </p>
          <ul>
            {over.map((w) => (
              <li key={w.id}>
                {longDay(w.startsAt)}, {windowLabel(w.startsAt, w.endsAt)}: {w.booked} booked, room for {w.capacity}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data !== null && days.size === 0 && <p>Nothing booked in the next two weeks.</p>}
      {[...days.entries()].map(([day, list]) => (
        <section key={day} class="up-day" aria-labelledby={`d-${day}`}>
          <h2 id={`d-${day}`}>
            <a href={`#/day/${day}`}>{longDay(list[0]!.startsAt)}</a>
          </h2>
          <ul class="up-list">
            {list.map((b) => (
              <li key={b.id}>
                <a href={`#/booking/${b.id}`}>
                  <span class="when">{windowLabel(b.startsAt, b.endsAt)}</span> {b.address}{' '}
                  <span class={`chip ${b.status}`}>{STATUS_LABEL[b.status]}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
