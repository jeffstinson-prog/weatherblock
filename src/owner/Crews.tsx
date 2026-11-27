// The crews that do roof jobs: names, who leads each one and their phone, a
// color for the schedule, how many jobs a day, and who's working.
import { useEffect, useState } from 'preact/hooks';
import { ApiError, api } from './api';
import type { CrewInfo } from './EstimatePanel';
import { formatMobile } from '../booking/rules';

const COLORS = [
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'orange', label: 'Orange' },
  { value: 'purple', label: 'Purple' },
  { value: 'red', label: 'Red' },
  { value: 'teal', label: 'Teal' },
];

type Draft = Omit<CrewInfo, 'id'> & { id?: string; key: string };

export default function Crews() {
  const [crews, setCrews] = useState<Draft[] | null>(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const d = await api<{ crews: CrewInfo[] }>('crews');
      setCrews(d.crews.map((c) => ({ ...c, leadMobile: c.leadMobile ? formatMobile(c.leadMobile) : '', key: c.id })));
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const set = (i: number, patch: Partial<Draft>) => setCrews((list) => list!.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  async function save(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFlash('');
    try {
      await api('crews', { body: { crews: crews!.map(({ key: _k, ...c }) => c) } });
      setFlash('Crews saved.');
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="owner-pad">
      <p class="back">
        <a href="#/team">Team</a>
      </p>
      <h1>Crews</h1>
      <p class="muted">Jobs a day is how many roof jobs a crew usually finishes in one day. Scheduling past it asks you first.</p>
      {flash && <p class="notice ok" role="status">{flash}</p>}
      {error && <p class="error-box" role="alert">{error}</p>}
      {crews === null && !error && <p aria-live="polite">Loading...</p>}
      {crews && (
        <form onSubmit={save}>
          {crews.map((c, i) => (
            <fieldset key={c.key} class="panel crew-row">
              <legend>{c.name || 'New crew'}</legend>
              <label for={`crew-name-${i}`}>Name</label>
              <input id={`crew-name-${i}`} type="text" maxLength={60} value={c.name} onInput={(e) => set(i, { name: (e.currentTarget as HTMLInputElement).value })} />
              <label for={`crew-lead-${i}`}>
                Crew lead <span class="muted">(optional)</span>
              </label>
              <input id={`crew-lead-${i}`} type="text" maxLength={80} autocomplete="off" value={c.leadName ?? ''} onInput={(e) => set(i, { leadName: (e.currentTarget as HTMLInputElement).value })} />
              <label for={`crew-phone-${i}`}>
                Lead's phone <span class="muted">(optional)</span>
              </label>
              <input id={`crew-phone-${i}`} type="tel" inputMode="tel" maxLength={20} autocomplete="off" value={c.leadMobile ?? ''} onInput={(e) => set(i, { leadMobile: (e.currentTarget as HTMLInputElement).value })} />
              <fieldset class="color-pick">
                <legend>Color on the schedule</legend>
                {COLORS.map((col) => (
                  <label key={col.value} class="color-choice">
                    <input type="radio" name={`crew-color-${c.key}`} checked={(c.color ?? 'blue') === col.value} onChange={() => set(i, { color: col.value })} />
                    <span class={`crew-dot c-${col.value}`} aria-hidden="true" />
                    <span>{col.label}</span>
                  </label>
                ))}
              </fieldset>
              <label for={`crew-jobs-${i}`}>Jobs a day</label>
              <select id={`crew-jobs-${i}`} value={String(c.jobsPerDay)} onChange={(e) => set(i, { jobsPerDay: Number((e.currentTarget as HTMLSelectElement).value) })}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={String(n)}>
                    {n}
                  </option>
                ))}
              </select>
              <label class="check">
                <input type="checkbox" checked={c.active} onChange={(e) => set(i, { active: (e.currentTarget as HTMLInputElement).checked })} />
                <span>Working (shows when you schedule)</span>
              </label>
            </fieldset>
          ))}
          <div class="minutes">
            {crews.length < 10 && (
              <button type="button" class="btn secondary" onClick={() => setCrews([...crews, { key: crypto.randomUUID(), name: `Crew ${crews.length + 1}`, jobsPerDay: 1, active: true, leadName: '', leadMobile: '', color: COLORS[crews.length % COLORS.length]!.value }])}>
                Add a crew
              </button>
            )}
            <button type="submit" class="btn" disabled={busy}>
              Save crews
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
