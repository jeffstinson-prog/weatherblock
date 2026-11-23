// Estimate requests: people who asked for an estimate and are waiting for a call.
// The ones nobody has called yet come first, oldest at the top.
import { useEffect, useState } from 'preact/hooks';
import Icon from '../icons/Icon';
import { ApiError, api } from './api';
import { shortDay } from '../booking/format';
import { formatMobile } from '../booking/rules';

export interface RequestRow {
  id: string;
  ref: string;
  status: 'new' | 'called' | 'booked' | 'closed';
  name: string;
  mobile: string;
  address: string;
  createdAt: string;
  calledAt: string | null;
  bookingId: string | null;
  roof: string;
}

export interface RequestLists {
  toCall: RequestRow[];
  called: RequestRow[];
  booked: RequestRow[];
  closed: RequestRow[];
}

export const REQUEST_LABEL: Record<RequestRow['status'], string> = { new: 'To call', called: 'Called', booked: 'Booked', closed: 'Closed' };

/** "12 minutes ago", "3 hours ago", then the day. */
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 90) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  return shortDay(iso);
}

/** People to call, as cards with the call button right there. Used on Today and on the requests screen. */
export function ToCall(props: { rows: RequestRow[] }) {
  return (
    <ol class="visits">
      {props.rows.map((r) => (
        <li key={r.id} class="visit">
          <a class="visit-main" href={`#/request/${r.id}`}>
            <span class="when">{r.name}</span>
            <span class="chip req-new">Asked {ago(r.createdAt)}</span>
            <strong class="addr">{r.address}</strong>
            <span class="muted small">{r.roof}</span>
          </a>
          <div class="visit-actions">
            <a class="btn" href={`tel:${r.mobile}`} aria-label={`Call ${formatMobile(r.mobile)}, ${r.name}`}>
              <Icon name="phone" size={18} />
              Call {formatMobile(r.mobile)}
            </a>
            <a class="btn secondary" href={`#/request/${r.id}`}>
              Open
            </a>
          </div>
        </li>
      ))}
    </ol>
  );
}

function List(props: { rows: RequestRow[]; when: (r: RequestRow) => string }) {
  return (
    <ul class="up-list">
      {props.rows.map((r) => (
        <li key={r.id}>
          <a href={`#/request/${r.id}`}>
            <span class="when">{props.when(r)}</span> {r.name}, {r.address}
          </a>
        </li>
      ))}
    </ul>
  );
}

export default function Requests() {
  const [data, setData] = useState<RequestLists | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<RequestLists>('requests')
      .then(setData)
      .catch((e: ApiError) => setError(e.message));
  }, []);

  return (
    <section class="owner-pad">
      <p>
        <a href="#/today">Back to Today</a>
      </p>
      <h1>Estimate requests</h1>
      <p class="muted">People who asked for an estimate on the website. Call the new ones first.</p>
      {error && <p class="error-box" role="alert">{error}</p>}
      {data === null && !error && <p aria-live="polite">Loading...</p>}
      {data && (
        <>
          <section aria-labelledby="req-new-h">
            <h2 id="req-new-h">To call ({data.toCall.length})</h2>
            {data.toCall.length === 0 ? <p class="muted">Nobody is waiting for a call.</p> : <ToCall rows={data.toCall} />}
          </section>

          <section aria-labelledby="req-called-h">
            <h2 id="req-called-h">Called, not booked yet ({data.called.length})</h2>
            {data.called.length === 0 ? <p class="muted">None.</p> : <List rows={data.called} when={(r) => `Called ${ago(r.calledAt ?? r.createdAt)}`} />}
          </section>

          {data.booked.length > 0 && (
            <section aria-labelledby="req-booked-h">
              <h2 id="req-booked-h">Booked, last 30 days ({data.booked.length})</h2>
              <List rows={data.booked} when={(r) => shortDay(r.createdAt)} />
            </section>
          )}

          {data.closed.length > 0 && (
            <details class="panel">
              <summary>Closed, last 30 days ({data.closed.length})</summary>
              <List rows={data.closed} when={(r) => shortDay(r.createdAt)} />
            </details>
          )}
        </>
      )}
    </section>
  );
}
