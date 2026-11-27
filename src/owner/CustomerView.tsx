// One customer, everything in one place: how to reach them, the next step,
// who owns them, their tasks, notes, visits and estimates, and every call,
// text, email and change in order.
import { useState } from 'preact/hooks';
import Icon, { type IconName } from '../icons/Icon';
import { ApiError, api } from './api';
import { money, shortDay } from '../booking/format';
import type { Stage } from '../booking/stages';
import { STAGE_SHORT } from '../booking/stages';
import TaskSheet, { type TaskLike } from './TaskSheet';
import { Avatar, Failed, Loading, PersonSelect, Sheet, ago, dueLabel, sourceLabel, useAction, useData, type Person } from './ui';

interface Visit {
  id: string;
  ref: string;
  startsAt: string;
  when: string;
  status: string;
  address: string;
  assignedTo: string | null;
  assignedName: string;
  estimate: { status: string; amountCents: number | null } | null;
  job: { status: string; day: string | null; crew: string } | null;
}

interface Detail {
  mobile: string;
  mobileLabel: string;
  name: string;
  email: string;
  address: string;
  town: string;
  source: string;
  stage: Stage;
  stageLabel: string;
  valueCents: number;
  assignedTo: string | null;
  tags: string[];
  lostReason: string;
  next: { text: string; href?: string };
  visits: Visit[];
  requests: { id: string; status: string; createdAt: string; address: string }[];
  tasks: (TaskLike & { assigneeName: string })[];
  timeline: { at: string; kind: string; text: string; by?: string; href?: string }[];
  owners: Person[];
}

const KIND_ICON: Record<string, IconName> = {
  request: 'file-text',
  call: 'phone-call',
  visit: 'calendar-check',
  estimate: 'receipt-text',
  job: 'hammer',
  message_in: 'message-circle',
  message_out: 'send',
  note: 'sticky-note',
  task: 'circle-check',
  closed: 'circle-x',
};

const SUGGESTED_TAGS = ['Hot lead', 'Storm damage', 'Referral', 'Repeat customer', 'Commercial', 'Needs a call'];
const LOST_REASONS = ['Went with another roofer', 'Price', 'Not ready yet', 'No answer', 'Not a fit for us', 'Other'];

const VISIT_LABEL: Record<string, string> = { booked: 'Booked', done: 'Inspected', cancelled: 'Cancelled', no_show: 'No one home' };
const EST_LABEL: Record<string, string> = { draft: 'Estimate draft', sent: 'Estimate sent', accepted: 'Said yes', declined: 'Said no', withdrawn: 'Withdrawn' };

function mapsLink(address: string) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

export default function CustomerView(props: { id: string; me: string }) {
  const { data: c, error, reload } = useData<Detail>(`customer/${props.id}`);
  const act = useAction(reload);
  const [note, setNote] = useState('');
  const [tag, setTag] = useState('');
  const [taskOpen, setTaskOpen] = useState(false);
  const [editTask, setEditTask] = useState<TaskLike | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  if (error && !c) return <Failed message={error} onRetry={() => void reload()} />;
  if (!c) return <Loading title="Customer" />;

  const first = c.name.split(' ')[0] || 'them';
  const path = `customer/${props.id}`;
  const saveProfile = (profile: Record<string, unknown>, done: string) => act.run('profile', () => api(path, { body: { action: 'profile', profile } }), done);
  const openTasks = c.tasks.filter((t) => t.status === 'open');
  const doneTasks = c.tasks.filter((t) => t.status === 'done');
  const timeline = showAll ? c.timeline : c.timeline.slice(0, 12);

  function addTag(t: string) {
    const v = t.trim().replace(/\s+/g, ' ');
    if (!v || c!.tags.includes(v) || c!.tags.length >= 10) return;
    setTag('');
    void saveProfile({ tags: [...c!.tags, v] }, `Tagged "${v}".`);
  }

  return (
    <div class="owner-pad customer">
      <p class="back">
        <a href="#/customers">
          <Icon name="chevron-left" size={18} />
          Customers
        </a>
      </p>

      <header class="profile-head">
        <div>
          <h1>{c.name || c.mobileLabel}</h1>
          <p class="profile-sub">
            <span class={`stage stage-${c.stage}`}>{STAGE_SHORT[c.stage]}</span>
            {c.valueCents > 0 && <span class="cust-value">{money(c.valueCents)}</span>}
            {c.town && <span class="muted">{c.town}</span>}
          </p>
        </div>
      </header>

      <nav class="contact-bar" aria-label={`Reach ${first}`}>
        <a class="contact-btn" href={`tel:${c.mobile}`}>
          <Icon name="phone" size={20} />
          Call
        </a>
        <a class="contact-btn" href={`sms:${c.mobile}`}>
          <Icon name="message-square" size={20} />
          Text
        </a>
        {c.email ? (
          <button type="button" class="contact-btn" onClick={() => setEmailOpen(true)}>
            <Icon name="mail" size={20} />
            Email
          </button>
        ) : (
          <span class="contact-btn off" title="No email on file">
            <Icon name="mail" size={20} />
            No email
          </span>
        )}
        <a class="contact-btn" href={mapsLink(c.address)} target="_blank" rel="noopener">
          <Icon name="navigation" size={20} />
          Map
        </a>
      </nav>

      <p class="flash" role="status">
        {act.flash}
      </p>
      {act.failed && (
        <p class="error-box" role="alert">
          {act.failed}
        </p>
      )}

      <section class="next-card" aria-labelledby="next-step-h">
        <h2 id="next-step-h" class="eyebrow">
          Next step
        </h2>
        <p>{c.next.text}</p>
        {c.next.href && (
          <a class="btn secondary" href={c.next.href}>
            Open
            <Icon name="chevron-right" size={18} />
          </a>
        )}
      </section>

      <dl class="kv contact-kv">
        <dt>Phone</dt>
        <dd>
          <a href={`tel:${c.mobile}`}>{c.mobileLabel}</a>
        </dd>
        <dt>Email</dt>
        <dd>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : <span class="muted">None given</span>}</dd>
        <dt>Address</dt>
        <dd>{c.address}</dd>
        {c.source && c.source !== 'direct' && (
          <>
            <dt>Came from</dt>
            <dd>{sourceLabel(c.source)}</dd>
          </>
        )}
      </dl>

      <section class="panel" aria-labelledby="owner-h">
        <h2 id="owner-h">Who has them</h2>
        <div class="owner-pick">
          <Avatar id={c.assignedTo} people={c.owners} size="md" />
          <div class="grow">
            <PersonSelect
              id="cust-owner"
              label="Owner"
              hideLabel
              value={c.assignedTo}
              people={c.owners}
              me={props.me}
              disabled={act.busy !== ''}
              onChange={(id) => void saveProfile({ assignedTo: id }, id ? `${c.owners.find((o) => o.id === id)?.name.split(' ')[0] ?? 'They'} has ${first} now.` : 'Nobody has them now.')}
            />
          </div>
        </div>
        <p class="small muted">The owner gets the new tasks for this customer and a ping when they're handed over.</p>

        <h3 class="tags-h">Tags</h3>
        <ul class="reset-list tag-edit">
          {c.tags.map((t) => (
            <li key={t} class="tag">
              {t}
              <button type="button" class="tag-x" aria-label={`Remove tag ${t}`} onClick={() => void saveProfile({ tags: c.tags.filter((x) => x !== t) }, `Took off "${t}".`)}>
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
        {c.tags.length < 10 && (
          <form
            class="tag-add"
            onSubmit={(e) => {
              e.preventDefault();
              addTag(tag);
            }}
          >
            <label for="tag-in" class="visually-hidden">
              Add a tag
            </label>
            <input id="tag-in" type="text" maxLength={30} placeholder="Add a tag" value={tag} list="tag-suggest" onInput={(e) => setTag((e.currentTarget as HTMLInputElement).value)} />
            <datalist id="tag-suggest">
              {SUGGESTED_TAGS.filter((t) => !c.tags.includes(t)).map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <button type="submit" class="btn secondary" disabled={!tag.trim()}>
              Add
            </button>
          </form>
        )}
      </section>

      <section class="panel" aria-labelledby="tasks-h">
        <div class="section-head tight">
          <h2 id="tasks-h">Tasks</h2>
          <button
            type="button"
            class="btn secondary small-btn"
            onClick={() => {
              setEditTask(null);
              setTaskOpen(true);
            }}
          >
            <Icon name="plus" size={18} />
            Add
          </button>
        </div>
        {openTasks.length === 0 ? (
          <p class="muted">Nothing open for {first}.</p>
        ) : (
          <ul class="reset-list task-list">
            {openTasks.map((t) => (
              <TaskItem
                key={t.id}
                t={t}
                people={c.owners}
                busy={act.busy !== ''}
                onToggle={() => void act.run(`t-${t.id}`, () => api(`task/${t.id}`, { body: { task: { status: 'done' } } }), `Done: ${t.title}`)}
                onOpen={() => {
                  setEditTask(t);
                  setTaskOpen(true);
                }}
              />
            ))}
          </ul>
        )}
        {doneTasks.length > 0 && (
          <details class="done-tasks">
            <summary>{doneTasks.length} done</summary>
            <ul class="reset-list task-list">
              {doneTasks.map((t) => (
                <TaskItem key={t.id} t={t} people={c.owners} busy={act.busy !== ''} onToggle={() => void act.run(`t-${t.id}`, () => api(`task/${t.id}`, { body: { task: { status: 'open' } } }), `Back on the list: ${t.title}`)} onOpen={() => { setEditTask(t); setTaskOpen(true); }} />
              ))}
            </ul>
          </details>
        )}
      </section>

      <section class="panel" aria-labelledby="note-h">
        <h2 id="note-h">Add a note</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) return;
            void act.run('note', () => api(path, { body: { action: 'note', note } }), 'Note saved.').then((ok) => ok && setNote(''));
          }}
        >
          <label for="note-in" class="visually-hidden">
            Note
          </label>
          <textarea id="note-in" rows={3} maxLength={4000} placeholder={`What you talked about, what ${first} wants, what to remember.`} value={note} onInput={(e) => setNote((e.currentTarget as HTMLTextAreaElement).value)} />
          <button type="submit" class="btn secondary" disabled={!note.trim() || act.busy !== ''}>
            Save note
          </button>
        </form>
      </section>

      {c.visits.length > 0 && (
        <section aria-labelledby="visits-h">
          <h2 id="visits-h">Visits and jobs</h2>
          <ul class="reset-list visit-cards">
            {c.visits.map((v) => (
              <li key={v.id}>
                <a class="card visit-card" href={`#/booking/${v.id}`}>
                  <span class="vc-top">
                    <span class="vc-when">{v.when}</span>
                    <span class={`chip status-${v.status}`}>{VISIT_LABEL[v.status] ?? v.status}</span>
                  </span>
                  <span class="small muted">
                    {v.assignedName ? `Inspector: ${v.assignedName}` : 'No inspector yet'}
                    {v.estimate ? ` · ${EST_LABEL[v.estimate.status] ?? v.estimate.status}${v.estimate.amountCents ? ` ${money(v.estimate.amountCents)}` : ''}` : ''}
                  </span>
                  {v.job && (
                    <span class="small">
                      <Icon name="hammer" size={14} /> Roof job {v.job.status === 'to_schedule' ? 'to schedule' : v.job.status === 'scheduled' && v.job.day ? `${shortDay(`${v.job.day}T12:00:00Z`)}${v.job.crew ? `, ${v.job.crew}` : ''}` : v.job.status}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="hist-h">
        <h2 id="hist-h">History</h2>
        {c.timeline.length === 0 ? (
          <p class="muted">Nothing yet.</p>
        ) : (
          <ol class="timeline">
            {timeline.map((e, i) => (
              <li key={`${e.at}-${i}`} class={`tl-${e.kind}`}>
                <span class="tl-dot" aria-hidden="true">
                  <Icon name={KIND_ICON[e.kind] ?? 'circle'} size={14} />
                </span>
                <div class="tl-body">
                  <p class="tl-text">{e.href ? <a href={e.href}>{e.text}</a> : e.text}</p>
                  <p class="tl-when">
                    {ago(e.at)}
                    {e.by ? ` · ${e.by}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
        {c.timeline.length > 12 && (
          <button type="button" class="btn ghost" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show less' : `Show all ${c.timeline.length}`}
          </button>
        )}
      </section>

      <section class="panel quiet" aria-labelledby="lost-h">
        <h2 id="lost-h">{c.stage === 'lost' ? 'Marked lost' : 'Not moving ahead?'}</h2>
        {c.stage === 'lost' ? (
          <>
            <p>{c.lostReason || 'No reason given.'}</p>
            <button type="button" class="btn secondary" disabled={act.busy !== ''} onClick={() => void saveProfile({ lost: false }, `${first} is back in the pipeline.`)}>
              Back in the pipeline
            </button>
          </>
        ) : (
          <>
            <p class="small muted">Marking them lost takes them off the board and ticks off the app's tasks for them. You can undo it.</p>
            <button type="button" class="btn secondary" onClick={() => setLostOpen(true)}>
              Mark lost
            </button>
          </>
        )}
      </section>

      <TaskSheet
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        onSaved={(m) => {
          act.setFlash(m);
          void reload();
        }}
        people={c.owners}
        me={props.me}
        task={editTask}
        mobile={c.mobile}
        customerName={c.name.split(' ')[0]}
      />
      <EmailSheet open={emailOpen} onClose={() => setEmailOpen(false)} path={path} to={c.email} first={first} onSent={(m) => { act.setFlash(m); void reload(); }} />
      <LostSheet open={lostOpen} onClose={() => setLostOpen(false)} onSave={(reason) => void saveProfile({ lost: true, lostReason: reason }, `${first} marked lost.`).then(() => setLostOpen(false))} />
    </div>
  );
}

export function TaskItem(props: { t: TaskLike & { assigneeName?: string; customerName?: string; mobile?: string | null }; people: Person[]; busy: boolean; onToggle: () => void; onOpen: () => void; showCustomer?: boolean; customerHref?: string }) {
  const t = props.t;
  const due = dueLabel(t.dueOn);
  const done = t.status === 'done';
  return (
    <li class={`task ${done ? 'is-done' : ''}`}>
      <button type="button" class="task-check" aria-pressed={done} disabled={props.busy} onClick={props.onToggle} aria-label={done ? `Not done yet: ${t.title}` : `Mark done: ${t.title}`}>
        <Icon name={done ? 'circle-check' : 'circle'} size={24} />
      </button>
      <div class="task-main">
        <button type="button" class="task-title" onClick={props.onOpen}>
          {t.title}
        </button>
        <p class="task-meta">
          {!done && <span class={`due ${due.late ? 'late' : due.today ? 'today' : ''}`}>{due.text}</span>}
          {props.showCustomer && t.customerName && props.customerHref && <a href={props.customerHref}>{t.customerName}</a>}
          {t.auto && (
            <span class="auto" title="The app made this task">
              <Icon name="sparkles" size={12} /> Auto
            </span>
          )}
        </p>
      </div>
      <Avatar id={t.assignee} people={props.people} />
    </li>
  );
}

function EmailSheet(props: { open: boolean; onClose: () => void; path: string; to: string; first: string; onSent: (m: string) => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function send(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ outcome: string }>(props.path, { body: { action: 'email', email: { subject, body } } });
      props.onSent(r.outcome === 'logged' ? 'Email saved to the history. Test mode, so nothing went out.' : r.outcome === 'duplicate' ? 'That email already went out.' : `Email sent to ${props.first}.`);
      setSubject('');
      setBody('');
      props.onClose();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={props.open} onClose={props.onClose} title={`Email ${props.first}`}>
      <form class="sheet-form" onSubmit={send}>
        <p class="small muted">To {props.to}. It goes out from the business address with your name on it, and replies come to the business inbox.</p>
        <label for="em-subject">Subject</label>
        <input id="em-subject" type="text" maxLength={150} required value={subject} onInput={(e) => setSubject((e.currentTarget as HTMLInputElement).value)} />
        <label for="em-body">Message</label>
        <textarea id="em-body" rows={7} maxLength={5000} required value={body} onInput={(e) => setBody((e.currentTarget as HTMLTextAreaElement).value)} />
        {error && (
          <p class="error-box" role="alert">
            {error}
          </p>
        )}
        <div class="sheet-actions">
          <button type="submit" class="btn" disabled={busy || !subject.trim() || !body.trim()}>
            <Icon name="send" size={18} />
            Send
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function LostSheet(props: { open: boolean; onClose: () => void; onSave: (reason: string) => void }) {
  const [reason, setReason] = useState(LOST_REASONS[0]!);
  const [other, setOther] = useState('');
  return (
    <Sheet open={props.open} onClose={props.onClose} title="Mark lost">
      <form
        class="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          props.onSave(reason === 'Other' ? other.trim() || 'Other' : reason);
        }}
      >
        <fieldset>
          <legend>Why?</legend>
          {LOST_REASONS.map((r) => (
            <label key={r} class="check">
              <input type="radio" name="lost-reason" checked={reason === r} onChange={() => setReason(r)} />
              <span>{r}</span>
            </label>
          ))}
        </fieldset>
        {reason === 'Other' && (
          <>
            <label for="lost-other">What happened</label>
            <input id="lost-other" type="text" maxLength={200} value={other} onInput={(e) => setOther((e.currentTarget as HTMLInputElement).value)} />
          </>
        )}
        <div class="sheet-actions">
          <button type="submit" class="btn">
            Mark lost
          </button>
        </div>
      </form>
    </Sheet>
  );
}
