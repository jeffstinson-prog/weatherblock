// The team: each owner's load this week (tasks, late tasks, inspections,
// customers) and each crew with its lead, phone and jobs this week.
import Icon from '../icons/Icon';
import { formatMobile } from '../booking/rules';
import { Avatar, Failed, Loading, useData } from './ui';

interface Data {
  me: string;
  people: { id: string; name: string; email: string; mobile: string; active: boolean; openTasks: number; overdue: number; visitsThisWeek: number; customers: number }[];
  crews: { id: string; name: string; jobsPerDay: number; active: boolean; leadName: string; leadMobile: string; color: string; jobsThisWeek: number }[];
  unassigned: { tasks: number; visits: number };
}

export default function Team() {
  const { data, error, reload } = useData<Data>('team');
  if (error && !data) return <Failed message={error} onRetry={() => void reload()} />;
  if (!data) return <Loading title="Team" />;
  const people = data.people.filter((p) => p.active);

  return (
    <div class="owner-pad">
      <p class="back">
        <a href="#/more">
          <Icon name="chevron-left" size={18} />
          More
        </a>
      </p>
      <h1>Team</h1>
      <p class="muted">Who has what this week. Tap someone to see their tasks.</p>

      {(data.unassigned.tasks > 0 || data.unassigned.visits > 0) && (
        <div class="notice urgent">
          <p>
            <strong>Nobody on these yet:</strong>{' '}
            {data.unassigned.tasks > 0 && (
              <a href="#/tasks/nobody">
                {data.unassigned.tasks} task{data.unassigned.tasks === 1 ? '' : 's'}
              </a>
            )}
            {data.unassigned.tasks > 0 && data.unassigned.visits > 0 && ' and '}
            {data.unassigned.visits > 0 && (
              <a href="#/schedule">
                {data.unassigned.visits} inspection{data.unassigned.visits === 1 ? '' : 's'}
              </a>
            )}
            .
          </p>
        </div>
      )}

      <h2>People</h2>
      <ul class="reset-list team-grid">
        {people.map((p) => (
          <li key={p.id} class="card person-card">
            <a class="person-top" href={`#/tasks/${p.id}`}>
              <Avatar id={p.id} people={data.people} size="md" />
              <span>
                <span class="person-name">
                  {p.name}
                  {p.id === data.me ? ' (me)' : ''}
                </span>
                <span class="small muted">{p.email}</span>
              </span>
            </a>
            <dl class="mini-stats">
              <div>
                <dt>Open tasks</dt>
                <dd>{p.openTasks}</dd>
              </div>
              <div class={p.overdue > 0 ? 'late' : ''}>
                <dt>Late</dt>
                <dd>{p.overdue}</dd>
              </div>
              <div>
                <dt>Inspections this week</dt>
                <dd>{p.visitsThisWeek}</dd>
              </div>
              <div>
                <dt>Customers</dt>
                <dd>{p.customers}</dd>
              </div>
            </dl>
            {p.mobile && (
              <a class="small" href={`tel:${p.mobile}`}>
                <Icon name="phone" size={14} /> {formatMobile(p.mobile)}
              </a>
            )}
          </li>
        ))}
      </ul>

      <div class="section-head">
        <h2>Crews</h2>
        <a href="#/crews" class="small">
          Edit crews
        </a>
      </div>
      {data.crews.length === 0 ? (
        <p class="muted">
          No crews yet. <a href="#/crews">Add one</a>.
        </p>
      ) : (
        <ul class="reset-list team-grid">
          {data.crews.map((c) => (
            <li key={c.id} class={`card crew-card c-${c.color} ${c.active ? '' : 'is-off'}`}>
              <p class="crew-name">
                <span class={`crew-dot c-${c.color}`} aria-hidden="true" />
                {c.name}
                {!c.active && <span class="chip">Not working</span>}
              </p>
              <p class="small">
                {c.leadName ? `Lead: ${c.leadName}` : <span class="muted">No lead set</span>}
                {c.leadMobile && (
                  <>
                    {' · '}
                    <a href={`tel:${c.leadMobile}`}>{formatMobile(c.leadMobile)}</a>
                  </>
                )}
              </p>
              <p class="small muted">
                {c.jobsThisWeek} job{c.jobsThisWeek === 1 ? '' : 's'} this week · up to {c.jobsPerDay} a day
              </p>
            </li>
          ))}
        </ul>
      )}
      <p class="small muted">
        To add someone to the owner app, add them in Supabase (the go-live guide has the steps). Crews don't sign in; you schedule their days here.
      </p>
    </div>
  );
}
