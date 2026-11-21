// "Ask a question": the automated assistant. A page, not a pop-up.
import { useEffect, useRef, useState } from 'preact/hooks';
import Icon from '../icons/Icon';

interface Reply {
  answer: string;
  links: { slug: string; question: string }[];
  offer: 'none' | 'book' | 'call' | 'book_or_call';
  booking: { material: string; age: string; reason: string; note: string } | null;
  unknown: boolean;
}

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  reply?: Reply;
}

interface Props {
  phone: string;
  phoneHref: string;
  bookLabel: string;
  /** A few questions to start from, shown until the first one is asked. */
  starters?: string[];
}

const KEY = 'assistant-chat-v1';
const MAX_QUESTIONS = 8;

export default function AskApp(props: Props) {
  const p = props;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as Turn[];
      if (Array.isArray(saved)) setTurns(saved);
    } catch {
      /* start fresh */
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(turns));
    } catch {
      /* fine */
    }
  }, [turns]);

  const asked = turns.filter((t) => t.role === 'user').length;

  async function send(e: Event) {
    e.preventDefault();
    const q = text.trim();
    if (!q) {
      setError('Type a question first.');
      input.current?.focus();
      return;
    }
    setError('');
    setBusy(true);
    setStatus('Looking that up...');
    const next: Turn[] = [...turns, { role: 'user', text: q }];
    setTurns(next);
    setText('');
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turns: next.map((t) => ({ role: t.role, text: t.text })) }),
      });
      const data = (await res.json().catch(() => ({}))) as Reply & { message?: string };
      if (!res.ok) {
        setError(data.message ?? `Something went wrong. Call ${props.phone}.`);
        setTurns(turns); // take the question back so they can resend it
        setText(q);
        setStatus('');
        return;
      }
      setTurns([...next, { role: 'assistant', text: data.answer, reply: data }]);
      setStatus(`Answer: ${data.answer}`);
    } catch {
      setError("Can't reach the server. Check your connection and try again.");
      setTurns(turns);
      setText(q);
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  function book(r: Reply) {
    try {
      if (r.booking) {
        sessionStorage.setItem(
          'assistant-handoff-v1',
          JSON.stringify({ material: r.booking.material, age: r.booking.age, reason: r.booking.reason, notes: r.booking.note }),
        );
      } else {
        sessionStorage.setItem('assistant-handoff-v1', JSON.stringify({}));
      }
    } catch {
      /* booking still works */
    }
    location.href = '/book/';
  }

  return (
    <div class="ask">
      <div class="notice">
        <p>
          <strong>This is an automated assistant, not a person.</strong> It answers from our help center and can be wrong. It can't see
          your roof or your insurance policy. For anything important, call or text <a href={props.phoneHref}>{props.phone}</a>.
        </p>
      </div>

      <ol class="chat" aria-label="Conversation">
        {turns.map((t, i) => (
          <li key={i} class={t.role}>
            <p class="who">
              {t.role === 'assistant' && <Icon name="bot" size={16} />}
              {t.role === 'user' ? 'You' : 'Assistant'}
            </p>
            <p>{t.text}</p>
            {t.reply && t.reply.links.length > 0 && (
              <ul class="reads">
                {t.reply.links.map((l) => (
                  <li key={l.slug}>
                    <a href={`/help/${l.slug}/`}>
                      <Icon name="file-text" size={16} />
                      {l.question}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {t.reply && t.reply.offer !== 'none' && (
              <div class="actions">
                {(t.reply.offer === 'book' || t.reply.offer === 'book_or_call') && (
                  <button type="button" class="btn" onClick={() => book(t.reply!)}>
                    {props.bookLabel}
                  </button>
                )}
                {(t.reply.offer === 'call' || t.reply.offer === 'book_or_call' || t.reply.unknown) && (
                  <a class="btn secondary" href={props.phoneHref}>
                    Call {props.phone}
                  </a>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>

      <p class="visually-hidden" aria-live="polite">
        {status}
      </p>

      {asked >= MAX_QUESTIONS ? (
        <p>
          That's as many questions as the assistant takes in one go. Call or text <a href={props.phoneHref}>{props.phone}</a> and we'll
          answer the rest.
        </p>
      ) : (
        <form onSubmit={send} noValidate class="ask-form">
          <label for="question">Your question</label>
          <textarea
            id="question"
            ref={input}
            rows={3}
            maxLength={600}
            value={text}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? 'ask-error' : 'ask-hint'}
            onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
          />
          <p class="hint" id="ask-hint">
            For example: Will my insurance pay for a new roof?
          </p>
          {error && (
            <p class="error" id="ask-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" class="btn" disabled={busy}>
            {busy ? 'Looking it up...' : 'Ask'}
            {!busy && <Icon name="send" size={18} />}
          </button>
        </form>
      )}
      {turns.length === 0 && asked < MAX_QUESTIONS && (p.starters?.length ?? 0) > 0 && (
        <>
          <p class="starters-h" id="starters-h">
            Or start with one of these
          </p>
          <ul class="starters" aria-labelledby="starters-h">
            {p.starters!.map((q) => (
              <li key={q}>
                <button
                  type="button"
                  onClick={() => {
                    setText(q);
                    setError('');
                    input.current?.focus();
                  }}
                >
                  {q}
                  <Icon name="plus" size={18} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {turns.length > 0 && (
        <button
          type="button"
          class="link-btn"
          onClick={() => {
            setTurns([]);
            setError('');
            input.current?.focus();
          }}
        >
          Clear the conversation
        </button>
      )}
    </div>
  );
}
