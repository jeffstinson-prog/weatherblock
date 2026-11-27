// Add or change a task: what, by when, who. Used from the task list, a
// customer's page and the New button.
import { useEffect, useState } from 'preact/hooks';
import { ApiError, api } from './api';
import { PersonSelect, Sheet, duePicks, todayKey, type Person } from './ui';

export interface TaskLike {
  id: string;
  title: string;
  notes: string;
  dueOn: string | null;
  assignee: string | null;
  status: string;
  auto: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  people: Person[];
  me: string;
  task?: TaskLike | null;
  /** A new task for this customer (their mobile number, +1 and 10 digits). */
  mobile?: string | null;
  customerName?: string;
}

export default function TaskSheet(props: Props) {
  const editing = props.task ?? null;
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [due, setDue] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!props.open) return;
    setTitle(editing?.title ?? '');
    setNotes(editing?.notes ?? '');
    setDue(editing ? editing.dueOn : todayKey());
    setAssignee(editing ? editing.assignee : props.me);
    setError('');
  }, [props.open, editing?.id]);

  async function save(e: Event) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Give the task a title.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (editing) {
        await api(`task/${editing.id}`, { body: { task: { title, notes, dueOn: due, assignee } } });
        props.onSaved('Task saved.');
      } else {
        await api('task', { body: { task: { title, notes, dueOn: due, assignee, mobile: props.mobile ?? null } } });
        props.onSaved(assignee && assignee !== props.me ? `Task added and sent to ${props.people.find((p) => p.id === assignee)?.name.split(' ')[0] ?? 'them'}.` : 'Task added.');
      }
      props.onClose();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing || !confirm('Delete this task?')) return;
    setBusy(true);
    try {
      await api(`task/${editing.id}`, { body: { action: 'delete' } });
      props.onSaved('Task deleted.');
      props.onClose();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const picks = duePicks();
  return (
    <Sheet open={props.open} onClose={props.onClose} title={editing ? 'Task' : props.customerName ? `Task for ${props.customerName}` : 'New task'}>
      <form class="sheet-form" onSubmit={save}>
        {editing?.auto && <p class="small muted">The app made this one. It ticks itself off when the work is done, or you can.</p>}
        <label for="task-title">What needs doing</label>
        <input id="task-title" type="text" maxLength={200} required value={title} onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)} />

        <fieldset class="due-field">
          <legend>Due</legend>
          <div class="seg wrap" role="group" aria-label="Quick dates">
            {picks.map((p) => (
              <button key={p.label} type="button" aria-pressed={due === p.value} onClick={() => setDue(p.value)}>
                {p.label}
              </button>
            ))}
          </div>
          <label for="task-due" class="visually-hidden">
            Due date
          </label>
          <input id="task-due" type="date" value={due ?? ''} onInput={(e) => setDue((e.currentTarget as HTMLInputElement).value || null)} />
        </fieldset>

        <PersonSelect id="task-who" label="Who does it" value={assignee} people={props.people} me={props.me} nobody="Anyone (nobody yet)" onChange={setAssignee} />

        <label for="task-notes">
          Notes <span class="muted">(optional)</span>
        </label>
        <textarea id="task-notes" rows={3} maxLength={2000} value={notes} onInput={(e) => setNotes((e.currentTarget as HTMLTextAreaElement).value)} />

        {error && (
          <p class="error-box" role="alert">
            {error}
          </p>
        )}
        <div class="sheet-actions">
          <button type="submit" class="btn" disabled={busy}>
            {editing ? 'Save' : 'Add task'}
          </button>
          {editing && (
            <button type="button" class="btn ghost danger-text" disabled={busy} onClick={() => void remove()}>
              Delete
            </button>
          )}
        </div>
      </form>
    </Sheet>
  );
}
