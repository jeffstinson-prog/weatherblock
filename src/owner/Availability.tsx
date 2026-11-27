// When customers can book: windows by weekday, inspectors, days off, the calendar.
import { useEffect, useState } from 'preact/hooks';
import { ApiError, api } from './api';

interface Win {
  start: string;
  end: string;
}

interface Data {
  inspectors: number;
  horizonDays: number;
  minNoticeHours: number;
  calendarId: string;
  calendar: { status: string; error: string; syncedAt: string | null; serviceAccount: string; available: boolean; serverId?: string };
  week: Win[][];
  daysOff: { day: string; note: string }[];
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function Availability() {
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);
  const [offDay, setOffDay] = useState('');
  const [offNote, setOffNote] = useState('');

  const load = () =>
    api<Data>('availability')
      .then(setD)
      .catch((e: ApiError) => setError(e.message));

  useEffect(() => {
    void load();
  }, []);

  if (!d) return <p class="owner-pad" aria-live="polite">{error || 'Loading...'}</p>;

  const set = (patch: Partial<Data>) => setD({ ...d, ...patch });
  const setWeek = (i: number, wins: Win[]) => set({ week: d.week.map((w, j) => (j === i ? wins : w)) });

  async function save(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFlash('');
    try {
      await api('availability', {
        body: { inspectors: d!.inspectors, horizonDays: d!.horizonDays, minNoticeHours: d!.minNoticeHours, calendarId: d!.calendarId, week: d!.week },
      });
      setFlash('Saved. Customers see the new times right away.');
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function dayOff(action: 'add' | 'remove', day: string) {
    setError('');
    try {
      await api('days-off', { body: { action, day, note: offNote } });
      setOffDay('');
      setOffNote('');
      setFlash(action === 'add' ? 'Day off added.' : 'Day off removed.');
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  async function syncNow() {
    setError('');
    try {
      const r = await api<{ status: string; error?: string; pushed: number; busy: number }>('calendar/sync', { body: {} });
      setFlash(r.status === 'ok' ? `Calendar synced: ${r.pushed} added or updated, ${r.busy} busy times read.` : r.error || 'Calendar not connected yet.');
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));

  return (
    <section class="owner-pad">
      <h1>Availability</h1>
      {flash && <p class="notice ok" role="status">{flash}</p>}
      {error && <p class="error-box" role="alert">{error}</p>}
      <form onSubmit={save} noValidate>
        <div class="field">
          <label for="inspectors">Inspectors</label>
          <p class="hint" id="inspectors-hint">How many bookings each window can take.</p>
          <input id="inspectors" type="number" min={0} max={20} inputMode="numeric" aria-describedby="inspectors-hint" value={d.inspectors} onInput={(e) => set({ inspectors: num((e.currentTarget as HTMLInputElement).value) })} />
        </div>
        <div class="field">
          <label for="notice">Minimum notice, in hours</label>
          <input id="notice" type="number" min={0} max={168} inputMode="numeric" value={d.minNoticeHours} onInput={(e) => set({ minNoticeHours: num((e.currentTarget as HTMLInputElement).value) })} />
        </div>
        <div class="field">
          <label for="horizon">How far ahead people can book, in days</label>
          <input id="horizon" type="number" min={1} max={90} inputMode="numeric" value={d.horizonDays} onInput={(e) => set({ horizonDays: Math.max(1, num((e.currentTarget as HTMLInputElement).value)) })} />
        </div>

        <h2>Windows</h2>
        {DAYS.map((name, i) => (
          <fieldset key={name} class="weekday">
            <legend>{name}</legend>
            {d.week[i]!.length === 0 && <p class="muted small">Closed</p>}
            {d.week[i]!.map((w, j) => (
              <div class="win" key={j}>
                <label>
                  <span class="visually-hidden">{name} window {j + 1} starts</span>
                  <input type="time" value={w.start} onInput={(e) => setWeek(i, d.week[i]!.map((x, k) => (k === j ? { ...x, start: (e.currentTarget as HTMLInputElement).value } : x)))} />
                </label>
                <span aria-hidden="true">to</span>
                <label>
                  <span class="visually-hidden">{name} window {j + 1} ends</span>
                  <input type="time" value={w.end} onInput={(e) => setWeek(i, d.week[i]!.map((x, k) => (k === j ? { ...x, end: (e.currentTarget as HTMLInputElement).value } : x)))} />
                </label>
                <button type="button" class="link-btn" onClick={() => setWeek(i, d.week[i]!.filter((_, k) => k !== j))}>
                  Remove<span class="visually-hidden"> {name} window {j + 1}</span>
                </button>
              </div>
            ))}
            <button type="button" class="link-btn" onClick={() => {
              const last = d.week[i]!.at(-1);
              const start = last ? last.end : '08:00';
              const [h, m] = start.split(':').map(Number);
              const end = `${String(Math.min(23, h! + 2)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
              setWeek(i, [...d.week[i]!, { start, end }]);
            }}>
              Add a window<span class="visually-hidden"> on {name}</span>
            </button>
          </fieldset>
        ))}

        <h2>Google Calendar</h2>
        <p>
          Status: <strong>{d.calendar.status === 'ok' ? 'Connected' : d.calendar.status === 'error' ? 'Problem' : 'Not connected'}</strong>
          {d.calendar.syncedAt && <span class="muted small"> (checked {new Date(d.calendar.syncedAt).toLocaleString('en-US', { timeZone: 'America/New_York' })})</span>}
        </p>
        {d.calendar.error && <p class="error">{d.calendar.error}</p>}
        {d.calendar.serviceAccount ? (
          <p class="small">
            In Google Calendar, share your calendar with <strong>{d.calendar.serviceAccount}</strong> and choose "Make changes to events". Then enter the
            calendar's ID below (for your main calendar, it's your Gmail address).
          </p>
        ) : (
          <p class="small muted">The Google connection isn't set up on the server yet.</p>
        )}
        <div class="field">
          <label for="calendarId">Calendar ID</label>
          <input
            id="calendarId"
            type="text"
            autoComplete="off"
            placeholder={d.calendar.serverId || undefined}
            aria-describedby={d.calendar.serverId ? 'calendarId-hint' : undefined}
            value={d.calendarId}
            onInput={(e) => set({ calendarId: (e.currentTarget as HTMLInputElement).value })}
          />
          {d.calendar.serverId && (
            <p class="hint" id="calendarId-hint">
              Leave it empty to use the one set in Netlify: {d.calendar.serverId}
            </p>
          )}
        </div>
        <p class="small muted">Bookings show up on the calendar. Anything else marked busy there blocks those windows. Move or cancel bookings here in the app, since the app is what tells the customer.</p>

        <div class="step-actions">
          <button type="submit" class="btn" disabled={busy}>
            {busy ? 'Saving...' : 'Save availability'}
          </button>
        </div>
      </form>
      {d.calendar.available && (
        <button type="button" class="btn secondary" onClick={() => void syncNow()}>
          Sync the calendar now
        </button>
      )}

      <h2>Days off</h2>
      <form
        class="dayoff"
        onSubmit={(e) => {
          e.preventDefault();
          if (offDay) void dayOff('add', offDay);
          else setError('Pick a date for the day off.');
        }}
        noValidate
      >
        <div class="field">
          <label for="offday">Date</label>
          <input id="offday" type="date" value={offDay} onInput={(e) => setOffDay((e.currentTarget as HTMLInputElement).value)} />
        </div>
        <div class="field">
          <label for="offnote">Note <span class="hint">(optional)</span></label>
          <input id="offnote" type="text" maxLength={200} value={offNote} onInput={(e) => setOffNote((e.currentTarget as HTMLInputElement).value)} />
        </div>
        <button type="submit" class="btn secondary">Add day off</button>
      </form>
      <ul class="plain-list">
        {d.daysOff.map((o) => (
          <li key={o.day}>
            {new Date(`${o.day}T17:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' })}
            {o.note && `: ${o.note}`}{' '}
            <button type="button" class="link-btn" onClick={() => void dayOff('remove', o.day)}>
              Remove<span class="visually-hidden"> day off {o.day}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
