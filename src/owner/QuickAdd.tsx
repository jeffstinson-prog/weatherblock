// The New button: add a lead from a phone call, a walk-in or a referral, or a
// task, from any screen. A new lead gets a "Call back" task and shows up in
// Customers right away.
import { useState } from 'preact/hooks';
import Icon from '../icons/Icon';
import { ApiError, api } from './api';
import TaskSheet from './TaskSheet';
import { Segmented, Sheet, customerHref, type Person } from './ui';

const SOURCES = [
  { value: 'phone_call', label: 'Phone call' },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'referral', label: 'Referral' },
  { value: 'door_knock', label: 'Door knock' },
  { value: 'other', label: 'Other' },
];

export default function QuickAdd(props: { people: Person[]; me: string; onFlash: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'lead' | 'task'>('lead');
  const [taskOpen, setTaskOpen] = useState(false);

  return (
    <>
      <button type="button" class="fab" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name="plus" size={22} />
        <span>New</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={kind === 'lead' ? 'New lead' : 'New task'}>
        <Segmented
          label="What to add"
          value={kind}
          onChange={(v) => {
            if (v === 'task') {
              setOpen(false);
              setTaskOpen(true);
              setKind('lead');
            } else setKind(v);
          }}
          options={[
            { value: 'lead', label: 'Lead' },
            { value: 'task', label: 'Task' },
          ]}
        />
        {open && kind === 'lead' && (
          <LeadForm
            onDone={(mobile, name) => {
              setOpen(false);
              props.onFlash(`${name} added, with a task to call them back.`);
              location.hash = customerHref(mobile).slice(1);
            }}
          />
        )}
      </Sheet>
      <TaskSheet open={taskOpen} onClose={() => setTaskOpen(false)} onSaved={props.onFlash} people={props.people} me={props.me} />
    </>
  );
}

function LeadForm(props: { onDone: (mobile: string, name: string) => void }) {
  const [f, setF] = useState({ name: '', mobile: '', email: '', address: '', source: 'phone_call', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.currentTarget as HTMLInputElement).value });

  async function save(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ mobile: string }>('lead', { body: { lead: f } });
      props.onDone(r.mobile, f.name.split(' ')[0] || 'Lead');
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="sheet-form" onSubmit={save}>
      <label for="lead-name">Name</label>
      <input id="lead-name" type="text" autocomplete="off" maxLength={120} required value={f.name} onInput={set('name')} />
      <label for="lead-mobile">Mobile</label>
      <input id="lead-mobile" type="tel" inputMode="tel" autocomplete="off" maxLength={30} required value={f.mobile} onInput={set('mobile')} />
      <label for="lead-address">Address</label>
      <input id="lead-address" type="text" autocomplete="off" maxLength={300} required placeholder="Street, town" value={f.address} onInput={set('address')} />
      <label for="lead-email">
        Email <span class="muted">(optional)</span>
      </label>
      <input id="lead-email" type="email" autocomplete="off" maxLength={254} value={f.email} onInput={set('email')} />
      <label for="lead-source">How they found us</label>
      <select id="lead-source" value={f.source} onChange={set('source')}>
        {SOURCES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <label for="lead-note">
        Note <span class="muted">(optional)</span>
      </label>
      <textarea id="lead-note" rows={3} maxLength={4000} placeholder="What they need, what you talked about." value={f.note} onInput={set('note')} />
      {error && (
        <p class="error-box" role="alert">
          {error}
        </p>
      )}
      <div class="sheet-actions">
        <button type="submit" class="btn" disabled={busy}>
          <Icon name="user-plus" size={18} />
          Add lead
        </button>
      </div>
      <p class="small muted">Adding a lead sends them nothing. Book their inspection from their page when you're ready.</p>
    </form>
  );
}
