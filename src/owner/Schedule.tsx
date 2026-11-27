// The schedule, a week at a time: inspections with who's doing each one, roof
// jobs in their crew's color, days off, and the jobs still waiting for a day.
import { useEffect, useState } from 'preact/hooks';
import Icon from '../icons/Icon';
import { ApiError, api } from './api';
import { shortDay, townOf, windowLabel } from '../booking/format';
import { Avatar, Failed, Loading, PersonSelect, Segmented, Sheet, addDays, customerHref, todayKey, useAction, useData, type Person } from './ui';

export interface Crew {
  id: string;
  name: string;
  jobsPerDay: number;
  active: boolean;
  leadName: string;
  leadMobile: string;
  color: string;
}

interface Data {
  from: string;
  days: number;
  visits: { id: string; ref: string; status: string; startsAt: string; endsAt: string; name: string; mobile: string; address: string; reason: string; assignedTo: string | null }[];
  jobs: { bookingId: string; crewId: string; day: string; status: string; name: string; mobile: string; address: string }[];
  toSchedule: { id: string; name: string; mobile: string; address: string }[];
  crews: Crew[];
  owners: Person[];
  daysOff: { day: string; note: string }[];
}

type Who = 'all' | 'mine' | 'nobody';

const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const dateHead = (key: string) => shortDay(`${key}T12:00:00Z`);

export default function Schedule(props: { from: string; me: string }) {
  const today = todayKey();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(props.from) ? props.from : today;
  const { data, error, reload } = useData<Data>(`schedule?from=${from}&days=7`);
  const act = useAction(reload);
  const [who, setWho] = useState<Who>('all');
  const [job, setJob] = useState<{ bookingId: string; name: string; crewId?: string; day?: string } | null>(null);

  if (error && !data) return <Failed message={error} onRetry={() => void reload()} />;
  if (!data) return <Loading title="Schedule" />;

  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const crewOf = (id: string) => data.crews.find((c) => c.id === id);
  const visits = data.visits.filter((v) => (who === 'mine' ? v.assignedTo === props.me : who === 'nobody' ? !v.assignedTo : true));
  const unassigned = data.visits.filter((v) => !v.assignedTo && v.status === 'booked' && Date.parse(v.endsAt) > Date.now()).length;
  const nav = (key: string) => (location.hash = `/schedule/${key}`);

  return (
    <div class="owner-pad schedule">
      <div class="screen-head">
        <h1>Schedule</h1>
        <div class="week-nav">
          <button type="button" class="icon-btn" aria-label="Previous week" onClick={() => nav(addDays(from, -7))}>
            <Icon name="chevron-left" size={22} />
          </button>
          <button type="button" class="btn secondary small-btn" disabled={from === today} onClick={() => nav(today)}>
            Today
          </button>
          <button type="button" class="icon-btn" aria-label="Next week" onClick={() => nav(addDays(from, 7))}>
            <Icon name="chevron-right" size={22} />
          </button>
        </div>
      </div>
      <p class="muted small">
        {dateHead(days[0]!)} to {dateHead(days[6]!)}
        {unassigned > 0 && (
          <>
            {' · '}
            <strong class="warn-text">
              {unassigned} inspection{unassigned === 1 ? '' : 's'} with no one on {unassigned === 1 ? 'it' : 'them'}
            </strong>
          </>
        )}
      </p>

      <Segmented
        label="Inspections"
        value={who}
        onChange={setWho}
        options={[
          { value: 'all', label: 'Everyone' },
          { value: 'mine', label: 'Mine' },
          { value: 'nobody', label: 'No one yet' },
        ]}
      />

      <p class="flash" role="status">
        {act.flash}
      </p>
      {act.failed && (
        <p class="error-box" role="alert">
          {act.failed}
        </p>
      )}

      {data.toSchedule.length > 0 && (
        <section class="panel to-schedule" aria-labelledby="tosched-h">
          <h2 id="tosched-h">
            Jobs waiting for a day <span class="seg-n">{data.toSchedule.length}</span>
          </h2>
          <ul class="reset-list">
            {data.toSchedule.map((j) => (
              <li key={j.id} class="tosched-row">
                <span>
                  <a href={`#/booking/${j.id}`} class="strong-link">
                    {j.name}
                  </a>
                  <span class="muted small"> · {townOf(j.address)}</span>
                </span>
                <button type="button" class="btn small-btn" onClick={() => setJob({ bookingId: j.id, name: j.name })}>
                  <Icon name="calendar-plus" size={18} />
                  Schedule
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.crews.filter((c) => c.active).length > 0 && (
        <ul class="reset-list crew-legend" aria-label="Crews">
          {data.crews
            .filter((c) => c.active)
            .map((c) => (
              <li key={c.id}>
                <span class={`crew-dot c-${c.color}`} aria-hidden="true" />
                {c.name}
              </li>
            ))}
        </ul>
      )}

      <ol class="reset-list week">
        {days.map((d) => {
          const dayVisits = visits.filter((v) => dayOf(v.startsAt) === d);
          const dayJobs = data.jobs.filter((j) => j.day === d);
          const off = data.daysOff.find((o) => o.day === d);
          return (
            <li key={d} class={`week-day ${d === today ? 'is-today' : ''} ${off ? 'is-off' : ''}`}>
              <h2 class="wd-head">
                {dateHead(d)}
                {d === today && <span class="chip">Today</span>}
              </h2>
              {off && (
                <p class="small muted">
                  <Icon name="calendar-x" size={14} /> Day off{off.note ? `: ${off.note}` : ''}
                </p>
              )}
              {dayVisits.length === 0 && dayJobs.length === 0 && !off && <p class="small muted">Nothing booked.</p>}
              <ul class="reset-list wd-items">
                {dayJobs.map((j) => {
                  const crew = crewOf(j.crewId);
                  return (
                    <li key={`job-${j.bookingId}`} class={`sched-item job c-${crew?.color ?? 'blue'}`}>
                      <span class="si-kind">
                        <Icon name="hammer" size={16} />
                        {crew?.name ?? 'Crew'}
                        {j.status === 'done' && <span class="chip done">Done</span>}
                      </span>
                      <a class="si-name" href={`#/booking/${j.bookingId}`}>
                        Roof job: {j.name}
                      </a>
                      <span class="si-where">{townOf(j.address)}</span>
                      {j.status === 'scheduled' && (
                        <button type="button" class="link-btn" onClick={() => setJob({ bookingId: j.bookingId, name: j.name, crewId: j.crewId, day: j.day })}>
                          Move or change crew
                        </button>
                      )}
                    </li>
                  );
                })}
                {dayVisits.map((v) => (
                  <li key={v.id} class={`sched-item visit ${v.assignedTo ? '' : 'unassigned'} ${v.status !== 'booked' ? 'is-past' : ''}`}>
                    <span class="si-kind">
                      <Icon name="clock" size={16} />
                      {windowLabel(v.startsAt, v.endsAt)}
                      {v.status === 'done' && <span class="chip done">Inspected</span>}
                      {v.status === 'no_show' && <span class="chip no_show">No one home</span>}
                    </span>
                    <a class="si-name" href={`#/booking/${v.id}`}>
                      {v.name}
                    </a>
                    <span class="si-where">
                      {townOf(v.address)} · {v.reason}
                    </span>
                    <span class="si-assign">
                      <Avatar id={v.assignedTo} people={data.owners} />
                      <span class="grow">
                        <PersonSelect
                          id={`insp-${v.id}`}
                          label={`Inspector for ${v.name}`}
                          hideLabel
                          value={v.assignedTo}
                          people={data.owners}
                          me={props.me}
                          nobody="No one yet"
                          short
                          disabled={act.busy !== ''}
                          onChange={(id) =>
                            void act.run(`a-${v.id}`, () => api(`booking/${v.id}`, { body: { action: 'assign', userId: id } }), id ? `${data.owners.find((o) => o.id === id)?.name.split(' ')[0] ?? 'They'} is on ${v.name.split(' ')[0]}'s inspection.` : 'Inspector taken off.')
                          }
                        />
                      </span>
                      <a class="icon-btn" href={customerHref(v.mobile)} aria-label={`${v.name}'s customer page`}>
                        <Icon name="contact" size={20} />
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>

      <JobSheet
        job={job}
        crews={data.crews.filter((c) => c.active)}
        onClose={() => setJob(null)}
        onDone={(m) => {
          setJob(null);
          act.setFlash(m);
          void reload();
        }}
      />
    </div>
  );
}

/** Put a roof job on a crew's day, or move it. */
export function JobSheet(props: { job: { bookingId: string; name: string; crewId?: string; day?: string } | null; crews: Crew[]; onClose: () => void; onDone: (m: string) => void }) {
  const j = props.job;
  const [crewId, setCrewId] = useState('');
  const [day, setDay] = useState('');
  const [full, setFull] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!j) return;
    setCrewId(j.crewId ?? props.crews[0]?.id ?? '');
    setDay(j.day ?? addDays(todayKey(), 1));
    setFull('');
    setError('');
  }, [j?.bookingId, j?.day]);

  async function save(force: boolean) {
    if (!j) return;
    setBusy(true);
    setError('');
    try {
      await api(`booking/${j.bookingId}`, { body: { action: 'job_schedule', job: { crewId, day, force } } });
      const crew = props.crews.find((c) => c.id === crewId);
      props.onDone(`${j.name.split(' ')[0]}'s roof job is set for ${dateHead(day)} with ${crew?.name ?? 'the crew'}. They'll get a text and an email.`);
    } catch (err) {
      const e = err as ApiError;
      if (e.code === 'crew_full') setFull(e.message);
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={j !== null}
      onClose={props.onClose}
      title={j?.day ? `Move ${j.name.split(' ')[0]}'s job` : `Schedule ${j?.name.split(' ')[0] ?? ''}'s job`}
    >
      <form
        class="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        {props.crews.length === 0 ? (
          <p>
            Add a crew first. <a href="#/crews">Crews</a>
          </p>
        ) : (
          <fieldset>
            <legend>Crew</legend>
            {props.crews.map((c) => (
              <label key={c.id} class="check crew-choice">
                <input type="radio" name="job-crew" checked={crewId === c.id} onChange={() => setCrewId(c.id)} />
                <span class={`crew-dot c-${c.color}`} aria-hidden="true" />
                <span>
                  {c.name}
                  {c.leadName && <span class="muted small"> · {c.leadName}</span>}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <label for="job-day">Day</label>
        <input id="job-day" type="date" min={todayKey()} required value={day} onInput={(e) => setDay((e.currentTarget as HTMLInputElement).value)} />
        {full && (
          <div class="notice urgent" role="alert">
            <p>{full}</p>
            <button type="button" class="btn secondary" disabled={busy} onClick={() => void save(true)}>
              Schedule it anyway
            </button>
          </div>
        )}
        {error && (
          <p class="error-box" role="alert">
            {error}
          </p>
        )}
        <div class="sheet-actions">
          <button type="submit" class="btn" disabled={busy || !crewId || !day}>
            {j?.day ? 'Move the job' : 'Schedule'}
          </button>
        </div>
        <p class="small muted">The customer gets a text and an email with the day. Moving it tells them the new day.</p>
      </form>
    </Sheet>
  );
}
