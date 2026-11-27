// Six steps from booking to a finished roof. Steps done have a tick and their
// date; the one the project is on now has a ring and bold type, and is marked
// aria-current="step". Shape and type carry the meaning, not just color.
import Icon from '../../icons/Icon';
import { monthDay } from '../format';
import type { Step } from '../progress';

export default function Tracker(props: { steps: Step[] }) {
  return (
    <section class="tracker" aria-labelledby="progress-h">
      <h2 id="progress-h">Progress</h2>
      <ol class="track">
        {props.steps.map((s) => (
          <li key={s.key} class={`track-step${s.reached ? ' reached' : ''}${s.current ? ' current' : ''}`} aria-current={s.current ? 'step' : undefined}>
            <span class="track-mark" aria-hidden="true">
              {s.reached && <Icon name="check" size={14} stroke={3} />}
            </span>
            <span class="track-label">{s.label}</span>
            {s.at ? <span class="track-date">{monthDay(s.at)}</span> : <span class="track-date none" aria-hidden="true" />}
            <span class="visually-hidden">{s.reached ? ', done' : ', not yet'}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
