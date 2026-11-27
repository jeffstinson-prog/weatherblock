// The written estimate: the price, what's included, the roof, the PDF, and the
// customer's answer. While it waits for an answer it leads the page; after that it
// stays further down as a record.
import { useState } from 'preact/hooks';
import Icon from '../../icons/Icon';
import type { RequestFailed } from '../client';
import { longDay, money } from '../format';
import type { Call, Notify, PortalBooking, PortalFacts } from './types';

type Mode = 'view' | 'accept' | 'question' | 'decline';

const paragraphs = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

export default function Estimate(props: {
  booking: PortalBooking;
  facts: PortalFacts;
  fileUrl: string;
  /** Leading the page: the next step is the customer's answer. */
  next: boolean;
  call: Call;
  apply: (b: PortalBooking) => void;
  notify: Notify;
  onWrite: () => void;
}) {
  const { booking, facts } = props;
  const est = booking.estimate!;
  const [mode, setMode] = useState<Mode>('view');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const open = (m: Mode) => {
    setMode(m);
    setError('');
    props.notify(null);
  };

  async function answer(kind: 'accept' | 'question' | 'decline') {
    if (kind === 'question' && !note.trim()) {
      setError('Type your question first.');
      document.getElementById('question')?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await props.call<{ booking: PortalBooking }>({ action: 'answer', answer: kind, note });
      props.apply(res.booking);
      setMode('view');
      setNote('');
      props.notify(
        kind === 'accept'
          ? "Thank you! We'll pick a day for the job and let you know."
          : kind === 'question'
            ? `Got it. We'll get back to you soon. You can also call or text ${facts.phone}.`
            : `Thanks for letting us know. If you change your mind, call or text ${facts.phone}.`,
      );
    } catch (err) {
      setError((err as RequestFailed).body?.message ?? 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class={`estimate-card${props.next ? ' next-card' : ''}`} aria-labelledby="est-h">
      <h2 id="est-h">
        <Icon name="receipt-text" size={16} />
        Your estimate
      </h2>
      {est.amountCents !== null && <p class="price">{money(est.amountCents)}</p>}
      {props.next && est.status === 'sent' && <p class="lead-line">It's ready. Look it over, then tell us what you'd like to do.</p>}
      {est.summary && (
        <div class="scope">
          {paragraphs(est.summary).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}
      {est.roofSqft !== null && (
        <div class="roof-facts">
          <h3>Your roof</h3>
          {booking.roofPicture && (
            <figure class="aerial">
              <div class="aerial-frame">
                <img src={booking.roofPicture} alt={`Satellite view of ${booking.address}`} width={640} height={400} loading="lazy" />
              </div>
            </figure>
          )}
          <dl>
            <div>
              <dt>Size</dt>
              <dd>
                {est.roofSqft.toLocaleString('en-US')} square feet ({(est.roofSqft / 100).toFixed(1).replace(/\.0$/, '')} squares)
              </dd>
            </div>
            {est.roofPitch !== null && (
              <div>
                <dt>Pitch</dt>
                <dd>{est.roofPitch === 0 ? 'Flat' : `${est.roofPitch}/12`}</dd>
              </div>
            )}
          </dl>
          <p class="muted small">
            A square is 100 square feet of roof.
            {booking.roofPicture && (
              <>
                {' '}
                Picture:{' '}
                <span class="gmp-attribution" translate={false}>
                  Google Maps
                </span>
                .
              </>
            )}
          </p>
        </div>
      )}
      {props.fileUrl && (
        <p>
          <a class="btn secondary" href={props.fileUrl} target="_blank" rel="noopener">
            <Icon name="file-text" size={18} />
            Open the full estimate (PDF)
            <span class="visually-hidden"> (opens in a new tab)</span>
          </a>
        </p>
      )}
      <p class="muted small">Sent {longDay(est.sentAt)}.</p>

      {est.status === 'sent' && mode === 'view' && (
        <>
          {est.askedAt && <p class="asked">We got your question and will get back to you.</p>}
          <div class="actions">
            <button type="button" class="btn" onClick={() => open('accept')}>
              <Icon name="check" size={18} stroke={2.5} />
              Yes, let's do it
            </button>
            <button type="button" class="btn secondary" onClick={() => open('question')}>
              I have a question
            </button>
            <button type="button" class="btn secondary" onClick={() => open('decline')}>
              No thanks
            </button>
          </div>
        </>
      )}
      {est.status === 'accepted' && <p class="decided">You said yes{est.decidedAt ? ` on ${longDay(est.decidedAt)}` : ''}. Thank you.</p>}
      {est.status === 'declined' && (
        <>
          <p class="decided">You said no thanks{est.decidedAt ? ` on ${longDay(est.decidedAt)}` : ''}.</p>
          <p>
            Thanks for letting us know. If you change your mind, call or text <a href={facts.phoneHref}>{facts.phone}</a>, or send us a message.
          </p>
          <div class="actions">
            <button type="button" class="btn secondary" onClick={props.onWrite}>
              <Icon name="message-square" size={18} />
              Send us a message
            </button>
          </div>
        </>
      )}

      {error && (
        <div class="error-box" role="alert">
          <p>{error}</p>
        </div>
      )}

      {mode === 'accept' && (
        <div class="confirm-box">
          <p>
            <strong>Go ahead with this estimate?</strong> We'll pick a day for the job and let you know by email{booking.smsConsent ? ' and text' : ''}.
          </p>
          <div class="step-actions">
            <button type="button" class="btn secondary" onClick={() => open('view')}>
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
            <textarea
              id="question"
              rows={4}
              maxLength={1000}
              value={note}
              aria-invalid={error ? 'true' : undefined}
              onInput={(e) => setNote((e.currentTarget as HTMLTextAreaElement).value)}
            />
          </div>
          <div class="step-actions">
            <button type="button" class="btn secondary" onClick={() => open('view')}>
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
            <button type="button" class="btn secondary" onClick={() => open('view')}>
              Go back
            </button>
            <button type="button" class="btn" disabled={busy} onClick={() => void answer('decline')}>
              {busy ? 'Saving...' : 'No thanks'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
