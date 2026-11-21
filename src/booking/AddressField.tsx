// Address with suggestions as you type (an accessible combobox).
// If lookup is down or the address isn't listed, "Use the address I typed" still works.
import { useEffect, useRef, useState } from 'preact/hooks';
import Icon from '../icons/Icon';
import { post, uuid, type Place, type Suggestion } from './client';

interface Props {
  value: string;
  selected: boolean;
  typed: boolean;
  error?: string;
  outOfArea?: string;
  onText: (text: string) => void;
  onPlace: (place: Place, satellite: string | null) => void;
  onUseTyped: () => void;
}

export default function AddressField(props: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState('');
  const [google, setGoogle] = useState(false);
  const [checking, setChecking] = useState(false);
  const session = useRef<string>(uuid());
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(0);
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Someone can start typing before the page's script is ready. Pick up what's
  // already in the box, so the list of matches still shows.
  useEffect(() => {
    const typed = box.current?.value ?? '';
    if (typed && typed !== props.value) {
      props.onText(typed);
      lookup(typed);
    }
  }, []);

  function lookup(text: string) {
    window.clearTimeout(timer.current);
    if (text.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    timer.current = window.setTimeout(async () => {
      const ticket = ++latest.current;
      try {
        const data = await post<{ suggestions: Suggestion[]; provider: string }>('/api/places/autocomplete', {
          input: text,
          sessionToken: session.current,
        });
        if (ticket !== latest.current) return;
        setGoogle(data.provider === 'google');
        setSuggestions(data.suggestions);
        setOpen(data.suggestions.length > 0);
        setActive(-1);
        setStatus(
          data.suggestions.length === 0
            ? 'No matches yet. Keep typing, or use the address as you typed it.'
            : `${data.suggestions.length} ${data.suggestions.length === 1 ? 'match' : 'matches'}. Use the arrow keys or tap one.`,
        );
      } catch {
        if (ticket !== latest.current) return;
        setSuggestions([]);
        setOpen(false);
        setStatus('Address lookup is down right now. Tap "Use the address I typed".');
      }
    }, 250);
  }

  async function choose(s: Suggestion) {
    setOpen(false);
    setSuggestions([]);
    setChecking(true);
    setStatus('Checking the address...');
    try {
      const data = await post<{ place: Place; satellite: string | null }>('/api/places/details', {
        placeId: s.placeId,
        sessionToken: session.current,
      });
      props.onPlace(data.place, data.satellite);
      setStatus('');
    } catch {
      props.onText(`${s.main}, ${s.secondary}`);
      setStatus('We couldn\'t check that address. Tap "Use the address I typed" to go on.');
    } finally {
      setChecking(false);
      session.current = uuid(); // a new lookup session for the next address
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      void choose(suggestions[active]!);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const describedBy = ['address-hint', props.error ? 'address-error' : '', props.outOfArea ? 'address-area' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div class="field address-field">
      <label for="address">Address of the home</label>
      <p class="hint" id="address-hint">Start typing, then pick it from the list.</p>
      <div class="combo">
        <Icon name="map-pin" size={20} />
        <input
          ref={box}
          id="address"
          name="address"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="address-list"
          aria-activedescendant={open && active >= 0 ? `address-opt-${active}` : undefined}
          aria-invalid={props.error || props.outOfArea ? 'true' : undefined}
          aria-describedby={describedBy}
          autoComplete="street-address"
          enterKeyHint="search"
          value={props.value}
          onInput={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value;
            props.onText(v);
            lookup(v);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => window.setTimeout(() => setOpen(false), 200)}
        />
        <ul id="address-list" role="listbox" aria-label="Address suggestions" class="options" hidden={!open}>
          {suggestions.map((s, i) => (
            <li
              key={s.placeId}
              id={`address-opt-${i}`}
              role="option"
              aria-selected={i === active}
              class={i === active ? 'active' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void choose(s)}
            >
              <strong>{s.main}</strong>
              <span>{s.secondary}</span>
            </li>
          ))}
          {google && <li class="powered" role="presentation">Address suggestions powered by Google</li>}
        </ul>
      </div>
      <p class="hint" aria-live="polite">
        {checking ? 'Checking the address...' : status}
      </p>
      {props.selected && !props.outOfArea && (
        <p class="ok-line">
          <Icon name="circle-check" size={18} />
          Found it.
        </p>
      )}
      {props.typed && !props.selected && (
        <p class="ok-line">
          <Icon name="circle-check" size={18} />
          We'll use the address as you typed it.
        </p>
      )}
      {!props.selected && !props.typed && props.value.trim().length >= 5 && (
        <button type="button" class="btn secondary small-btn" onClick={props.onUseTyped}>
          Use the address I typed
        </button>
      )}
      {props.outOfArea && (
        <p class="error" id="address-area">
          {props.outOfArea}
        </p>
      )}
      {props.error && (
        <p class="error" id="address-error">
          {props.error}
        </p>
      )}
    </div>
  );
}
