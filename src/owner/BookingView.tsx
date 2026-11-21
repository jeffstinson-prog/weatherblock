// One booking: everything we know, and what you can do about it.
import { useEffect, useState } from 'preact/hooks';
import { ApiError, api } from './api';
import { longDay, refLabel, whenLabel, windowLabel } from '../booking/format';
import { formatMobile } from '../booking/rules';
import { SlotPicker } from '../booking/ui';
import type { Slot } from '../booking/client';
import { STATUS_LABEL, directions } from './Today';

interface Detail {
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
  email: string;
  reason: string;
  someoneHome: string;
  hasGateCode: boolean;
  gateCode: string;
  pets: string;
  smsConsent: boolean;
  onMyWayAt: string | null;
  ownerNotes: string;
  relationship: string;
  roof: string;
  notes: string;
  leadSource: string;
  heardAbout: string;
  referralCode: string;
  referrerName: string;
  createdAt: string;
  cancelReason: string;
  photoUrls: { id: string; url: string }[];
  events: { at: string; actor: string; kind: string; detail: Record<string, unknown> }[];
  messages: { at: string; channel: string; direction: string; audience: string; kind: string; status: string; to: string; summary: string }[];
}

const MINUTES = [10, 15, 20, 30, 45, 60];

export default function BookingView(props: { id: string }) {
  const [b, setB] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [picked, setPicked] = useState<Slot | null>(null);
  const [tell, setTell] = useState(true);
  const [showGate, setShowGate] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  async function load() {
    try {
      const d = await api<Detail>(`booking/${props.id}`);
      setB(d);
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
      await api(`booking/${props.id}`, { body });
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

  if (error && !b) return <p class="owner-pad error-box" role="alert">{error}</p>;
  if (!b) return <p class="owner-pad" aria-live="polite">Loading...</p>;

  return (
    <section class="owner-pad booking-view">
      <p>
        <a href="#/today">Back to Today</a>
      </p>
      <h1>{b.address}</h1>
      <p class="lead-line">
        {whenLabel(b.startsAt, b.endsAt)} <span class={`chip ${b.status}`}>{STATUS_LABEL[b.status]}</span>
      </p>
      {flash && <p class="notice ok" role="status">{flash}</p>}
      {error && <p class="error-box" role="alert">{error}</p>}

      <div class="visit-actions">
        <a class="btn secondary" href={directions(b)} target="_blank" rel="noopener">Directions</a>
        <a class="btn secondary" href={`tel:${b.mobile}`}>Call {b.name.split(' ')[0]}</a>
        <a class="btn secondary" href={`sms:${b.mobile}`}>Text</a>
      </div>

      {b.status === 'booked' && (
        <section aria-labelledby="omw-h" class="panel">
          <h2 id="omw-h">On my way</h2>
          {b.smsConsent ? (
            <>
              <p class="muted small">Texts {b.name.split(' ')[0]} that you're on the way, and about how long.</p>
              <div class="minutes" role="group" aria-label="Minutes away">
                {MINUTES.map((m) => (
                  <button key={m} type="button" class="btn secondary" disabled={busy} onClick={() => void act({ action: 'on_my_way', minutes: m }, `Sent: on the way, about ${m} minutes.`)}>
                    {m} min
                  </button>
                ))}
              </div>
              {b.onMyWayAt && <p class="muted small">Last sent {new Date(b.onMyWayAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}.</p>}
            </>
          ) : (
            <p>They didn't agree to texts. Call them when you're on the way.</p>
          )}
        </section>
      )}

      <section aria-labelledby="who-h" class="panel">
        <h2 id="who-h">Customer</h2>
        <dl class="kv">
          <dt>Name</dt><dd>{b.name} ({b.relationship.toLowerCase()})</dd>
          <dt>Mobile</dt><dd><a href={`tel:${b.mobile}`}>{formatMobile(b.mobile)}</a></dd>
          <dt>Email</dt><dd><a href={`mailto:${b.email}`}>{b.email}</a></dd>
          <dt>Texts OK</dt><dd>{b.smsConsent ? 'Yes' : 'No'}</dd>
          <dt>Reference</dt><dd>{refLabel(b.ref)}</dd>
        </dl>
      </section>

      <section aria-labelledby="roof-h" class="panel">
        <h2 id="roof-h">Roof and visit</h2>
        <dl class="kv">
          <dt>Roof</dt><dd>{b.roof}</dd>
          <dt>Why</dt><dd>{b.reason}</dd>
          <dt>Their notes</dt><dd>{b.notes || 'None'}</dd>
          <dt>Someone home</dt><dd>{b.someoneHome}</dd>
          <dt>Gate code</dt>
          <dd>
            {b.hasGateCode ? (
              showGate ? <strong>{b.gateCode}</strong> : <button type="button" class="link-btn" onClick={() => setShowGate(true)}>Show gate code</button>
            ) : 'None'}
          </dd>
          <dt>Pets</dt><dd>{b.pets || 'None mentioned'}</dd>
        </dl>
        {b.photoUrls.length > 0 && (
          <ul class="photo-grid">
            {b.photoUrls.map((p, i) => (
              <li key={p.id}>
                <a href={p.url} target="_blank" rel="noopener">
                  <img src={p.url} alt={`Customer photo ${i + 1}`} loading="lazy" width={160} height={120} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="notes-h" class="panel">
        <h2 id="notes-h">Your notes</h2>
        <label for="owner-notes" class="visually-hidden">Your notes</label>
        <textarea id="owner-notes" rows={4} maxLength={5000} value={note} onInput={(e) => setNote((e.currentTarget as HTMLTextAreaElement).value)} />
        <button type="button" class="btn secondary" disabled={busy || note === b.ownerNotes} onClick={() => void act({ action: 'notes', notes: note }, 'Notes saved.')}>
          Save notes
        </button>
      </section>

      <section aria-labelledby="status-h" class="panel">
        <h2 id="status-h">Status</h2>
        <div class="minutes">
          {b.status !== 'done' && <button type="button" class="btn secondary" disabled={busy} onClick={() => void act({ action: 'status', status: 'done' }, 'Marked done.')}>Done</button>}
          {b.status !== 'no_show' && b.status !== 'cancelled' && <button type="button" class="btn secondary" disabled={busy} onClick={() => void act({ action: 'status', status: 'no_show' }, 'Marked no show.')}>No show</button>}
          {b.status !== 'booked' && <button type="button" class="btn secondary" disabled={busy} onClick={() => void act({ action: 'status', status: 'booked', tellCustomer: false }, 'Back to booked.')}>Back to booked</button>}
          {b.status === 'booked' && !confirmCancel && <button type="button" class="btn secondary" onClick={() => setConfirmCancel(true)}>Cancel it</button>}
        </div>
        {confirmCancel && (
          <div class="confirm">
            <label class="check"><input type="checkbox" checked={tell} onChange={(e) => setTell((e.currentTarget as HTMLInputElement).checked)} /> <span>Tell the customer by email{b.smsConsent ? ' and text' : ''}</span></label>
            <div class="minutes">
              <button type="button" class="btn secondary" onClick={() => setConfirmCancel(false)}>Keep it</button>
              <button type="button" class="btn danger" disabled={busy} onClick={() => void act({ action: 'status', status: 'cancelled', tellCustomer: tell }, 'Cancelled.').then(() => setConfirmCancel(false))}>Yes, cancel</button>
            </div>
          </div>
        )}
      </section>

      {b.status !== 'cancelled' && (
        <section aria-labelledby="move-h" class="panel">
          <h2 id="move-h">Reschedule</h2>
          {!moving ? (
            <button type="button" class="btn secondary" onClick={() => { setMoving(true); void api<{ slots: Slot[] }>('slots').then((d) => setSlots(d.slots)).catch((e: ApiError) => setError(e.message)); }}>
              Pick a new time
            </button>
          ) : slots === null ? (
            <p aria-live="polite">Loading open times...</p>
          ) : (
            <>
              <SlotPicker slots={slots} value={picked?.id ?? null} onChange={setPicked} />
              <label class="check"><input type="checkbox" checked={tell} onChange={(e) => setTell((e.currentTarget as HTMLInputElement).checked)} /> <span>Tell the customer about the new time</span></label>
              <div class="minutes">
                <button type="button" class="btn secondary" onClick={() => setMoving(false)}>Never mind</button>
                <button type="button" class="btn" disabled={busy || !picked} onClick={() => void act({ action: 'reschedule', slotId: picked!.id, tellCustomer: tell }, `Moved to ${picked ? `${longDay(picked.startsAt)}, ${windowLabel(picked.startsAt, picked.endsAt)}` : ''}.`).then((ok) => ok && setMoving(false))}>
                  Move it
                </button>
              </div>
            </>
          )}
        </section>
      )}

      <section aria-labelledby="src-h" class="panel">
        <h2 id="src-h">How they found us</h2>
        <p>
          {b.leadSource}
          {b.referralCode && ` (code ${b.referralCode}${b.referrerName ? `, ${b.referrerName}` : ''})`}
          {b.heardAbout && `. Said: ${b.heardAbout}`}
        </p>
        <p class="muted small">Booked {new Date(b.createdAt).toLocaleString('en-US', { timeZone: 'America/New_York' })}</p>
        {b.cancelReason && <p>Cancel reason: {b.cancelReason}</p>}
      </section>

      <details class="panel">
        <summary>Messages ({b.messages.length})</summary>
        <ul class="log">
          {b.messages.map((m, i) => (
            <li key={i}>
              <span class="muted small">{new Date(m.at).toLocaleString('en-US', { timeZone: 'America/New_York' })}, {m.direction === 'in' ? 'received' : `${m.channel} to ${m.audience}`}, {m.status}</span>
              <br />
              {m.summary}
            </li>
          ))}
        </ul>
      </details>
      <details class="panel">
        <summary>History ({b.events.length})</summary>
        <ul class="log">
          {b.events.map((e, i) => (
            <li key={i}>
              <span class="muted small">{new Date(e.at).toLocaleString('en-US', { timeZone: 'America/New_York' })}</span> {e.kind} by {e.actor}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
