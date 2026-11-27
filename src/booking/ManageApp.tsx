// The private link: the customer's own page for their roof, from booking to a
// finished job. Where things stand (the tracker), what happens next and the one
// thing to do about it, the estimate, photos, messages, who to call, and the
// documents. It's also where they change or cancel the visit and answer the estimate.
// The token sits after # in the link, so it's never sent in a URL to any server.
import { useEffect, useRef, useState } from 'preact/hooks';
import Icon from '../icons/Icon';
import { RequestFailed, post } from './client';
import { whenShownAgain } from './fresh';
import { progressSteps, showsTracker, stageOf } from './progress';
import Estimate from './portal/Estimate';
import Messages from './portal/Messages';
import NextStep from './portal/NextStep';
import NoticeBox from './portal/NoticeBox';
import Photos from './portal/Photos';
import { Documents, Team } from './portal/Side';
import Tracker from './portal/Tracker';
import type { Call, Notify, PortalBooking, PortalFacts, ThreadItem } from './portal/types';

/** A page left open this long loads again when it's shown: new messages, a sent estimate, fresh photo links. */
const REFRESH_MS = 10 * 60_000;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function ManageApp(props: PortalFacts) {
  const [token, setToken] = useState('');
  const [booking, setBooking] = useState<PortalBooking | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [fileUrl, setFileUrl] = useState('');
  const [notice, setNotice] = useState<{ text: string; where: 'top' | 'messages' } | null>(null);
  const loadedAt = useRef(0);
  /** The link this page is showing. An answer for an earlier one is dropped. */
  const shown = useRef('');
  const writeRef = useRef<HTMLTextAreaElement>(null);

  const call: Call = (payload) => post('/api/manage', { token, ...payload });

  /** A few minutes' link to the estimate PDF, when there is one. */
  async function loadFile(t: string, b: PortalBooking) {
    if (!b.estimate?.hasFile) return;
    const f = await post<{ url: string }>('/api/manage', { action: 'estimate_file', token: t }).catch(() => null);
    if (f && shown.current === t) setFileUrl(f.url);
  }

  async function load(t: string, quiet = false) {
    try {
      const res = await post<{ booking: PortalBooking }>('/api/manage', { action: 'get', token: t });
      if (shown.current !== t) return;
      loadedAt.current = Date.now();
      setBooking(res.booking);
      await loadFile(t, res.booking);
    } catch (err) {
      // A quiet reload that fails keeps what's on the screen.
      if (!quiet && shown.current === t) setError((err as RequestFailed).body?.message ?? 'Something went wrong.');
    }
  }

  /** Read the code after # and load that booking. */
  function open() {
    const t = decodeURIComponent(location.hash.replace(/^#/, ''));
    shown.current = t;
    setToken(t);
    setBooking(null);
    setFileUrl('');
    setNotice(null);
    setError('');
    if (!t) {
      setError('This link is missing its code. Open it again from your text or email.');
      setLoading(false);
      return;
    }
    setLoading(true);
    void load(t).finally(() => {
      if (shown.current === t) setLoading(false);
    });
  }

  useEffect(() => {
    open();
    // Another private link opened in this tab changes only the part after #: start over with it.
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);

  // Back to a tab left open: load the page again, so it shows what's new.
  useEffect(() => {
    if (!token || !booking) return;
    return whenShownAgain(() => {
      if (Date.now() - loadedAt.current > REFRESH_MS) void load(token, true);
    });
  }, [token, Boolean(booking)]);

  const apply = (b: PortalBooking) => {
    loadedAt.current = Date.now();
    setBooking(b);
    if (b.estimate?.hasFile && !fileUrl) void loadFile(token, b);
  };
  const notify: Notify = (text, where = 'top') => setNotice(text ? { text, where } : null);
  const onThread = (messages: ThreadItem[]) => setBooking((b) => (b ? { ...b, messages } : b));

  /** "Send us a message": straight to the box, keyboard up on a phone. */
  const write = () => {
    const box = writeRef.current;
    if (!box) return;
    box.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
    box.focus({ preventScroll: true });
  };

  const head = (
    <header class="portal-head">
      <h1>Your roof project</h1>
      {booking && (
        <p class="portal-where">
          <Icon name="map-pin" size={18} />
          {booking.address}
        </p>
      )}
    </header>
  );

  if (loading) {
    return (
      <div class="portal">
        {head}
        <p class="measuring" aria-live="polite">
          Looking up your booking...
        </p>
      </div>
    );
  }

  if (!booking) {
    return (
      <div class="portal">
        {head}
        <div class="error-box" role="alert">
          <p>{error}</p>
          <p>
            Call or text <a href={props.phoneHref}>{props.phone}</a> and we'll help.
          </p>
        </div>
      </div>
    );
  }

  const stage = stageOf(booking);
  const card = { booking, facts: props, call, apply, notify, onWrite: write };

  return (
    <div class="portal">
      {head}
      <div class="portal-grid">
        <div class="portal-main">
          {notice?.where === 'top' && <NoticeBox text={notice.text} />}
          {showsTracker(stage) && <Tracker steps={progressSteps(booking)} />}
          {stage === 'estimate' || stage === 'declined' ? (
            <Estimate key="estimate-next" {...card} fileUrl={fileUrl} next />
          ) : (
            <NextStep key={`next-${stage}`} {...card} stage={stage} />
          )}
          {booking.estimate && (stage === 'approved' || stage === 'scheduled' || stage === 'job_done') && (
            <Estimate key="estimate-record" {...card} fileUrl={fileUrl} next={false} />
          )}
          <Photos photos={booking.photos} beforeVisit={stage === 'upcoming'} />
          <Messages
            messages={booking.messages}
            facts={props}
            call={call}
            onThread={onThread}
            notify={notify}
            notice={notice?.where === 'messages' ? notice.text : null}
            writeRef={writeRef}
          />
        </div>
        <div class="portal-side">
          <Team booking={booking} facts={props} />
          <Documents booking={booking} fileUrl={fileUrl} />
        </div>
      </div>
    </div>
  );
}
