// Tasks: who does what, by when. Mine, nobody's yet, everyone's, or done.
// The app adds the routine ones (call back, write the estimate, schedule the
// job, answer a question, close out) and ticks them off when the work is done.
import { useState } from 'preact/hooks';
import Icon from '../icons/Icon';
import { api } from './api';
import { TaskItem } from './CustomerView';
import TaskSheet, { type TaskLike } from './TaskSheet';
import { Failed, Loading, Segmented, addDays, customerHref, todayKey, useAction, useData, type Person } from './ui';

interface Task extends TaskLike {
  assigneeName: string;
  mobile: string | null;
  customerName: string;
  bookingId: string | null;
  requestId: string | null;
  doneAt: string | null;
  doneByName: string;
}

interface Data {
  tasks: Task[];
  owners: Person[];
  me: string;
}

type Filter = 'mine' | 'nobody' | 'all' | 'done';

function groups(list: Task[], today: string): { key: string; title: string; tasks: Task[] }[] {
  const weekEnd = addDays(today, 6);
  const g = [
    { key: 'late', title: 'Late', tasks: list.filter((t) => t.dueOn && t.dueOn < today) },
    { key: 'today', title: 'Today', tasks: list.filter((t) => t.dueOn === today) },
    { key: 'tomorrow', title: 'Tomorrow', tasks: list.filter((t) => t.dueOn === addDays(today, 1)) },
    { key: 'week', title: 'This week', tasks: list.filter((t) => t.dueOn && t.dueOn > addDays(today, 1) && t.dueOn <= weekEnd) },
    { key: 'later', title: 'Later', tasks: list.filter((t) => t.dueOn && t.dueOn > weekEnd) },
    { key: 'none', title: 'No date', tasks: list.filter((t) => !t.dueOn) },
  ];
  return g.filter((x) => x.tasks.length > 0);
}

export default function Tasks(props: { filter: string }) {
  const filter: Filter | string = props.filter || 'mine';
  const which = filter === 'done' ? 'done' : 'open';
  const { data, error, reload } = useData<Data>(`tasks?which=${which}`);
  const act = useAction(reload);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [undo, setUndo] = useState<Task | null>(null);

  if (error && !data) return <Failed message={error} onRetry={() => void reload()} />;
  if (!data) return <Loading title="Tasks" />;

  const me = data.me;
  const isPerson = /^[0-9a-f-]{36}$/.test(filter);
  const person = isPerson ? data.owners.find((o) => o.id === filter) : null;
  const list = data.tasks.filter((t) =>
    filter === 'mine' ? t.assignee === me : filter === 'nobody' ? !t.assignee : isPerson ? t.assignee === filter : true,
  );
  const today = todayKey();
  const counts = which === 'open' ? { mine: data.tasks.filter((t) => t.assignee === me).length, nobody: data.tasks.filter((t) => !t.assignee).length, all: data.tasks.length } : null;

  async function toggle(t: Task) {
    const to = t.status === 'done' ? 'open' : 'done';
    const ok = await act.run(`t-${t.id}`, () => api(`task/${t.id}`, { body: { task: { status: to } } }), to === 'done' ? `Done: ${t.title}` : `Back on the list: ${t.title}`);
    if (ok && to === 'done') setUndo(t);
  }

  const options: { value: Filter; label: string; count?: number }[] = [
    { value: 'mine', label: 'Mine', count: counts?.mine },
    { value: 'nobody', label: 'Nobody yet', count: counts?.nobody },
    { value: 'all', label: 'Everyone', count: counts?.all },
    { value: 'done', label: 'Done' },
  ];

  return (
    <div class="owner-pad">
      <div class="screen-head">
        <h1>{person ? `${person.name.split(' ')[0]}'s tasks` : 'Tasks'}</h1>
        <button
          type="button"
          class="btn small-btn"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Icon name="plus" size={18} />
          New task
        </button>
      </div>
      <Segmented label="Show" value={(isPerson ? 'all' : filter) as Filter} onChange={(v) => (location.hash = `/tasks/${v}`)} options={options} />

      <div class="flash-row" role="status">
        {act.flash && (
          <p class="flash">
            {act.flash}
            {undo && (
              <button
                type="button"
                class="link-btn undo"
                onClick={() => {
                  const t = undo;
                  setUndo(null);
                  void act.run(`t-${t.id}`, () => api(`task/${t.id}`, { body: { task: { status: 'open' } } }), `Back on the list: ${t.title}`);
                }}
              >
                Undo
              </button>
            )}
          </p>
        )}
      </div>
      {act.failed && (
        <p class="error-box" role="alert">
          {act.failed}
        </p>
      )}

      {list.length === 0 ? (
        <div class="empty">
          <Icon name="circle-check" size={32} />
          <p>{filter === 'done' ? 'Nothing done yet.' : filter === 'mine' ? 'Nothing on your list. Nice.' : filter === 'nobody' ? 'Every task has someone on it.' : 'No open tasks.'}</p>
        </div>
      ) : which === 'done' ? (
        <ul class="reset-list task-list card-list">
          {list.map((t) => (
            <TaskItem key={t.id} t={t} people={data.owners} busy={act.busy !== ''} showCustomer customerHref={t.mobile ? customerHref(t.mobile) : undefined} onToggle={() => void toggle(t)} onOpen={() => { setEditing(t); setOpen(true); }} />
          ))}
        </ul>
      ) : (
        groups(list, today).map((g) => (
          <section key={g.key} aria-labelledby={`tg-${g.key}`} class={`task-group tg-${g.key}`}>
            <h2 id={`tg-${g.key}`} class="group-h">
              {g.title} <span class="seg-n">{g.tasks.length}</span>
            </h2>
            <ul class="reset-list task-list card-list">
              {g.tasks.map((t) => (
                <TaskItem key={t.id} t={t} people={data.owners} busy={act.busy !== ''} showCustomer customerHref={t.mobile ? customerHref(t.mobile) : undefined} onToggle={() => void toggle(t)} onOpen={() => { setEditing(t); setOpen(true); }} />
              ))}
            </ul>
          </section>
        ))
      )}

      <TaskSheet
        open={open}
        onClose={() => setOpen(false)}
        onSaved={(m) => {
          act.setFlash(m);
          setUndo(null);
          void reload();
        }}
        people={data.owners}
        me={me}
        task={editing}
        mobile={editing ? null : undefined}
      />
    </div>
  );
}
