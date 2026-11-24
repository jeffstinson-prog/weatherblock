// One estimate request: who asked, the roof from above, and what to do next:
// call them, book a time for them, send them the link, or close it.
import { useEffect, useState } from 'preact/hooks';
import Icon from '../icons/Icon';
import { ApiError, api } from './api';
import { refLabel } from '../booking/format';
import { formatMobile } from '../booking/rules';
import { REQUEST_LABEL, ago, type RequestRow } from './Requests';
import RoofPanel, { type RoofSheet } from './RoofPanel';
import { directions } from './Today';

interface Detail extends RequestRow {
  email: string;
  lat: number | null;
  lng: number | null;
  leadSource: string;
  ownerNotes: string;
  closeReason: string;
  remindedAt: string | null;
  roofSheet: RoofSheet | null;
  picture: string | null;
  canMeasure: boolean;
  prefill: { place: { text: string }; contact: { name: string; mobile: string; email: string } };
  link: string;
  messages: { at: string; channel: string; audience: string; kind: string; status: string; to: string; summary: string }[];
}

const CLOSE_REASONS = ['No answer after a few tries', 'Not interested', "Not work we do", 'Asked twice', 'Something else'];

export default function RequestView(props: { id: string; businessName: string }) {
  const [r, setR] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState(CLOSE_REASONS[0]!);

  async function load() {
    try {
      const d = await api<Detail>(`request/${props.id}`);
      setR(d);
      setNote(d.ownerNotes);
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  useEffect(() => {
    void load();
  }, [props.id]);

  async function act(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError('');
    setFlash('');
    try {
      await api(`request/${props.id}`, { body });
      setFlash(done);
      await load();
      return true;
    } catch (e) {
      setError((e as ApiError).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Open the booking form with their address and details already in, to pick a time while they're on the phone. */
  function bookForThem() {
    if (!r) return;
    try {
      localStorage.removeItem('booking-draft-v1');
      sessionStorage.setItem('estimate-handoff-v1', JSON.stringify({ place: r.prefill.place, contact: r.prefill.contact }));
    } catch {
      // Storage is off: the form opens empty.
    }
    location.href = '/estimate/book/';
  }

  if (error && !r) return <p class="owner-pad error-box" role="alert">{error}</p>;
  if (!r) return <p class="owner-pad" aria-live="polite">Loading...</p>;

  const first = r.name.split(' ')[0] ?? '';
  const open = r.status === 'new' || r.status === 'called';
  const linkText = `Hi ${first}, this is ${props.businessName}. Here's the link to pick a time for your roof estimate: ${r.link}`;

  return (
    <section class="owner-pad booking-view">
      <p>
        <a href="#/requests">Back to requests</a>
      </p>
      <h1>{r.name}</h1>
      <p class="lead-line">
        Asked for an estimate {ago(r.createdAt)} <span class={`chip req-${r.status}`}>{REQUEST_LABEL[r.status]}</span>
      </p>
      {flash && <p class="notice ok" role="status">{flash}</p>}
      {error && <p class="error-box" role="alert">{error}</p>}

      <div class="visit-actions">
        <a class="btn" href={`tel:${r.mobile}`}>
          <Icon name="phone" size={18} />
          Call {formatMobile(r.mobile)}
        </a>
        <a class="btn secondary" href={`sms:${r.mobile}`}>
          <Icon name="message-square" size={18} />
          Text
        </a>
        <a class="btn secondary" href={directions(r)} target="_blank" rel="noopener">
          <Icon name="navigation" size={18} />
          Directions
        </a>
      </div>

      <section aria-labelledby="next-h" class="panel">
        <h2 id="next-h">Next step</h2>
        {r.status === 'booked' && (
          <p>
            Booked. {r.bookingId ? <a href={`#/booking/${r.bookingId}`}>Open the booking</a> : 'The booking was removed.'}
          </p>
        )}
        {r.status === 'closed' && <p>Closed{r.closeReason ? `: ${r.closeReason}` : ''}.</p>}
        {open && (
          <>
            <p class="muted small">
              {r.status === 'new' ? 'Call them, then mark it called so the other owner knows.' : `Called ${ago(r.calledAt ?? r.createdAt)}. Book their visit when they're ready.`}
            </p>
            <div class="minutes">
              {r.status === 'new' && (
                <button type="button" class="btn secondary" disabled={busy} onClick={() => void act({ action: 'status', status: 'called' }, 'Marked called.')}>
                  Mark called
                </button>
              )}
              <button type="button" class="btn" onClick={bookForThem}>
                Book a time for them
              </button>
              <a class="btn secondary" href={`sms:${r.mobile}?&body=${encodeURIComponent(linkText)}`}>
                Text them the booking link
              </a>
            </div>
            <p class="muted small">
              "Book a time for them" opens the booking form with their address and details filled in. Tick the box for texts only if they
              say yes to texts. "Text them the booking link" opens your own messages with the link ready to send.
            </p>
          </>
        )}
        <div class="minutes">
          {open && !closing && (
            <button type="button" class="btn secondary" onClick={() => setClosing(true)}>
              Close it
            </button>
          )}
          {r.status === 'called' && (
            <button type="button" class="btn secondary" disabled={busy} onClick={() => void act({ action: 'status', status: 'new' }, 'Back to "to call".')}>
              Back to "to call"
            </button>
          )}
          {r.status === 'closed' && (
            <button type="button" class="btn secondary" disabled={busy} onClick={() => void act({ action: 'status', status: 'new' }, 'Reopened.')}>
              Reopen
            </button>
          )}
        </div>
        {closing && (
          <div class="confirm">
            <label for="close-reason">Why?</label>
            <select id="close-reason" value={reason} onChange={(e) => setReason((e.currentTarget as HTMLSelectElement).value)}>
              {CLOSE_REASONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <div class="minutes">
              <button type="button" class="btn secondary" onClick={() => setClosing(false)}>
                Keep it open
              </button>
              <button type="button" class="btn danger" disabled={busy} onClick={() => void act({ action: 'status', status: 'closed', reason }, 'Closed.').then(() => setClosing(false))}>
                Close the request
              </button>
            </div>
          </div>
        )}
      </section>

      <RoofPanel
        roof={r.roofSheet}
        picture={r.picture}
        address={r.address}
        busy={busy}
        onMeasure={r.canMeasure ? () => void act({ action: 'measure' }, 'Measured.') : undefined}
      />

      <section aria-labelledby="who-h" class="panel">
        <h2 id="who-h">Customer</h2>
        <dl class="kv">
          <dt>Name</dt><dd>{r.name}</dd>
          <dt>Mobile</dt><dd><a href={`tel:${r.mobile}`}>{formatMobile(r.mobile)}</a></dd>
          <dt>Email</dt><dd>{r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : 'Not given'}</dd>
          <dt>Home</dt><dd>{r.address}</dd>
          <dt>Found us</dt><dd>{r.leadSource}</dd>
          <dt>Reference</dt><dd>{refLabel(r.ref)}</dd>
        </dl>
      </section>

      <section aria-labelledby="notes-h" class="panel">
        <h2 id="notes-h">Your notes</h2>
        <label for="request-notes" class="visually-hidden">Your notes</label>
        <textarea id="request-notes" rows={4} maxLength={5000} value={note} onInput={(e) => setNote((e.currentTarget as HTMLTextAreaElement).value)} />
        <button type="button" class="btn secondary" disabled={busy || note === r.ownerNotes} onClick={() => void act({ action: 'notes', notes: note }, 'Notes saved.')}>
          Save notes
        </button>
      </section>

      <details class="panel">
        <summary>Messages ({r.messages.length})</summary>
        <ul class="log">
          {r.messages.map((m, i) => (
            <li key={i}>
              <span class="muted small">
                {new Date(m.at).toLocaleString('en-US', { timeZone: 'America/New_York' })}, {m.channel} to {m.audience}, {m.status}
              </span>
              <br />
              {m.summary}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
