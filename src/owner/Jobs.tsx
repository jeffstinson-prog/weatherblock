// Roof jobs, day by day, by crew. Weather moves a whole day in two taps, and
// every customer on it hears about the new day.
import { useEffect, useState } from 'preact/hooks';
import { ApiError, api } from './api';
import { dateLong } from '../booking/format';
import type { CrewInfo } from './EstimatePanel';

interface Calendar {
  crews: CrewInfo[];
  days: { day: string; jobs: { bookingId: string; crewId: string; name: string; address: string; mobile: string }[] }[];
  toSchedule: { id: string; name: string; address: string }[];
}

const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function Jobs() {
  const [data, setData] = useState<Calendar | null>(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [moving, setMoving] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [weather, setWeather] = useState(true);
  const [busy, setBusy] = useState(false);
  const [crewFull, setCrewFull] = useState('');

  async function load() {
    try {
      setData(await api<Calendar>(`jobs?from=${todayLocal()}`));
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function move(from: string, force = false) {
    setBusy(true);
    setError('');
    setCrewFull('');
    try {
      const r = await api<{ moved: number }>('jobs/move-day', { body: { from, to, weather, force } });
      setFlash(`Moved ${r.moved === 1 ? 'one job' : `${r.moved} jobs`} to ${dateLong(to)}. ${r.moved === 1 ? 'The customer was' : 'Each customer was'} told.`);
      setMoving(null);
      await load();
    } catch (e) {
      const ae = e as ApiError;
      if (ae.code === 'crew_full') setCrewFull(ae.message);
      else setError(ae.message);
    } finally {
      setBusy(false);
    }
  }

  const crewName = (id: string) => data?.crews.find((c) => c.id === id)?.name ?? 'Crew';

  return (
    <section class="owner-pad">
      <h1>Jobs</h1>
      <p class="muted">Roof jobs for the next four weeks.</p>
      {flash && <p class="notice ok" role="status">{flash}</p>}
      {error && <p class="error-box" role="alert">{error}</p>}
      {data === null && !error && <p aria-live="polite">Loading...</p>}

      {data && data.toSchedule.length > 0 && (
        <section aria-labelledby="needs-day-h" class="panel">
          <h2 id="needs-day-h">Said yes, needs a day ({data.toSchedule.length})</h2>
          <ul class="up-list">
            {data.toSchedule.map((j) => (
              <li key={j.id}>
                <a href={`#/booking/${j.id}`}>
                  {j.name}, {j.address}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && data.days.length === 0 && <p>No roof jobs on the calendar yet.</p>}
      {data?.days.map((d) => (
        <section key={d.day} class="up-day" aria-labelledby={`job-${d.day}`}>
          <h2 id={`job-${d.day}`}>{dateLong(d.day)}</h2>
          <ul class="up-list">
            {d.jobs.map((j) => (
              <li key={j.bookingId}>
                <a href={`#/booking/${j.bookingId}`}>
                  <span class="when">{crewName(j.crewId)}</span> {j.name}, {j.address}
                </a>
              </li>
            ))}
          </ul>
          {moving === d.day ? (
            <div class="panel move-day">
              <label for={`to-${d.day}`}>Move every job on this day to</label>
              <input id={`to-${d.day}`} type="date" min={todayLocal()} value={to} onInput={(e) => setTo((e.currentTarget as HTMLInputElement).value)} />
              <label class="check">
                <input type="checkbox" checked={weather} onChange={(e) => setWeather((e.currentTarget as HTMLInputElement).checked)} />
                <span>Because of the weather (the message says so)</span>
              </label>
              {crewFull && (
                <div class="error-box" role="alert">
                  <p>{crewFull}</p>
                  <button type="button" class="btn secondary" disabled={busy} onClick={() => void move(d.day, true)}>
                    Move them anyway
                  </button>
                </div>
              )}
              <div class="minutes">
                <button type="button" class="btn secondary" onClick={() => { setMoving(null); setCrewFull(''); }}>
                  Never mind
                </button>
                <button type="button" class="btn" disabled={busy || !to} onClick={() => void move(d.day)}>
                  Move and tell {d.jobs.length === 1 ? 'the customer' : `all ${d.jobs.length}`}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" class="btn secondary" onClick={() => { setMoving(d.day); setTo(nextDay(d.day)); setCrewFull(''); }}>
              Move this day
            </button>
          )}
        </section>
      ))}

      <p class="crews-link">
        <a class="btn secondary block" href="#/crews">Crews</a>
      </p>
    </section>
  );
}
