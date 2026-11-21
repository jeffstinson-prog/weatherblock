// The private link: see the booking, change the time, or cancel. After the
// visit, the same link shows the estimate (and takes the answer), then the job.
// The token sits after # in the link, so it's never sent in a URL to any server.
import { useEffect, useRef, useState } from 'preact/hooks';
import { RequestFailed, getSlots, post, type Slot } from './client';
import { downloadIcs, googleCalendarUrl } from './calendar';
import { dateLong, longDay, money, refLabel, whenLabel } from './format';
import { SlotPicker } from './ui';

interface Booking {
  ref: string;
  status: 'booked' | 'done' | 'cancelled' | 'no_show';
  startsAt: string;
  endsAt: string;
  address: string;
  firstName: string;
  smsConsent: boolean;
  canChange: boolean;
  estimate: {
    status: 'sent' | 'accepted' | 'declined';
    amountCents: number | null;
    summary: string;
    hasFile: boolean;
    sentAt: string;
    decidedAt: string | null;
    askedAt: string | null;
  } | null;
  job: { status: 'to_schedule' | 'scheduled' | 'done'; day: string | null; doneAt: string | null } | null;
}

interface Props {
  businessName: string;
  phone: string;
  phoneHref: string;
  bookLabel: string;
  domain: string;
}

type Mode = 'view' | 'reschedule' | 'cancel' | 'accept' | 'question' | 'decline';

export default function ManageApp(props: Props) {
  const [token, setToken] = useState('');
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>('view');
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [picked, setPicked] = useState<Slot | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const live = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = decodeURIComponent(location.hash.replace(/^#/, ''));
    setToken(t);
    if (!t) {
      setError('This link is missing its code. Open it again from your text or email.');
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const res = await post<{ booking: Booking }>('/api/manage', { action: 'get', token: t });
        setBooking(res.booking);
        if (res.booking.estimate?.hasFile) {
          const f = await post<{ url: string }>('/api/manage', { action: 'estimate_file', token: t }).catch(() => null);
          if (f) setFileUrl(f.url);
        }
      } catch (err) {
        setError((err as RequestFailed).body?.message ?? 'Something went wrong.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (message) live.current?.focus();
  }, [message]);

  async function startReschedule() {
    setMode('reschedule');
    setMessage('');
    setError('');
    try {
      setSlots(await getSlots());
    } catch (err) {
      setError((err as RequestFailed).body.message);
    }
  }

  async function confirmReschedule() {
    if (!picked) {
      setError('Choose a day and a time window.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await post<{ booking: Booking }>('/api/manage', { action: 'reschedule', token, slotId: picked.id });
      setBooking(res.booking);
      setMode('view');
      setPicked(null);
      setMessage(`Done. Your new time is ${whenLabel(res.booking.startsAt, res.booking.endsAt)}.`);
    } catch (err) {
      const body = (err as RequestFailed).body;
      setError(body.message);
      if (body.error === 'slot_full') setSlots(await getSlots().catch(() => slots));
    } finally {
      setBusy(false);
    }
  }

  async function answer(kind: 'accept' | 'question' | 'decline') {
    if (kind === 'question' && !note.trim()) {
      setError('Type your question first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await post<{ booking: Booking }>('/api/manage', { action: 'answer', token, answer: kind, note });
      setBooking(res.booking);
      setMode('view');
      setNote('');
      setMessage(
        kind === 'accept'
          ? "Thank you! We'll pick a day for the job and let you know."
          : kind === 'question'
            ? `Got it. We'll get back to you soon. You can also call or text ${props.phone}.`
            : `Thanks for letting us know. If you change your mind, call or text ${props.phone}.`,
      );
    } catch (err) {
      setError((err as RequestFailed).body?.message ?? 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmCancel() {
    setBusy(true);
    setError('');
    try {
      const res = await post<{ booking: Booking }>('/api/manage', { action: 'cancel', token, reason });
      setBooking(res.booking);
      setMode('view');
      setMessage('Your inspection is cancelled. Nothing else to do.');
    } catch (err) {
      setError((err as RequestFailed).body.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p aria-live="polite">Looking up your booking...</p>;

  if (!booking) {
    return (
      <div class="error-box" role="alert">
        <p>{error}</p>
        <p>
          Call or text <a href={props.phoneHref}>{props.phone}</a> and we'll help.
        </p>
      </div>
    );
  }

  const event = {
    ref: refLabel(booking.ref),
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    title: `Roof inspection: ${props.businessName}`,
    location: booking.address,
    description: `Reference ${refLabel(booking.ref)}. Questions: ${props.phone}.`,
    domain: props.domain,
  };
  const statusText: Record<Booking['status'], string> = {
    booked: 'Booked',
    done: 'Done',
    cancelled: 'Cancelled',
    no_show: 'Missed',
  };

  const est = booking.estimate;
  const job = booking.job;
  const paragraphs = (text: string) => text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  return (
    <div class="booking manage">
      {message && (
        <div class="notice ok" role="status" tabIndex={-1} ref={live}>
          <p>{message}</p>
        </div>
      )}

      {job && (
        <section class="estimate-card" aria-labelledby="job-h">
          <h2 id="job-h">Your roof job</h2>
          {job.status === 'scheduled' && job.day && (
            <>
              <p class="price">{dateLong(job.day)}</p>
              <p>Weather can move it. If it does, we'll tell you right away. We'll send a reminder the evening before.</p>
            </>
          )}
          {job.status === 'to_schedule' && <p>We'll pick a day for the job and let you know.</p>}
          {job.status === 'done' && <p>Done{job.doneAt ? ` on ${longDay(job.doneAt)}` : ''}. Thank you for trusting us with your roof.</p>}
          <p class="muted small">
            Questions? Call or text <a href={props.phoneHref}>{props.phone}</a>.
          </p>
        </section>
      )}

      {est && (
        <section class="estimate-card" aria-labelledby="est-h">
          <h2 id="est-h">Your estimate</h2>
          {est.amountCents !== null && <p class="price">{money(est.amountCents)}</p>}
          {est.summary && (
            <div class="scope">
              {paragraphs(est.summary).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          )}
          {fileUrl && (
            <p>
              <a class="btn secondary" href={fileUrl} target="_blank" rel="noopener">
                Open the full estimate (PDF)
              </a>
            </p>
          )}
          <p class="muted small">Sent {longDay(est.sentAt)}.</p>

          {est.status === 'sent' && mode === 'view' && (
            <>
              {est.askedAt && <p>We got your question and will get back to you.</p>}
              <div class="actions">
                <button type="button" class="btn" onClick={() => { setMode('accept'); setMessage(''); setError(''); }}>
                  Yes, let's do it
                </button>
                <button type="button" class="btn secondary" onClick={() => { setMode('question'); setMessage(''); setError(''); }}>
                  I have a question
                </button>
                <button type="button" class="btn secondary" onClick={() => { setMode('decline'); setMessage(''); setError(''); }}>
                  No thanks
                </button>
              </div>
            </>
          )}
          {est.status === 'accepted' && !job?.day && (
            <p>You said yes{est.decidedAt ? ` on ${longDay(est.decidedAt)}` : ''}. Thank you!</p>
          )}
          {est.status === 'declined' && (
            <p>
              You said no thanks. If you change your mind, call or text <a href={props.phoneHref}>{props.phone}</a>.
            </p>
          )}

          {mode === 'accept' && (
            <div class="confirm-box">
              <p>
                <strong>Go ahead with this estimate?</strong> We'll pick a day for the job and let you know by email{booking.smsConsent ? ' and text' : ''}.
              </p>
              <div class="step-actions">
                <button type="button" class="btn secondary" onClick={() => setMode('view')}>
                  Not yet
                </button>
                <button type="button" class="btn" disabled={busy} onClick={() => void answer('accept')}>
                  {busy ? 'Saving...' : 'Yes, go ahead'}
                </button>
              </div>
            </div>
          )}
          {mode === 'question' && (
            <div class="confirm-box">
              <div class="field">
                <label for="question">Your question</label>
                <textarea id="question" rows={4} maxLength={1000} value={note} onInput={(e) => setNote((e.currentTarget as HTMLTextAreaElement).value)} />
              </div>
              <div class="step-actions">
                <button type="button" class="btn secondary" onClick={() => setMode('view')}>
                  Never mind
                </button>
                <button type="button" class="btn" disabled={busy} onClick={() => void answer('question')}>
                  {busy ? 'Sending...' : 'Send my question'}
                </button>
              </div>
            </div>
          )}
          {mode === 'decline' && (
            <div class="confirm-box">
              <div class="field">
                <label for="decline">
                  Mind telling us why? <span class="hint">(optional)</span>
                </label>
                <textarea id="decline" rows={3} maxLength={1000} value={note} onInput={(e) => setNote((e.currentTarget as HTMLTextAreaElement).value)} />
              </div>
              <div class="step-actions">
                <button type="button" class="btn secondary" onClick={() => setMode('view')}>
                  Go back
                </button>
                <button type="button" class="btn" disabled={busy} onClick={() => void answer('decline')}>
                  {busy ? 'Saving...' : 'No thanks'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {(est || job) && <h2 class="visit-h">The inspection</h2>}
      <dl class="summary">
        <div>
          <dt>Status</dt>
          <dd>{statusText[booking.status]}</dd>
        </div>
        <div>
          <dt>When</dt>
          <dd>{whenLabel(booking.startsAt, booking.endsAt)}</dd>
        </div>
        <div>
          <dt>Where</dt>
          <dd>{booking.address}</dd>
        </div>
        <div>
          <dt>Reference</dt>
          <dd>{refLabel(booking.ref)}</dd>
        </div>
      </dl>

      {error && (
        <div class="error-box" role="alert">
          <p>{error}</p>
        </div>
      )}

      {mode === 'view' && booking.canChange && (
        <div class="actions">
          <button type="button" class="btn" onClick={() => void startReschedule()}>
            Change the time
          </button>
          <button type="button" class="btn secondary" onClick={() => { setMode('cancel'); setMessage(''); setError(''); }}>
            Cancel the inspection
          </button>
        </div>
      )}

      {mode === 'view' && booking.status === 'booked' && (
        <div class="actions">
          <button type="button" class="btn secondary" onClick={() => downloadIcs(event)}>
            Add to Apple or Outlook calendar
          </button>
          <a class="btn secondary" href={googleCalendarUrl(event, props.phone)} target="_blank" rel="noopener">
            Add to Google Calendar
          </a>
        </div>
      )}

      {mode === 'view' && !booking.canChange && booking.status === 'booked' && (
        <p>
          It's too close to the visit to change it here. Call or text <a href={props.phoneHref}>{props.phone}</a>.
        </p>
      )}

      {mode === 'view' && booking.status === 'cancelled' && (
        <p>
          <a class="btn" href="/book/">
            {props.bookLabel}
          </a>
        </p>
      )}

      {mode === 'reschedule' && (
        <section aria-labelledby="re-h">
          <h2 id="re-h">Pick a new time</h2>
          {slots === null ? (
            <p aria-live="polite">Loading open times...</p>
          ) : slots.length === 0 ? (
            <p>
              No open times online right now. Call or text <a href={props.phoneHref}>{props.phone}</a>.
            </p>
          ) : (
            <SlotPicker slots={slots} value={picked?.id ?? null} onChange={setPicked} />
          )}
          <div class="step-actions">
            <button type="button" class="btn secondary" onClick={() => { setMode('view'); setError(''); }}>
              Keep my time
            </button>
            <button type="button" class="btn" disabled={busy || !picked} onClick={() => void confirmReschedule()}>
              {busy ? 'Saving...' : 'Confirm the new time'}
            </button>
          </div>
        </section>
      )}

      {mode === 'cancel' && (
        <section aria-labelledby="cx-h">
          <h2 id="cx-h">Cancel this inspection?</h2>
          <div class="field">
            <label for="reason">
              Mind telling us why? <span class="hint">(optional)</span>
            </label>
            <textarea id="reason" rows={3} maxLength={500} value={reason} onInput={(e) => setReason((e.currentTarget as HTMLTextAreaElement).value)} />
          </div>
          <div class="step-actions">
            <button type="button" class="btn secondary" onClick={() => { setMode('view'); setError(''); }}>
              Keep it
            </button>
            <button type="button" class="btn danger" disabled={busy} onClick={() => void confirmCancel()}>
              {busy ? 'Cancelling...' : 'Yes, cancel it'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
