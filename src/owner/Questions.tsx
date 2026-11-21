// What people asked the automated assistant (kept 30 days). The unanswered
// ones are the help center's to-do list.
import { useEffect, useState } from 'preact/hooks';
import { ApiError, api } from './api';

interface Q {
  at: string;
  question: string;
  answered: boolean;
  blocked: string;
}

const RULES: Record<string, string> = {
  price: 'it tried to give a price',
  insurance: 'it tried to promise insurance would pay',
  claims: 'it tried to say we handle claims',
  deductible: 'it tried to offer help with a deductible',
  credential: "it tried to claim a credential we haven't confirmed",
  rating: 'it tried to state a rating',
  years: 'it tried to claim years in business',
  human: 'it tried to say it was a person',
  booked: 'it tried to say someone was booked',
  number: 'it used a number or link we don\'t know',
  dash: 'style',
  refused: 'it declined to answer',
};

export default function Questions() {
  const [list, setList] = useState<Q[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ questions: Q[] }>('questions')
      .then((d) => setList(d.questions))
      .catch((e: ApiError) => setError(e.message));
  }, []);

  const open = list?.filter((q) => !q.answered) ?? [];
  const done = list?.filter((q) => q.answered) ?? [];

  return (
    <section class="owner-pad">
      <p><a href="#/more">Back to More</a></p>
      <h1>Assistant questions</h1>
      <p class="muted">The last 30 days. Questions it couldn't answer are ideas for new help center answers.</p>
      {error && <p class="error-box" role="alert">{error}</p>}
      {list === null && !error && <p aria-live="polite">Loading...</p>}
      <h2>Couldn't answer ({open.length})</h2>
      {open.length === 0 && list !== null && <p>None.</p>}
      <ul class="plain-list">
        {open.map((q, i) => (
          <li key={i}>
            {q.question}
            <br />
            <span class="muted small">
              {new Date(q.at).toLocaleString('en-US', { timeZone: 'America/New_York' })}
              {q.blocked && `. Stopped because ${RULES[q.blocked] ?? q.blocked}`}
            </span>
          </li>
        ))}
      </ul>
      <details class="panel">
        <summary>Answered ({done.length})</summary>
        <ul class="plain-list">
          {done.map((q, i) => (
            <li key={i}>{q.question}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
