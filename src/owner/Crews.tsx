// The crews that do roof jobs: names, how many jobs a day, and who's working.
import { useEffect, useState } from 'preact/hooks';
import { ApiError, api } from './api';
import type { CrewInfo } from './EstimatePanel';

type Draft = Omit<CrewInfo, 'id'> & { id?: string; key: string };

export default function Crews() {
  const [crews, setCrews] = useState<Draft[] | null>(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const d = await api<{ crews: CrewInfo[] }>('crews');
      setCrews(d.crews.map((c) => ({ ...c, key: c.id })));
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
      <p>
        <a href="#/jobs">Back to Jobs</a>
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
              <button type="button" class="btn secondary" onClick={() => setCrews([...crews, { key: crypto.randomUUID(), name: `Crew ${crews.length + 1}`, jobsPerDay: 1, active: true }])}>
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
