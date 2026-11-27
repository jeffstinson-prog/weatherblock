// The owner app's home: who to call right now, the next stop with everything
// one tap away, the rest of today and the week ahead, and the money in play.
// It refreshes itself when the phone comes back to it, and every minute.
import { useEffect, useState } from 'preact/hooks';
import Icon from '../icons/Icon';
import { ApiError, api } from './api';
import { dayKey, longDay, money, shortDay, townOf, windowLabel } from '../booking/format';
import { formatMobile } from '../booking/rules';
import { STALE_MS, whenShownAgain } from '../booking/fresh';
import { STATUS_LABEL, directions, type Row } from './Today';
import { ago, promiseLabel } from './promise';
import PushCard from './PushCard';
import { customerHref, dueLabel } from './ui';

interface CallRow {
  id: string;
  ref: string;
  name: string;
  mobile: string;
  address: string;
  createdAt: string;
  roof: string;
  leadSource: string;
}

interface HomeTask {
  id: string;
  title: string;
  dueOn: string;
  mobile: string | null;
  mine: boolean;
  auto: boolean;
  customerName: string;
}

interface HomeData {
  today: string;
  name: string;
  me: string;
  tasks: HomeTask[];
  taskCounts: { mine: number; late: number; unassigned: number };
  toCall: CallRow[];
  calledCount: number;
  visits: Row[];
  estimates: { out: { count: number; cents: number }; wonThisMonth: { count: number; cents: number }; toWrite: number };
}

const MINUTES = [10, 15, 20, 30];

function greeting(now: Date): string {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(now));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function Home() {
  const [d, setD] = useState<HomeData | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useState('');
  const [omw, setOmw] = useState(false);

  async function load() {
    try {
      setD(await api<HomeData>('home'));
      setError('');
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  useEffect(() => {
    void load();
    let loadedAt = Date.now();
    return whenShownAgain(() => {
      setNow(Date.now());
      if (Date.now() - loadedAt > STALE_MS / 5) {
        loadedAt = Date.now();
        void load();
      }
    });
  }, []);

  async function act(key: string, path: string, body: unknown, done: string) {
    setBusy(key);
    setFlash('');
    try {
      await api(path, { body });
      setFlash(done);
      await load();
    } catch (e) {
      setFlash((e as ApiError).message);
    } finally {
      setBusy('');
    }
  }

  /** Book a time for a caller: the booking form opens with their address and details in. */
  async function bookFor(r: CallRow) {
    setBusy(`book-${r.id}`);
    try {
      const detail = await api<{ prefill: { place: unknown; contact: unknown } }>(`request/${r.id}`);
      localStorage.removeItem('booking-draft-v1');
      sessionStorage.setItem('estimate-handoff-v1', JSON.stringify({ place: detail.prefill.place, contact: detail.prefill.contact }));
      location.href = '/estimate/book/';
    } catch (e) {
      setFlash(e instanceof ApiError ? e.message : 'That didn\'t open. Try again.');
      setBusy('');
    }
  }

  if (error && !d) {
    return (
      <div class="owner-pad">
        <p class="error-box" role="alert">
          {error}
        </p>
        <button type="button" class="btn secondary" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }
  if (!d) {
    return (
      <div class="owner-pad" aria-busy="true">
        <p class="eyebrow">&nbsp;</p>
        <h1>Loading...</h1>
        <div class="skeleton tall" />
        <div class="skeleton" />
        <div class="skeleton" />
      </div>
    );
  }

  const first = d.name.split(' ')[0] ?? '';
  const todayVisits = d.visits.filter((v) => dayKey(v.startsAt) === d.today);
  const active = todayVisits.filter((v) => v.status === 'booked' && Date.parse(v.endsAt) > now);
  const next = active[0] ?? null;
  const restToday = todayVisits.filter((v) => v !== next);
  const later = d.visits.filter((v) => dayKey(v.startsAt) !== d.today && v.status === 'booked');
  const byDay = new Map<string, Row[]>();
  for (const v of later) byDay.set(dayKey(v.startsAt), [...(byDay.get(dayKey(v.startsAt)) ?? []), v]);
  const weekCount = d.visits.filter((v) => v.status !== 'cancelled').length;
  const nowLive = next ? Date.parse(next.startsAt) <= now : false;

  return (
    <div class="owner-pad home">
      <header class="home-hello">
        <p class="eyebrow">{longDay(`${d.today}T12:00:00Z`)}</p>
        <h1>
          {greeting(new Date(now))}
          {first ? `, ${first}` : ''}
        </h1>
      </header>

      <PushCard compact />

      <nav class="stat-grid" aria-label="At a glance">
        <a class={`stat ${d.toCall.length ? 'hot' : ''}`} href="#/requests">
          <span class="stat-n">{d.toCall.length}</span>
          <span class="stat-l">To call</span>
        </a>
        <a class="stat" href={`#/day/${d.today}`}>
          <span class="stat-n">{todayVisits.filter((v) => v.status !== 'cancelled').length}</span>
          <span class="stat-l">Visits today</span>
        </a>
        <a class="stat" href="#/upcoming">
          <span class="stat-n">{weekCount}</span>
          <span class="stat-l">Next 7 days</span>
        </a>
        <a class="stat" href="#/estimates">
          <span class="stat-n">{money(d.estimates.out.cents)}</span>
          <span class="stat-l">
            {d.estimates.out.count} estimate{d.estimates.out.count === 1 ? '' : 's'} out
          </span>
        </a>
      </nav>
      {(d.estimates.toWrite > 0 || d.estimates.wonThisMonth.count > 0) && (
        <p class="home-money small">
          {d.estimates.wonThisMonth.count > 0 && (
            <span>
              Won this month: <strong>{money(d.estimates.wonThisMonth.cents)}</strong> ({d.estimates.wonThisMonth.count}).{' '}
            </span>
          )}
          {d.estimates.toWrite > 0 && (
            <a href="#/estimates">
              {d.estimates.toWrite} estimate{d.estimates.toWrite === 1 ? '' : 's'} to write
            </a>
          )}
        </p>
      )}

      <p class="flash" role="status">
        {flash}
      </p>

      <section aria-labelledby="call-h">
        <div class="section-head">
          <h2 id="call-h">Call now</h2>
          <a href="#/requests" class="small">
            All requests
          </a>
        </div>
        {d.toCall.length === 0 ? (
          <p class="muted">Nobody waiting for a call. {d.calledCount > 0 ? `${d.calledCount} called, not booked yet.` : ''}</p>
        ) : (
          <ul class="plain-list call-list">
            {d.toCall.map((r) => {
              const p = promiseLabel(r.createdAt, now);
              return (
                <li key={r.id} class="card call-card">
                  <div class="call-top">
                    <a class="call-name" href={`#/request/${r.id}`}>
                      {r.name}
                    </a>
                    <span class={`promise ${p.late ? 'late' : ''}`}>
                      <Icon name="timer" size={16} />
                      {p.left}
                    </span>
                  </div>
                  <p class="call-meta">
                    {townOf(r.address)} · asked {ago(r.createdAt, now).toLowerCase()} · {p.by.toLowerCase()}
                  </p>
                  {r.roof && <p class="call-roof small">{r.roof}</p>}
                  <div class="call-actions">
                    <a class="btn" href={`tel:${r.mobile}`} aria-label={`Call ${formatMobile(r.mobile)}, ${r.name}`}>
                      <Icon name="phone" size={18} />
                      Call
                    </a>
                    <button
                      type="button"
                      class="btn secondary"
                      disabled={busy !== ''}
                      onClick={() => void act(`called-${r.id}`, `request/${r.id}`, { action: 'status', status: 'called' }, `${r.name} marked called.`)}
                    >
                      <Icon name="check" size={18} />
                      Called
                    </button>
                    <button type="button" class="btn secondary" disabled={busy !== ''} onClick={() => void bookFor(r)}>
                      <Icon name="calendar-plus" size={18} />
                      Book
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="tasks-h">
        <div class="section-head">
          <h2 id="tasks-h">Tasks due</h2>
          <a href="#/tasks/mine" class="small">
            All my tasks{d.taskCounts.mine > 0 ? ` (${d.taskCounts.mine})` : ''}
          </a>
        </div>
        {d.tasks.length === 0 ? (
          <p class="muted">
            Nothing due today.
            {d.taskCounts.unassigned > 0 && (
              <>
                {' '}
                <a href="#/tasks/nobody">
                  {d.taskCounts.unassigned} task{d.taskCounts.unassigned === 1 ? '' : 's'} with nobody on {d.taskCounts.unassigned === 1 ? 'it' : 'them'}
                </a>
                .
              </>
            )}
          </p>
        ) : (
          <ul class="reset-list task-list card-list">
            {d.tasks.map((t) => {
              const due = dueLabel(t.dueOn, d.today);
              return (
                <li key={t.id} class="task">
                  <button
                    type="button"
                    class="task-check"
                    aria-pressed="false"
                    disabled={busy !== ''}
                    aria-label={`Mark done: ${t.title}`}
                    onClick={() => void act(`task-${t.id}`, `task/${t.id}`, { task: { status: 'done' } }, `Done: ${t.title}`)}
                  >
                    <Icon name="circle" size={24} />
                  </button>
                  <div class="task-main">
                    <a class="task-title" href={t.mobile ? customerHref(t.mobile) : '#/tasks/mine'}>
                      {t.title}
                    </a>
                    <p class="task-meta">
                      <span class={`due ${due.late ? 'late' : 'today'}`}>{due.text}</span>
                      {!t.mine && <span class="muted">Nobody yet</span>}
                    </p>
                  </div>
                  {!t.mine && (
                    <button
                      type="button"
                      class="btn secondary small-btn"
                      disabled={busy !== ''}
                      onClick={() => void act(`take-${t.id}`, `task/${t.id}`, { task: { assignee: d.me } }, `It's yours: ${t.title}`)}
                    >
                      Take it
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="next-h">
        <div class="section-head">
          <h2 id="next-h">{next ? (nowLive ? 'Now' : 'Next stop') : 'Today'}</h2>
          <a href={`#/day/${d.today}`} class="small">
            Whole day
          </a>
        </div>
        {next ? (
          <article class="card next-stop">
            <p class="next-when">
              <Icon name="clock" size={18} />
              {windowLabel(next.startsAt, next.endsAt)}
            </p>
            <a class="next-name" href={`#/booking/${next.id}`}>
              {next.name}
            </a>
            <p class="next-where">{next.address}</p>
            <p class="small muted">
              {next.reason}
              {next.someoneHome ? ` · Home: ${next.someoneHome.toLowerCase()}` : ''}
              {next.hasGateCode ? ' · Gate code on file' : ''}
              {next.pets ? ` · Pets: ${next.pets}` : ''}
            </p>
            <div class="next-actions">
              <a class="btn" href={directions(next)} target="_blank" rel="noopener">
                <Icon name="navigation" size={18} />
                Navigate
              </a>
              <a class="btn secondary" href={`tel:${next.mobile}`} aria-label={`Call ${next.name}`}>
                <Icon name="phone" size={18} />
                Call
              </a>
              <a class="btn secondary" href={`sms:${next.mobile}`} aria-label={`Text ${next.name}`}>
                <Icon name="message-square" size={18} />
                Text
              </a>
            </div>
            {next.onMyWayAt ? (
              <p class="small muted">You told them you're on the way, {ago(next.onMyWayAt, now).toLowerCase()}.</p>
            ) : omw ? (
              <div class="minutes" role="group" aria-label="On my way: how long?">
                {MINUTES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    class="btn secondary"
                    disabled={busy !== ''}
                    onClick={() => void act(`omw-${next.id}`, `booking/${next.id}`, { action: 'on_my_way', minutes: m }, `Told ${next.name.split(' ')[0]}: on the way, about ${m} minutes.`).then(() => setOmw(false))}
                  >
                    {m} min
                  </button>
                ))}
              </div>
            ) : (
              <button type="button" class="btn secondary block" onClick={() => setOmw(true)}>
                <Icon name="send" size={18} />
                On my way
              </button>
            )}
          </article>
        ) : (
          <p class="muted">{todayVisits.length ? 'All of today\'s visits are done.' : 'No visits today.'}</p>
        )}
        {restToday.length > 0 && (
          <ul class="plain-list visit-rows">
            {restToday.map((v) => (
              <li key={v.id}>
                <a href={`#/booking/${v.id}`} class="visit-row">
                  <span class="vr-time">{windowLabel(v.startsAt, v.endsAt)}</span>
                  <span class="vr-who">
                    {v.name} <span class="muted">· {townOf(v.address)}</span>
                  </span>
                  {v.status !== 'booked' && <span class={`chip status-${v.status}`}>{STATUS_LABEL[v.status] ?? v.status}</span>}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="soon-h">
        <div class="section-head">
          <h2 id="soon-h">Coming up</h2>
          <a href="#/upcoming" class="small">
            Two weeks
          </a>
        </div>
        {byDay.size === 0 ? (
          <p class="muted">Nothing booked in the next 6 days.</p>
        ) : (
          [...byDay.entries()].map(([day, list]) => (
            <div key={day} class="soon-day">
              <h3 class="soon-date">{shortDay(list[0]!.startsAt)}</h3>
              <ul class="plain-list visit-rows">
                {list.map((v) => (
                  <li key={v.id}>
                    <a href={`#/booking/${v.id}`} class="visit-row">
                      <span class="vr-time">{windowLabel(v.startsAt, v.endsAt)}</span>
                      <span class="vr-who">
                        {v.name} <span class="muted">· {townOf(v.address)}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
