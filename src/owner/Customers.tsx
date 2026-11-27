// Customers: everyone who asked or booked, one per phone number. Search, filter
// by stage or owner, or switch to the board to see the whole pipeline with the
// money in each column. Cards move on their own as the work gets done.
import { useState } from 'preact/hooks';
import Icon from '../icons/Icon';
import { money, shortDay } from '../booking/format';
import { STAGES, STAGE_SHORT, type Stage } from '../booking/stages';
import { formatMobile } from '../booking/rules';
import { Avatar, Failed, Loading, Segmented, ago, customerHref, useData, type Person } from './ui';

export interface CustomerRow {
  mobile: string;
  name: string;
  email: string;
  address: string;
  town: string;
  source: string;
  stage: Stage;
  stageLabel: string;
  lastAt: string | null;
  valueCents: number;
  assignedTo: string | null;
  assignedName: string;
  tags: string[];
  lostReason: string;
  openTasks: number;
  nextVisit: { id: string; startsAt: string; endsAt: string } | null;
  requestId: string | null;
  bookingId: string | null;
}

interface Data {
  customers: CustomerRow[];
  owners: Person[];
}

type Who = 'all' | 'mine' | 'nobody';
type View = 'list' | 'board';

const ACTIVE: Stage[] = ['new', 'contacted', 'booked', 'inspected', 'estimate_sent', 'won', 'scheduled'];

function matches(c: CustomerRow, q: string): boolean {
  if (!q) return true;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const digits = q.replace(/\D/g, '');
  const hay = `${c.name} ${c.address} ${c.email} ${c.tags.join(' ')} ${c.stageLabel}`.toLowerCase();
  if (digits.length >= 3 && c.mobile.includes(digits)) return true;
  return words.every((w) => hay.includes(w));
}

export default function Customers(props: { me: string }) {
  const { data, error, reload } = useData<Data>('customers');
  const [q, setQ] = useState('');
  const [stage, setStage] = useState<Stage | 'active' | 'all'>('active');
  const [who, setWho] = useState<Who>('all');
  const [view, setView] = useState<View>(() => (localStorage.getItem('owner-customers-view') === 'board' ? 'board' : 'list'));
  const [sort, setSort] = useState<'recent' | 'value' | 'name'>('recent');

  if (error && !data) return <Failed message={error} onRetry={() => void reload()} />;
  if (!data) return <Loading title="Customers" />;

  const people = data.owners;
  const base = data.customers.filter((c) => matches(c, q.trim())).filter((c) => (who === 'mine' ? c.assignedTo === props.me : who === 'nobody' ? !c.assignedTo : true));
  const count = (s: Stage) => base.filter((c) => c.stage === s).length;
  const shown = base
    .filter((c) => (stage === 'all' ? true : stage === 'active' ? ACTIVE.includes(c.stage) : c.stage === stage))
    .sort((a, b) => (sort === 'value' ? b.valueCents - a.valueCents : sort === 'name' ? a.name.localeCompare(b.name) : (b.lastAt ?? '').localeCompare(a.lastAt ?? '')));
  const switchView = (v: View) => {
    setView(v);
    localStorage.setItem('owner-customers-view', v);
  };

  return (
    <div class={`owner-pad ${view === 'board' ? 'owner-wide' : ''}`}>
      <div class="screen-head">
        <h1>Customers</h1>
        <Segmented
          label="Show as"
          value={view}
          onChange={switchView}
          options={[
            { value: 'list', label: 'List' },
            { value: 'board', label: 'Board' },
          ]}
        />
      </div>
      <p class="muted small">
        {data.customers.length} customer{data.customers.length === 1 ? '' : 's'}. One per phone number, from the first request to the finished roof.
      </p>

      <div class="search-row">
        <label for="cust-q" class="visually-hidden">
          Search customers
        </label>
        <Icon name="search" size={18} class="search-icon" />
        <input id="cust-q" type="search" placeholder="Name, phone, street or tag" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
      </div>

      <div class="filter-bar">
        <Segmented
          label="Whose"
          value={who}
          onChange={setWho}
          options={[
            { value: 'all', label: 'Everyone' },
            { value: 'mine', label: 'Mine' },
            { value: 'nobody', label: 'No owner' },
          ]}
        />
        {view === 'list' && (
          <>
            <label for="cust-sort" class="visually-hidden">
              Sort
            </label>
            <select id="cust-sort" class="compact" value={sort} onChange={(e) => setSort((e.currentTarget as HTMLSelectElement).value as typeof sort)}>
              <option value="recent">Latest activity</option>
              <option value="value">Biggest estimate</option>
              <option value="name">Name</option>
            </select>
          </>
        )}
      </div>

      {view === 'list' && (
        <div class="chip-scroll" role="group" aria-label="Stage">
          {(
            [
              { v: 'active', label: 'Active', n: base.filter((c) => ACTIVE.includes(c.stage)).length },
              ...STAGES.map((s) => ({ v: s, label: STAGE_SHORT[s], n: count(s) })),
              { v: 'all', label: 'All', n: base.length },
            ] as { v: Stage | 'active' | 'all'; label: string; n: number }[]
          ).map((o) => (
            <button key={o.v} type="button" class="filter-chip" aria-pressed={stage === o.v} onClick={() => setStage(o.v)}>
              {o.label} <span class="seg-n">{o.n}</span>
            </button>
          ))}
        </div>
      )}

      {view === 'list' ? (
        shown.length === 0 ? (
          <p class="empty">{q ? 'Nobody matches that search.' : 'Nobody here yet.'}</p>
        ) : (
          <ul class="reset-list cust-list">
            {shown.map((c) => (
              <li key={c.mobile}>
                <a class="cust-row" href={customerHref(c.mobile)}>
                  <span class="cust-main">
                    <span class="cust-name">{c.name || formatMobile(c.mobile)}</span>
                    <span class="cust-meta">
                      {c.town || c.address}
                      {c.lastAt ? ` · ${ago(c.lastAt)}` : ''}
                    </span>
                    {c.nextVisit && (
                      <span class="cust-meta strong">
                        <Icon name="calendar-check" size={14} /> {shortDay(c.nextVisit.startsAt)}
                      </span>
                    )}
                    {c.tags.length > 0 && (
                      <span class="tag-line">
                        {c.tags.slice(0, 3).map((t) => (
                          <span key={t} class="tag">
                            {t}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span class="cust-side">
                    <span class={`stage stage-${c.stage}`}>{STAGE_SHORT[c.stage]}</span>
                    {c.valueCents > 0 && <span class="cust-value">{money(c.valueCents)}</span>}
                    <span class="cust-icons">
                      {c.openTasks > 0 && (
                        <span class="task-count" title={`${c.openTasks} open task${c.openTasks === 1 ? '' : 's'}`}>
                          <Icon name="list-todo" size={14} />
                          <span class="visually-hidden">Open tasks:</span> {c.openTasks}
                        </span>
                      )}
                      <Avatar id={c.assignedTo} people={people} />
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )
      ) : (
        <Board rows={base} people={people} />
      )}
    </div>
  );
}

/** The pipeline: a column per stage with what's in it and what it's worth. */
function Board(props: { rows: CustomerRow[]; people: Person[] }) {
  const [showDone, setShowDone] = useState(false);
  const columns = STAGES.filter((s) => showDone || (s !== 'done' && s !== 'lost'));
  return (
    <>
      <p class="small muted board-note">
        Cards move on their own as you call, book, inspect, send and win. Scroll sideways for more columns.{' '}
        <button type="button" class="link-btn" aria-pressed={showDone} onClick={() => setShowDone(!showDone)}>
          {showDone ? 'Hide done and lost' : 'Show done and lost'}
        </button>
      </p>
      <ul class="reset-list board" aria-label="Pipeline">
        {columns.map((s) => {
          const cards = props.rows.filter((c) => c.stage === s);
          const total = cards.reduce((n, c) => n + c.valueCents, 0);
          return (
            <li key={s} class={`board-col col-${s}`} aria-labelledby={`col-${s}`}>
              <header class="board-head">
                <h2 id={`col-${s}`}>
                  {STAGE_SHORT[s]} <span class="seg-n">{cards.length}</span>
                </h2>
                {total > 0 && <span class="board-total">{money(total)}</span>}
              </header>
              {cards.length === 0 ? (
                <p class="small muted board-empty">Nobody here.</p>
              ) : (
                <ul class="reset-list board-cards">
                  {cards.map((c) => (
                    <li key={c.mobile}>
                      <a class="board-card" href={customerHref(c.mobile)}>
                        <span class="bc-top">
                          <span class="bc-name">{c.name || formatMobile(c.mobile)}</span>
                          <Avatar id={c.assignedTo} people={props.people} />
                        </span>
                        <span class="bc-meta">{c.town || c.address}</span>
                        <span class="bc-bottom">
                          {c.valueCents > 0 ? <span class="cust-value">{money(c.valueCents)}</span> : <span />}
                          <span class="bc-ago">{ago(c.lastAt)}</span>
                        </span>
                        {c.nextVisit && (
                          <span class="bc-meta strong">
                            <Icon name="calendar-check" size={14} /> {shortDay(c.nextVisit.startsAt)}
                          </span>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
