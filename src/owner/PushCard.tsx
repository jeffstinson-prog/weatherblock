// Turning phone notifications on (or off) for this phone. On the home screen it
// shows only until they're on; in More it also sends a test and turns them off.
import { useEffect, useState } from 'preact/hooks';
import Icon from '../icons/Icon';
import { ApiError } from './api';
import { pushState, sendTest, turnOff, turnOn, type PushState } from './push';

export default function PushCard(props: { compact?: boolean }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    pushState().then(setState, () => setState('unsupported'));
  }, []);

  if (!state) return null;
  if (props.compact && (state === 'on' || state === 'unsupported')) return null;

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError('');
    setNote('');
    try {
      await fn();
      setNote(done);
      setState(await pushState());
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'That didn\'t work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class={`card push-card ${state === 'on' ? 'is-on' : ''}`} aria-labelledby="push-h">
      <div class="push-head">
        <span class="push-icon" aria-hidden="true">
          <Icon name={state === 'on' ? 'bell-ring' : 'bell'} size={22} />
        </span>
        <h2 id="push-h">{state === 'on' ? 'Notifications are on' : 'Get a ping for every new lead'}</h2>
      </div>
      {state === 'off' && (
        <>
          <p>New estimate requests, bookings, cancellations and replies show up on this phone the moment they come in.</p>
          <button type="button" class="btn" disabled={busy} onClick={() => void run(turnOn, 'Done. Sending a test now...').then(() => sendTest().catch(() => {}))}>
            <Icon name="bell" size={18} />
            {busy ? 'Turning on...' : 'Turn on notifications'}
          </button>
        </>
      )}
      {state === 'install-first' && (
        <ol class="push-steps">
          <li>
            In Safari, tap the Share button, then <strong>Add to Home Screen</strong>.
          </li>
          <li>Open the app from your Home Screen and sign in.</li>
          <li>
            Tap <strong>Turn on notifications</strong> there. iPhones only send them to apps on the Home Screen.
          </li>
        </ol>
      )}
      {state === 'blocked' && (
        <p>
          Notifications are blocked for this app. Turn them on in your phone's <strong>Settings</strong>, under <strong>Notifications</strong>, then come back.
        </p>
      )}
      {state === 'unsupported' && <p>This browser can't show notifications. Use the app on your phone.</p>}
      {state === 'on' && !props.compact && (
        <>
          <p>This phone gets a ping for every new estimate request, booking, cancellation and reply.</p>
          <div class="step-actions">
            <button type="button" class="btn secondary" disabled={busy} onClick={() => void run(sendTest, 'Sent. It should show up in a few seconds.')}>
              Send a test
            </button>
            <button type="button" class="btn secondary" disabled={busy} onClick={() => void run(turnOff, 'Turned off for this phone.')}>
              Turn off
            </button>
          </div>
        </>
      )}
      <p class="small" role="status">
        {note}
      </p>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
