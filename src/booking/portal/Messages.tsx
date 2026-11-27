// Messages: what we've sent the customer (by email and text), what they've sent
// us, and a box to write to us. Oldest first, like any conversation; the latest
// few show, and the rest are one tap away.
import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import Icon, { type IconName } from '../../icons/Icon';
import type { RequestFailed } from '../client';
import { stampLabel } from '../format';
import NoticeBox from './NoticeBox';
import type { Call, Notify, PortalFacts, ThreadItem } from './types';

const SHOWN = 6;
const MAX = 1000;

function channel(m: ThreadItem): { icon: IconName; label: string } {
  const [first] = m.channels;
  if (m.channels.length > 1) return { icon: 'mail', label: 'Email and text' };
  if (first === 'email') return { icon: 'mail', label: 'Email' };
  if (first === 'sms') return { icon: 'smartphone', label: 'Text' };
  if (first === 'estimate') return { icon: 'receipt-text', label: 'About your estimate' };
  return { icon: 'message-square', label: m.from === 'you' ? 'From this page' : 'Message' };
}

export default function Messages(props: {
  messages: ThreadItem[];
  facts: PortalFacts;
  call: Call;
  onThread: (messages: ThreadItem[]) => void;
  notify: Notify;
  /** The note under the box after sending, if any. */
  notice: string | null;
  writeRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const { messages, facts } = props;
  const [all, setAll] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const firstHidden = useRef<string | null>(null);

  const hidden = all ? 0 : Math.max(0, messages.length - SHOWN);
  const shown = messages.slice(hidden);

  // Showing the earlier messages: focus moves to the first of them, where the button was.
  useEffect(() => {
    if (all && firstHidden.current) document.getElementById(`msg-${firstHidden.current}`)?.focus();
  }, [all]);

  async function submit(e: Event) {
    e.preventDefault();
    if (busy) return;
    const body = text.trim();
    if (!body) {
      setError('Type your message first.');
      props.writeRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    props.notify(null);
    try {
      const res = await props.call<{ messages: ThreadItem[] }>({ action: 'message', body });
      props.onThread(res.messages);
      setText('');
      props.notify("Sent. We'll get back to you soon.", 'messages');
    } catch (err) {
      setError((err as RequestFailed).body?.message ?? 'Something went wrong. Try again.');
      props.writeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  const left = MAX - text.length;
  const describedBy = ['portal-message-hint', left <= 100 ? 'portal-message-count' : '', error ? 'portal-message-error' : ''].filter(Boolean).join(' ');

  return (
    <section class="portal-section" aria-labelledby="messages-h">
      <h2 id="messages-h">
        <Icon name="message-square" size={20} />
        Messages
      </h2>
      <p class="muted section-note">What we've sent you, and what you've sent us.</p>
      {hidden > 0 && (
        <button
          type="button"
          class="link-btn more-msgs"
          onClick={() => {
            firstHidden.current = messages[0]?.id ?? null;
            setAll(true);
          }}
        >
          <Icon name="chevron-down" size={18} />
          Show {hidden} earlier {hidden === 1 ? 'message' : 'messages'}
        </button>
      )}
      {messages.length === 0 ? (
        <p class="muted">No messages yet.</p>
      ) : (
        <ol class="thread">
          {shown.map((m, i) => {
            const c = channel(m);
            // Who wrote it shows at the start of each run; screen readers hear it every time.
            const first = shown[i - 1]?.from !== m.from;
            return (
              <li key={m.id} id={`msg-${m.id}`} class={`msg ${m.from}`} tabIndex={-1}>
                <p class={first ? 'msg-who' : 'visually-hidden'}>{m.from === 'us' ? facts.businessName : 'You'}</p>
                <p class="msg-text">{m.text}</p>
                <p class="msg-meta">
                  <Icon name={c.icon} size={14} />
                  <span>
                    {c.label}
                    <span aria-hidden="true"> · </span>
                    <span class="visually-hidden">, </span>
                    {stampLabel(m.at)}
                  </span>
                </p>
              </li>
            );
          })}
        </ol>
      )}

      <form class="composer" onSubmit={(e) => void submit(e)} noValidate>
        <label for="portal-message">Send us a message</label>
        <p class="hint" id="portal-message-hint">
          For anything urgent, call {facts.phone}.
        </p>
        <textarea
          id="portal-message"
          name="message"
          rows={4}
          maxLength={MAX}
          value={text}
          ref={props.writeRef}
          aria-describedby={describedBy}
          aria-invalid={error ? 'true' : undefined}
          onInput={(e) => {
            setText((e.currentTarget as HTMLTextAreaElement).value);
            if (error) setError('');
          }}
        />
        {error && (
          <p class="error" id="portal-message-error" role="alert">
            {error}
          </p>
        )}
        <div class="composer-foot">
          {left <= 100 && (
            <p class="hint count" id="portal-message-count">
              {left === 1 ? '1 character left' : `${left} characters left`}
            </p>
          )}
          <button type="submit" class="btn" disabled={busy}>
            <Icon name="send" size={18} />
            {busy ? 'Sending...' : 'Send message'}
          </button>
        </div>
        {props.notice && <NoticeBox text={props.notice} />}
      </form>
    </section>
  );
}
