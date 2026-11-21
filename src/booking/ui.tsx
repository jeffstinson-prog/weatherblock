// Small accessible building blocks for the booking and manage screens.
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Slot } from './client';
import { dayKey, shortDay, windowLabel } from './format';

export function Choices(props: {
  name: string;
  legend: string;
  hint?: string;
  options: readonly { value: string; label: string }[];
  value: string;
  error?: string;
  onChange: (v: string) => void;
}) {
  const errId = `${props.name}-error`;
  const hintId = `${props.name}-hint`;
  const described = [props.hint ? hintId : '', props.error ? errId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <fieldset class="choices-set" aria-invalid={props.error ? 'true' : undefined}>
      <legend>{props.legend}</legend>
      {props.hint && <p class="hint" id={hintId}>{props.hint}</p>}
      {props.error && <p class="error" id={errId}>{props.error}</p>}
      <div class="choices">
        {props.options.map((o) => (
          <label class="choice" key={o.value}>
            <input
              type="radio"
              id={`${props.name}-${o.value}`}
              name={props.name}
              value={o.value}
              checked={props.value === o.value}
              aria-describedby={described}
              onChange={() => props.onChange(o.value)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function TextField(props: {
  id: string;
  label: string;
  value: string;
  onInput: (v: string) => void;
  error?: string;
  hint?: string;
  optional?: boolean;
  type?: string;
  autocomplete?: string;
  inputMode?: string;
  maxLength?: number;
  multiline?: boolean;
  enterKeyHint?: string;
}) {
  const errId = `${props.id}-error`;
  const hintId = `${props.id}-hint`;
  const described = [props.hint ? hintId : '', props.error ? errId : ''].filter(Boolean).join(' ') || undefined;
  const common = {
    id: props.id,
    name: props.id,
    value: props.value,
    'aria-invalid': props.error ? ('true' as const) : undefined,
    'aria-describedby': described,
    maxLength: props.maxLength,
    onInput: (e: Event) => props.onInput((e.currentTarget as HTMLInputElement).value),
  };
  return (
    <div class="field">
      <label for={props.id}>
        {props.label} {props.optional && <span class="hint">(optional)</span>}
      </label>
      {props.hint && <p class="hint" id={hintId}>{props.hint}</p>}
      {props.multiline ? (
        <textarea {...common} rows={3} />
      ) : (
        <input
          {...common}
          type={(props.type ?? 'text') as 'text'}
          autoComplete={props.autocomplete}
          inputMode={props.inputMode as never}
          enterKeyHint={props.enterKeyHint as never}
        />
      )}
      {props.error && <p class="error" id={errId}>{props.error}</p>}
    </div>
  );
}

/** A list of what to fix, at the top of the step, with links to each field. */
export function ErrorSummary(props: { errors: Record<string, string>; targets: Record<string, string>; message?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const keys = Object.keys(props.errors);
  useEffect(() => {
    if (keys.length > 0 || props.message) ref.current?.focus();
  }, [keys.join(','), props.message]);
  if (keys.length === 0 && !props.message) return null;
  return (
    <div class="error-box" role="alert" tabIndex={-1} ref={ref}>
      <p class="error-title">{props.message ?? (keys.length === 1 ? 'One thing to fix:' : `${keys.length} things to fix:`)}</p>
      {keys.length > 0 && (
        <ul>
          {keys.map((k) => (
            <li key={k}>
              <a href={`#${props.targets[k] ?? k}`}>{props.errors[k]}</a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Notice(props: { children: ComponentChildren; tone?: 'ok' | 'info' }) {
  return <div class={`notice ${props.tone === 'ok' ? 'ok' : ''}`}>{props.children}</div>;
}

/** Pick a day, then a window. Used when booking and when rescheduling. */
export function SlotPicker(props: {
  slots: Slot[];
  value: string | null;
  onChange: (slot: Slot) => void;
  error?: string;
}) {
  const days = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of props.slots) {
      const k = dayKey(s.startsAt);
      map.set(k, [...(map.get(k) ?? []), s]);
    }
    return [...map.entries()];
  }, [props.slots]);
  const chosen = props.slots.find((s) => s.id === props.value);
  const [day, setDay] = useState<string>(chosen ? dayKey(chosen.startsAt) : (days[0]?.[0] ?? ''));
  useEffect(() => {
    if (!days.some(([k]) => k === day) && days[0]) setDay(days[0][0]);
  }, [days]);
  const windows = days.find(([k]) => k === day)?.[1] ?? [];
  return (
    <div class="slot-picker">
      <fieldset aria-invalid={props.error ? 'true' : undefined}>
        <legend>Day</legend>
        {props.error && <p class="error" id="slot-error">{props.error}</p>}
        <div class="days" role="group">
          {days.map(([k, list]) => (
            <button
              type="button"
              key={k}
              id={`day-${k}`}
              class={`day ${k === day ? 'on' : ''}`}
              aria-pressed={k === day}
              onClick={() => setDay(k)}
            >
              {shortDay(list[0]!.startsAt)}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Arrival window</legend>
        <div class="choices one-col">
          {windows.map((s, i) => (
            <label class="choice" key={s.id}>
              <input
                type="radio"
                name="slot"
                id={i === 0 ? 'slot' : `slot-${s.id}`}
                value={s.id}
                checked={props.value === s.id}
                aria-describedby={props.error ? 'slot-error' : undefined}
                onChange={() => props.onChange(s)}
              />
              <span>{windowLabel(s.startsAt, s.endsAt)}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
