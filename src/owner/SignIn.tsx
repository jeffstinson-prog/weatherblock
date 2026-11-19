// Sign in with a 6-digit code sent by email. No passwords.
// (A code works inside the installed app; email links would open the browser instead.)
import { useEffect, useRef, useState } from 'preact/hooks';
import { auth } from './api';

export default function SignIn(props: { businessName: string; onIn: () => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => heading.current?.focus(), [step]);

  if (!auth) {
    return (
      <div class="owner-pad">
        <h1>Owner sign-in</h1>
        <p class="error-box">Sign-in isn't set up yet. The site needs PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY.</p>
      </div>
    );
  }

  async function sendCode(e: Event) {
    e.preventDefault();
    setError('');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError('Enter your email address, like name@example.com.');
      return;
    }
    setBusy(true);
    const { error: err } = await auth!.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } });
    setBusy(false);
    if (err) {
      setError(
        err.status === 429
          ? 'Too many codes asked for. Wait a minute and try again.'
          : "We couldn't send a code to that address. Use the email you were set up with.",
      );
      return;
    }
    setStep('code');
  }

  async function verify(e: Event) {
    e.preventDefault();
    setError('');
    const token = code.replace(/\D/g, '');
    if (token.length < 6) {
      setError('Enter the 6-digit code from the email.');
      return;
    }
    setBusy(true);
    const { error: err } = await auth!.verifyOtp({ email: email.trim(), token, type: 'email' });
    setBusy(false);
    if (err) {
      setError("That code didn't work. Check it, or send a new one.");
      return;
    }
    props.onIn();
  }

  return (
    <div class="owner-pad signin">
      <p class="eyebrow">{props.businessName}</p>
      {step === 'email' ? (
        <form onSubmit={sendCode} noValidate>
          <h1 tabIndex={-1} ref={heading}>
            Owner sign-in
          </h1>
          <div class="field">
            <label for="owner-email">Your email</label>
            <input id="owner-email" type="email" autoComplete="email" inputMode="email" value={email} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? 'signin-error' : undefined} onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)} />
          </div>
          {error && <p class="error" id="signin-error" role="alert">{error}</p>}
          <button class="btn block" type="submit" disabled={busy}>
            {busy ? 'Sending...' : 'Email me a code'}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} noValidate>
          <h1 tabIndex={-1} ref={heading}>
            Enter your code
          </h1>
          <p>We emailed a 6-digit code to {email}.</p>
          <div class="field">
            <label for="owner-code">Code</label>
            <input id="owner-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? 'code-error' : undefined} onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)} />
          </div>
          {error && <p class="error" id="code-error" role="alert">{error}</p>}
          <button class="btn block" type="submit" disabled={busy}>
            {busy ? 'Checking...' : 'Sign in'}
          </button>
          <button type="button" class="link-btn" onClick={() => { setStep('email'); setCode(''); setError(''); }}>
            Use a different email or send a new code
          </button>
        </form>
      )}
    </div>
  );
}
