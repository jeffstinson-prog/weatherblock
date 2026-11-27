// Export, referral codes, your alerts, sign out.
import { useEffect, useState } from 'preact/hooks';
import Icon, { type IconName } from '../icons/Icon';
import { ApiError, api, auth, download } from './api';
import { dayKey } from '../booking/format';
import PushCard from './PushCard';

interface Me {
  name: string;
  email: string;
  mobile: string;
  alertSms: boolean;
  alertEmail: boolean;
}

const monthStart = () => `${dayKey(new Date().toISOString()).slice(0, 8)}01`;

export default function More(props: { businessName: string }) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(dayKey(new Date(Date.now() + 30 * 86_400_000).toISOString()));
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');

  useEffect(() => {
    api<Me>('me')
      .then(setMe)
      .catch((e: ApiError) => setError(e.message));
  }, []);

  async function exportCsv(e: Event) {
    e.preventDefault();
    setError('');
    if (!from || !to || to < from) {
      setError('Pick a start date and an end date after it.');
      return;
    }
    try {
      await download(`export?from=${from}&to=${to}`, `bookings-${from}-to-${to}.csv`);
      setFlash('Export downloaded.');
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  async function saveMe(e: Event) {
    e.preventDefault();
    setError('');
    try {
      await api('me', { body: { mobile: me!.mobile, alertSms: me!.alertSms, alertEmail: me!.alertEmail } });
      setFlash('Alert settings saved.');
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  return (
    <section class="owner-pad">
      <h1>More</h1>
      {flash && <p class="notice ok" role="status">{flash}</p>}
      {error && <p class="error-box" role="alert">{error}</p>}

      <ul class="rows">
        {[
          { href: '#/estimates', label: 'Estimates', icon: 'file-text' },
          { href: '#/jobs', label: 'Roof jobs', icon: 'hammer' },
          { href: '#/requests', label: 'Estimate requests', icon: 'phone-call' },
          { href: '#/team', label: 'Team', icon: 'user-check' },
          { href: '#/reports', label: 'Reports', icon: 'chart-column' },
          { href: '#/upcoming', label: 'Next two weeks', icon: 'calendar-range' },
          { href: '#/crews', label: 'Crews', icon: 'hard-hat' },
          { href: '#/availability', label: 'Inspection availability', icon: 'calendar-clock' },
          { href: '#/referrals', label: 'Referral codes', icon: 'share-2' },
          { href: '#/questions', label: 'Questions people asked the assistant', icon: 'circle-help' },
        ].map((l) => (
          <li key={l.href}>
            <a href={l.href}>
              <span class="row-label">
                <Icon name={l.icon as IconName} size={20} />
                {l.label}
              </span>
              <Icon name="chevron-right" size={20} />
            </a>
          </li>
        ))}
      </ul>

      <h2>Export bookings</h2>
      <form onSubmit={exportCsv} noValidate class="export">
        <div class="field">
          <label for="from">From</label>
          <input id="from" type="date" value={from} onInput={(e) => setFrom((e.currentTarget as HTMLInputElement).value)} />
        </div>
        <div class="field">
          <label for="to">To</label>
          <input id="to" type="date" value={to} onInput={(e) => setTo((e.currentTarget as HTMLInputElement).value)} />
        </div>
        <button type="submit" class="btn secondary">Download CSV</button>
        <p class="hint">Includes lead source and referral codes. Gate codes are never exported.</p>
      </form>

      {me && (
        <>
          <h2>Your alerts</h2>
          <PushCard />
          <form onSubmit={saveMe} noValidate>
            <p class="muted small">Signed in as {me.email}.</p>
            <div class="field">
              <label for="my-mobile">Your mobile for alerts</label>
              <input id="my-mobile" type="tel" inputMode="tel" autoComplete="tel" value={me.mobile} onInput={(e) => setMe({ ...me, mobile: (e.currentTarget as HTMLInputElement).value })} />
            </div>
            <label class="check field" for="alert-sms">
              <input id="alert-sms" type="checkbox" checked={me.alertSms} onChange={(e) => setMe({ ...me, alertSms: (e.currentTarget as HTMLInputElement).checked })} />
              <span>Text me when a booking comes in or changes</span>
            </label>
            <label class="check field" for="alert-email">
              <input id="alert-email" type="checkbox" checked={me.alertEmail} onChange={(e) => setMe({ ...me, alertEmail: (e.currentTarget as HTMLInputElement).checked })} />
              <span>Email me too</span>
            </label>
            <button type="submit" class="btn secondary">Save alerts</button>
          </form>
        </>
      )}

      <h2>Install on your phone</h2>
      <p class="small">
        iPhone: tap Share, then "Add to Home Screen". Android: tap the menu, then "Install app" or "Add to Home screen".
      </p>

      <p>
        <button type="button" class="btn secondary" onClick={() => void auth?.signOut({ scope: 'local' })}>
          <Icon name="log-out" size={18} />
          Sign out
        </button>
      </p>
      <p class="muted small">
        <a href="/">{props.businessName} website</a>
      </p>
    </section>
  );
}
