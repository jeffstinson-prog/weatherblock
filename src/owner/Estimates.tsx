// Everything after the inspection, in the order you work it: write the
// estimate, wait for an answer, then put the yeses on the calendar.
import { useEffect, useState } from 'preact/hooks';
import { ApiError, api } from './api';
import { money, shortDay } from '../booking/format';

interface Pipeline {
  followUpsHeld: boolean;
  needsEstimate: { id: string; name: string; address: string; inspectedAt: string; draft: boolean }[];
  waiting: {
    id: string;
    name: string;
    address: string;
    amountCents: number | null;
    sentAt: string;
    viewedAt: string | null;
    repliedAt: string | null;
    question: string;
    followUpsSent: number;
    followUpsTotal: number;
    followUpsStopped: boolean;
  }[];
  saidYes: { id: string; name: string; address: string; amountCents: number | null; decidedAt: string | null }[];
  closed: { id: string; name: string; address: string; status: string; decidedAt: string | null; note: string }[];
}

export default function Estimates() {
  const [data, setData] = useState<Pipeline | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Pipeline>('pipeline')
      .then(setData)
      .catch((e: ApiError) => setError(e.message));
  }, []);

  return (
    <section class="owner-pad">
      <h1>Estimates</h1>
      <p class="muted">After the inspection, in the order you work it.</p>
      {error && <p class="error-box" role="alert">{error}</p>}
      {data === null && !error && <p aria-live="polite">Loading...</p>}
      {data?.followUpsHeld && (
        <p class="notice" role="status">
          Follow-up emails start once a mailing address for the business is on file. The law for marketing email (CAN-SPAM) needs one, and a P.O. box works.
        </p>
      )}
      {data && (
        <>
          <section aria-labelledby="needs-h">
            <h2 id="needs-h">Needs an estimate ({data.needsEstimate.length})</h2>
            {data.needsEstimate.length === 0 ? (
              <p class="muted">None. Every finished inspection has an estimate.</p>
            ) : (
              <ul class="up-list">
                {data.needsEstimate.map((r) => (
                  <li key={r.id}>
                    <a href={`#/booking/${r.id}`}>
                      <span class="when">{shortDay(r.inspectedAt)}</span> {r.name}, {r.address} {r.draft && <span class="chip">Draft</span>}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="wait-h">
            <h2 id="wait-h">Waiting on the customer ({data.waiting.length})</h2>
            {data.waiting.length === 0 ? (
              <p class="muted">None.</p>
            ) : (
              <ul class="up-list">
                {data.waiting.map((r) => (
                  <li key={r.id}>
                    <a href={`#/booking/${r.id}`}>
                      <span class="when">Sent {shortDay(r.sentAt)}</span> {r.name}, {r.address}
                      {r.amountCents ? `, ${money(r.amountCents)}` : ''}
                      <br />
                      <span class="muted small">
                        {r.question
                          ? `Asked: "${r.question.slice(0, 120)}"`
                          : [
                              r.viewedAt ? 'Opened' : 'Not opened yet',
                              r.followUpsStopped ? 'follow-ups stopped' : data.followUpsHeld ? 'follow-ups waiting' : `follow-ups ${r.followUpsSent} of ${r.followUpsTotal}`,
                            ].join(', ')}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="yes-h">
            <h2 id="yes-h">Said yes, needs a day ({data.saidYes.length})</h2>
            {data.saidYes.length === 0 ? (
              <p class="muted">None.</p>
            ) : (
              <ul class="up-list">
                {data.saidYes.map((r) => (
                  <li key={r.id}>
                    <a href={`#/booking/${r.id}`}>
                      {r.decidedAt && <span class="when">{shortDay(r.decidedAt)}</span>} {r.name}, {r.address}
                      {r.amountCents ? `, ${money(r.amountCents)}` : ''}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.closed.length > 0 && (
            <details class="panel">
              <summary>Said no thanks or taken back, last 60 days ({data.closed.length})</summary>
              <ul class="up-list">
                {data.closed.map((r) => (
                  <li key={r.id}>
                    <a href={`#/booking/${r.id}`}>
                      {r.name}, {r.address} <span class="chip cancelled">{r.status === 'declined' ? 'Said no' : 'Taken back'}</span>
                      {r.note && (
                        <>
                          <br />
                          <span class="muted small">"{r.note.slice(0, 120)}"</span>
                        </>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
