// Referral codes for agents and property managers. Each gets a link to share.
import { useEffect, useState } from 'preact/hooks';
import { ApiError, api } from './api';

interface Ref {
  code: string;
  name: string;
  kind: 'agent' | 'property_manager' | 'other';
  company: string;
  phone: string;
  email: string;
  active: boolean;
  bookings: number;
}

const KINDS = { agent: 'Real estate agent', property_manager: 'Property manager', other: 'Other' } as const;
const blank: Omit<Ref, 'bookings'> = { code: '', name: '', kind: 'agent', company: '', phone: '', email: '', active: true };

export default function Referrals(props: { domain: string }) {
  const [list, setList] = useState<Ref[] | null>(null);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');

  const load = () =>
    api<{ referrers: Ref[] }>('referrers')
      .then((d) => setList(d.referrers))
      .catch((e: ApiError) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  async function save(r: Omit<Ref, 'bookings'>, message: string) {
    setError('');
    try {
      await api('referrers', { body: r });
      setFlash(message);
      setForm(blank);
      await load();
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  const link = (code: string) => `https://${props.domain}/r/${code}`;

  return (
    <section class="owner-pad">
      <p><a href="#/more">Back to More</a></p>
      <h1>Referral codes</h1>
      <p class="muted">Bookings from a code's link are tagged with it, and the export shows who sent them.</p>
      {flash && <p class="notice ok" role="status">{flash}</p>}
      {error && <p class="error-box" role="alert">{error}</p>}
      <ul class="plain-list refs">
        {(list ?? []).map((r) => (
          <li key={r.code} class={r.active ? '' : 'muted'}>
            <strong>{r.code}</strong>: {r.name}
            {r.company && `, ${r.company}`} ({KINDS[r.kind]}). {r.bookings} booking{r.bookings === 1 ? '' : 's'}.
            <br />
            <span class="small">{link(r.code)}</span>{' '}
            <button type="button" class="link-btn" onClick={() => void navigator.clipboard?.writeText(link(r.code)).then(() => setFlash(`Copied the link for ${r.code}.`))}>
              Copy link<span class="visually-hidden"> for {r.code}</span>
            </button>{' '}
            <button type="button" class="link-btn" onClick={() => void save({ ...r, active: !r.active }, r.active ? `${r.code} turned off.` : `${r.code} turned on.`)}>
              {r.active ? 'Turn off' : 'Turn on'}<span class="visually-hidden"> {r.code}</span>
            </button>
          </li>
        ))}
      </ul>
      <h2>Add a code</h2>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save(form, `Added ${form.code.toUpperCase()}.`);
        }}
      >
        <div class="field">
          <label for="ref-code">Code</label>
          <p class="hint" id="ref-code-hint">Letters and numbers, like SMITH24.</p>
          <input id="ref-code" type="text" autoComplete="off" maxLength={20} aria-describedby="ref-code-hint" value={form.code} onInput={(e) => setForm({ ...form, code: (e.currentTarget as HTMLInputElement).value.toUpperCase() })} />
        </div>
        <div class="field">
          <label for="ref-name">Name</label>
          <input id="ref-name" type="text" maxLength={120} value={form.name} onInput={(e) => setForm({ ...form, name: (e.currentTarget as HTMLInputElement).value })} />
        </div>
        <div class="field">
          <label for="ref-kind">Type</label>
          <select id="ref-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: (e.currentTarget as HTMLSelectElement).value as Ref['kind'] })}>
            {Object.entries(KINDS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div class="field">
          <label for="ref-company">Company <span class="hint">(optional)</span></label>
          <input id="ref-company" type="text" maxLength={120} value={form.company} onInput={(e) => setForm({ ...form, company: (e.currentTarget as HTMLInputElement).value })} />
        </div>
        <div class="field">
          <label for="ref-phone">Phone <span class="hint">(optional)</span></label>
          <input id="ref-phone" type="tel" maxLength={30} value={form.phone} onInput={(e) => setForm({ ...form, phone: (e.currentTarget as HTMLInputElement).value })} />
        </div>
        <div class="field">
          <label for="ref-email">Email <span class="hint">(optional)</span></label>
          <input id="ref-email" type="email" maxLength={254} value={form.email} onInput={(e) => setForm({ ...form, email: (e.currentTarget as HTMLInputElement).value })} />
        </div>
        <button type="submit" class="btn">Add code</button>
      </form>
    </section>
  );
}
