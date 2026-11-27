// The card under the tracker: what happens next, said plainly, with the one
// thing to do about it. The estimate, while it waits for an answer, is its own
// card (Estimate.tsx); everything else is here.
import { useEffect, useRef, useState } from 'preact/hooks';
import Icon, { type IconName } from '../../icons/Icon';
import { downloadIcs, googleCalendarUrl } from '../calendar';
import { getSlots, type RequestFailed, type Slot } from '../client';
import { dateLong, dayWord, longDay, refLabel, whenLabel, windowLabel } from '../format';
import { STALE_MS, stillAhead, whenShownAgain } from '../fresh';
import { SlotPicker } from '../ui';
import type { Stage } from '../progress';
import type { Call, Notify, PortalBooking, PortalFacts } from './types';

interface CardProps {
  booking: PortalBooking;
  facts: PortalFacts;
  call: Call;
  apply: (b: PortalBooking) => void;
  notify: Notify;
  /** Jump to the message box. */
  onWrite: () => void;
}

function Heading(props: { icon: IconName; children: string; chip?: { text: string; tone: string } }) {
  return (
    <div class="next-top">
      <h2 id="next-h">
        <Icon name={props.icon} size={16} />
        {props.children}
      </h2>
      {props.chip && <span class={`chip ${props.chip.tone}`}>{props.chip.text}</span>}
    </div>
  );
}

function WriteButton(props: { onWrite: () => void; label?: string }) {
  return (
    <div class="actions">
      <button type="button" class="btn secondary" onClick={props.onWrite}>
        <Icon name="message-square" size={18} />
        {props.label ?? 'Send us a message'}
      </button>
    </div>
  );
}

// Before the visit: when it is, change it, cancel it, put it on a calendar.

function UpcomingVisit(props: CardProps) {
  const { booking, facts } = props;
  const [mode, setMode] = useState<'view' | 'reschedule' | 'cancel'>('view');
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [picked, setPicked] = useState<Slot | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // When the open times were last loaded, so a tab left open can tell they're old.
  const slotsAt = useRef(0);

  /** The open times, minus any that have started. A picked time no longer open is unpicked. */
  async function loadSlots(): Promise<void> {
    const list = stillAhead(await getSlots());
    slotsAt.current = Date.now();
    setSlots(list);
    setPicked((p) => (p && list.some((s) => s.id === p.id) ? p : null));
  }

  async function startReschedule() {
    setMode('reschedule');
    setError('');
    props.notify(null);
    try {
      await loadSlots();
    } catch (err) {
      setError((err as RequestFailed).body.message);
    }
  }

  // Picking a new time in a tab left open: load the times again when they're old.
  useEffect(() => {
    if (mode !== 'reschedule') return;
    return whenShownAgain(() => {
      if (slotsAt.current > 0 && Date.now() - slotsAt.current > STALE_MS) void loadSlots().catch(() => {});
    });
  }, [mode]);

  async function confirmReschedule() {
    if (!picked) {
      setError('Choose a day and a time window.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await props.call<{ booking: PortalBooking }>({ action: 'reschedule', slotId: picked.id });
      props.apply(res.booking);
      setMode('view');
      setPicked(null);
      props.notify(`Done. Your new time is ${whenLabel(res.booking.startsAt, res.booking.endsAt)}.`);
    } catch (err) {
      const body = (err as RequestFailed).body;
      setError(body.message);
      if (body.error === 'slot_full') await loadSlots().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function confirmCancel() {
    setBusy(true);
    setError('');
    try {
      const res = await props.call<{ booking: PortalBooking }>({ action: 'cancel', reason });
      props.apply(res.booking);
      props.notify('Your inspection is cancelled. Nothing else to do.');
    } catch (err) {
      setError((err as RequestFailed).body.message);
      setBusy(false);
    }
  }

  const event = {
    ref: refLabel(booking.ref),
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    title: `Roof inspection: ${facts.businessName}`,
    location: booking.address,
    description: `Reference ${refLabel(booking.ref)}. Questions: ${facts.phone}.`,
    domain: facts.domain,
  };
  const about = [
    facts.byDrone ? 'We inspect your roof by drone during your window.' : '',
    facts.homeNotRequired ? "You don't have to be home." : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section class="estimate-card next-card" aria-labelledby="next-h">
      <Heading icon="calendar-days">Your inspection</Heading>
      <p class="price">
        {dayWord(booking.startsAt)}, {windowLabel(booking.startsAt, booking.endsAt)}
      </p>
      {about && <p>{about}</p>}
      {facts.deliverables && <p class="muted">After the visit, you get {facts.deliverables}.</p>}

      {error && (
        <div class="error-box" role="alert">
          <p>{error}</p>
        </div>
      )}

      {mode === 'view' && booking.canChange && (
        <div class="actions">
          <button type="button" class="btn" onClick={() => void startReschedule()}>
            <Icon name="calendar-clock" size={18} />
            Change the time
          </button>
          <button
            type="button"
            class="btn secondary"
            onClick={() => {
              setMode('cancel');
              setError('');
              props.notify(null);
            }}
          >
            <Icon name="calendar-x" size={18} />
            Cancel the inspection
          </button>
        </div>
      )}
      {mode === 'view' && !booking.canChange && (
        <p>
          It's too close to the visit to change it here. Call or text <a href={facts.phoneHref}>{facts.phone}</a>.
        </p>
      )}
      {mode === 'view' && (
        <details class="add-cal">
          <summary class="link-btn">
            <Icon name="calendar-plus" size={18} />
            Add it to your calendar
          </summary>
          <div class="actions">
            <button type="button" class="btn secondary" onClick={() => downloadIcs(event)}>
              Apple or Outlook calendar
            </button>
            <a class="btn secondary" href={googleCalendarUrl(event, facts.phone)} target="_blank" rel="noopener">
              Google Calendar
              <span class="visually-hidden"> (opens in a new tab)</span>
            </a>
          </div>
        </details>
      )}

      {mode === 'reschedule' && (
        <div class="flow-box" role="group" aria-labelledby="re-h">
          <h3 id="re-h">Pick a new time</h3>
          {slots === null ? (
            <p aria-live="polite">Loading open times...</p>
          ) : slots.length === 0 ? (
            <p>
              No open times online right now. Call or text <a href={facts.phoneHref}>{facts.phone}</a>.
            </p>
          ) : (
            <SlotPicker slots={slots} value={picked?.id ?? null} onChange={setPicked} />
          )}
          <div class="step-actions">
            <button
              type="button"
              class="btn secondary"
              onClick={() => {
                setMode('view');
                setError('');
              }}
            >
              Keep my time
            </button>
            <button type="button" class="btn" disabled={busy || !picked} onClick={() => void confirmReschedule()}>
              {busy ? 'Saving...' : 'Confirm the new time'}
            </button>
          </div>
        </div>
      )}

      {mode === 'cancel' && (
        <div class="flow-box" role="group" aria-labelledby="cx-h">
          <h3 id="cx-h">Cancel this inspection?</h3>
          <div class="field">
            <label for="reason">
              Mind telling us why? <span class="hint">(optional)</span>
            </label>
            <textarea id="reason" rows={3} maxLength={500} value={reason} onInput={(e) => setReason((e.currentTarget as HTMLTextAreaElement).value)} />
          </div>
          <div class="step-actions">
            <button
              type="button"
              class="btn secondary"
              onClick={() => {
                setMode('view');
                setError('');
              }}
            >
              Keep it
            </button>
            <button type="button" class="btn danger" disabled={busy} onClick={() => void confirmCancel()}>
              {busy ? 'Cancelling...' : 'Yes, cancel it'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// After the visit, before the estimate.

function AwaitingEstimate(props: CardProps) {
  const { booking, facts } = props;
  return (
    <section class="estimate-card next-card" aria-labelledby="next-h">
      <Heading icon="file-text">Your estimate</Heading>
      <p class="headline">We're working on it</p>
      <p>
        It will be ready {facts.turnaround || 'soon'}. We'll email you{booking.smsConsent ? ' and text you' : ''} when it is, and it will show
        here.
      </p>
      <WriteButton onWrite={props.onWrite} label="Questions? Send us a message" />
    </section>
  );
}

// The roof job: a day to pick, the day, then done.

const PREP: { icon: IconName; text: string }[] = [
  { icon: 'car', text: 'Move cars out of the driveway the evening before.' },
  { icon: 'paw-print', text: 'Keep pets inside while we work.' },
  { icon: 'trees', text: 'We protect your plants and landscaping.' },
  { icon: 'volume-2', text: 'Expect noise from 7 am to 5 pm.' },
];

function JobCard(props: CardProps) {
  const { booking, facts } = props;
  const job = booking.job;
  if (job?.status === 'done') {
    return (
      <section class="estimate-card next-card" aria-labelledby="next-h">
        <Heading icon="circle-check">Your roof job</Heading>
        <p class="headline">All done. Thank you.</p>
        <p>
          {job.doneAt ? `We finished on ${longDay(job.doneAt)}. ` : ''}If anything doesn't look right, call or text{' '}
          <a href={facts.phoneHref}>{facts.phone}</a>.
        </p>
        {facts.reviewUrl && (
          <>
            <p>If you have a minute, a Google review helps neighbors find us.</p>
            <div class="actions">
              <a class="btn" href={facts.reviewUrl} target="_blank" rel="noopener">
                <Icon name="star" size={18} />
                Leave a Google review
                <span class="visually-hidden"> (opens in a new tab)</span>
              </a>
            </div>
          </>
        )}
      </section>
    );
  }
  if (job?.status === 'scheduled' && job.day) {
    const today = dayWord(`${job.day}T12:00:00Z`);
    return (
      <section class="estimate-card next-card" aria-labelledby="next-h">
        <Heading icon="hard-hat">Your roof job</Heading>
        <p class="price">
          {today === 'Today' ? 'Today, ' : today === 'Tomorrow' ? 'Tomorrow, ' : ''}
          {dateLong(job.day)}
        </p>
        <p>Weather can move it. If it does, we'll tell you right away. We'll send a reminder the evening before.</p>
        <div class="prep">
          <h3>Before the day</h3>
          <ul class="prep-list">
            {PREP.map((p) => (
              <li key={p.icon}>
                <span class="prep-icon" aria-hidden="true">
                  <Icon name={p.icon} size={18} />
                </span>
                {p.text}
              </li>
            ))}
          </ul>
        </div>
        <WriteButton onWrite={props.onWrite} label="Questions about the day? Send us a message" />
      </section>
    );
  }
  return (
    <section class="estimate-card next-card" aria-labelledby="next-h">
      <Heading icon="calendar-days">Your roof job</Heading>
      <p class="headline">Next, we pick a day</p>
      <p>We'll pick a day for the job and let you know.</p>
      <p class="muted">Weather can move a roof job. If it does, we'll tell you right away.</p>
      <WriteButton onWrite={props.onWrite} />
    </section>
  );
}

// A visit that won't happen.

function Cancelled(props: CardProps) {
  const { booking, facts } = props;
  return (
    <section class="estimate-card next-card" aria-labelledby="next-h">
      <Heading icon="calendar-x" chip={{ text: 'Cancelled', tone: 'cancelled' }}>
        Your inspection
      </Heading>
      <p>Your inspection on {whenLabel(booking.startsAt, booking.endsAt)} was cancelled.</p>
      <p>If you'd like us to look at your roof later, book a new time.</p>
      <div class="actions">
        <a class="btn" href="/book/">
          {facts.bookLabel}
        </a>
      </div>
    </section>
  );
}

function Missed(props: CardProps) {
  const { booking, facts } = props;
  return (
    <section class="estimate-card next-card" aria-labelledby="next-h">
      <Heading icon="calendar-x" chip={{ text: 'Missed', tone: 'no_show' }}>
        Your inspection
      </Heading>
      <p class="headline">We missed each other</p>
      <p>
        Your inspection was set for {whenLabel(booking.startsAt, booking.endsAt)}. Call or text {facts.phone} and we'll find a new time.
      </p>
      <div class="actions">
        {facts.phoneHref && (
          <a class="btn" href={facts.phoneHref}>
            <Icon name="phone" size={18} />
            Call {facts.phone}
          </a>
        )}
        {facts.smsHref && (
          <a class="btn secondary" href={facts.smsHref}>
            <Icon name="message-square" size={18} />
            Text us
          </a>
        )}
      </div>
    </section>
  );
}

/** The next step for every stage but the estimate's own. */
export default function NextStep(props: CardProps & { stage: Exclude<Stage, 'estimate' | 'declined'> }) {
  switch (props.stage) {
    case 'upcoming':
      return <UpcomingVisit {...props} />;
    case 'awaiting_estimate':
      return <AwaitingEstimate {...props} />;
    case 'approved':
    case 'scheduled':
    case 'job_done':
      return <JobCard {...props} />;
    case 'cancelled':
      return <Cancelled {...props} />;
    case 'missed':
      return <Missed {...props} />;
  }
}
