// Small pieces the owner screens share: loading a screen's data, people's
// initials, a sheet that slides up for a quick form, and due dates.
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import Icon from '../icons/Icon';
import { ApiError, api } from './api';
import { STALE_MS, whenShownAgain } from '../booking/fresh';
import { TZ } from '../booking/format';

export interface Person {
  id: string;
  name: string;
}

/**
 * A screen's data from the owner API. It loads again when the phone comes back
 * to the app after a while, so nobody works from an old list.
 */
export function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const current = useRef(path);
  current.current = path;

  async function load() {
    const p = current.current;
    if (!p) return;
    try {
      const d = await api<T>(p);
      if (current.current === p) {
        setData(d);
        setError('');
      }
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  useEffect(() => {
    void load();
    let at = Date.now();
    return whenShownAgain(() => {
      if (Date.now() - at > STALE_MS / 5) {
        at = Date.now();
        void load();
      }
    });
  }, [path]);

  return { data, error, reload: load, setData };
}

/** Run an action, show what happened, and reload. One action at a time. */
export function useAction(reload: () => Promise<void>) {
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useState('');
  const [failed, setFailed] = useState('');
  async function run(key: string, fn: () => Promise<unknown>, done = '') {
    setBusy(key);
    setFlash('');
    setFailed('');
    try {
      await fn();
      if (done) setFlash(done);
      await reload();
      return true;
    } catch (e) {
      setFailed(e instanceof ApiError ? e.message : 'That didn\'t work. Try again.');
      return false;
    } finally {
      setBusy('');
    }
  }
  return { busy, flash, failed, run, setFlash, setFailed };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

/** A round badge with someone's initials, in their own color (same color everywhere). */
export function Avatar(props: { id: string | null; people: Person[]; size?: 'sm' | 'md'; label?: boolean }) {
  const i = props.people.findIndex((p) => p.id === props.id);
  const person = i >= 0 ? props.people[i]! : null;
  const cls = `av ${props.size === 'md' ? 'av-md' : ''} ${person ? `av-${i % 6}` : 'av-none'}`;
  const name = person ? person.name : 'Nobody yet';
  return (
    <span class="av-wrap">
      <span class={cls} role="img" aria-label={props.label ? undefined : name} aria-hidden={props.label ? 'true' : undefined} title={name}>
        {person ? initials(person.name) : <Icon name="user" size={14} />}
      </span>
      {props.label && <span class="av-name">{person ? person.name.split(' ')[0] : 'Nobody'}</span>}
    </span>
  );
}

/** Pick an owner, or nobody. */
export function PersonSelect(props: {
  id: string;
  label: string;
  value: string | null;
  people: Person[];
  me?: string;
  disabled?: boolean;
  nobody?: string;
  onChange: (id: string | null) => void;
  hideLabel?: boolean;
  /** First names only, for a narrow spot. */
  short?: boolean;
}) {
  return (
    <>
      <label for={props.id} class={props.hideLabel ? 'visually-hidden' : undefined}>
        {props.label}
      </label>
      <select
        id={props.id}
        value={props.value ?? ''}
        disabled={props.disabled}
        onChange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          props.onChange(v || null);
        }}
      >
        <option value="">{props.nobody ?? 'Nobody yet'}</option>
        {props.people.map((p) => (
          <option key={p.id} value={p.id}>
            {props.short ? p.name.split(' ')[0] : p.name}
            {p.id === props.me ? ' (me)' : ''}
          </option>
        ))}
      </select>
    </>
  );
}

/**
 * A panel that slides up over the screen for a quick form. It's a real dialog:
 * focus moves in, Escape and the close button shut it, and focus goes back.
 */
export function Sheet(props: { open: boolean; title: string; onClose: () => void; children: ComponentChildren; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) d.close();
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      class={`sheet ${props.wide ? 'wide' : ''}`}
      aria-labelledby={id}
      onClose={() => props.open && props.onClose()}
      onClick={(e) => {
        // A tap on the dimmed area outside the panel closes it.
        if (e.target === ref.current) props.onClose();
      }}
    >
      {props.open && (
        <div class="sheet-body">
          <div class="sheet-head">
            <h2 id={id}>{props.title}</h2>
            <button type="button" class="icon-btn" aria-label="Close" onClick={props.onClose}>
              <Icon name="x" size={22} />
            </button>
          </div>
          {props.children}
        </div>
      )}
    </dialog>
  );
}

/** Today where the business is, as YYYY-MM-DD. */
export const todayKey = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

export function addDays(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const dayName = (key: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(`${key}T12:00:00Z`));

/** "Today", "Tomorrow", "Fri", "Dec 12", or "2 days late". */
export function dueLabel(due: string | null, today = todayKey()): { text: string; late: boolean; today: boolean } {
  if (!due) return { text: 'No date', late: false, today: false };
  if (due === today) return { text: 'Today', late: false, today: true };
  if (due < today) {
    const days = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${due}T12:00:00Z`)) / 86_400_000);
    return { text: days === 1 ? 'Yesterday' : `${days} days late`, late: true, today: false };
  }
  if (due === addDays(today, 1)) return { text: 'Tomorrow', late: false, today: false };
  if (due <= addDays(today, 6)) return { text: dayName(due, { weekday: 'long' }), late: false, today: false };
  return { text: dayName(due, { month: 'short', day: 'numeric' }), late: false, today: false };
}

/** Quick picks for a due date. */
export function duePicks(today = todayKey()): { label: string; value: string | null }[] {
  const d = new Date(`${today}T12:00:00Z`);
  const toMonday = ((8 - d.getUTCDay()) % 7) || 7;
  return [
    { label: 'Today', value: today },
    { label: 'Tomorrow', value: addDays(today, 1) },
    { label: 'Next week', value: addDays(today, toMonday) },
    { label: 'No date', value: null },
  ];
}

/** The mobile number as it goes in an address (#/customer/19105551234). */
export const customerHref = (mobile: string) => `#/customer/${mobile.replace(/\D/g, '')}`;

export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return days === 1 ? 'yesterday' : `${days} days ago`;
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }).format(new Date(iso));
}

/** A row of toggle buttons where one is on (a filter, or a view). */
export function Segmented<T extends string>(props: { label: string; value: T; options: { value: T; label: string; count?: number }[]; onChange: (v: T) => void }) {
  return (
    <div class="seg" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button key={o.value} type="button" aria-pressed={props.value === o.value} onClick={() => props.onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <span class="seg-n">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Failed(props: { message: string; onRetry: () => void }) {
  return (
    <div class="owner-pad">
      <p class="error-box" role="alert">
        {props.message}
      </p>
      <button type="button" class="btn secondary" onClick={props.onRetry}>
        Try again
      </button>
    </div>
  );
}

export function Loading(props: { title: string }) {
  return (
    <div class="owner-pad" aria-busy="true">
      <h1>{props.title}</h1>
      <div class="skeleton" />
      <div class="skeleton" />
      <div class="skeleton" />
    </div>
  );
}

export { sourceLabel } from '../booking/sources';
