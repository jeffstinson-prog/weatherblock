// After the inspection, on one booking: write and send the estimate, see the
// customer's answer, then put the roof job on a crew's day.
import { useEffect, useState } from 'preact/hooks';
import { ApiError, api } from './api';
import { dateLong } from '../booking/format';

export interface EstimateInfo {
  status: 'draft' | 'sent' | 'accepted' | 'declined' | 'withdrawn';
  amountCents: number | null;
  summary: string;
  fileName: string;
  fileUrl: string | null;
  sentAt: string | null;
  sendCount: number;
  viewedAt: string | null;
  decidedAt: string | null;
  repliedAt: string | null;
  customerNote: string;
  followUpsSent: number;
  followUpsTotal: number;
  followUpsStoppedAt: string | null;
}

export interface JobInfo {
  status: 'to_schedule' | 'scheduled' | 'done' | 'cancelled';
  crewId: string | null;
  crewName: string;
  day: string | null;
  doneAt: string | null;
}

export interface CrewInfo {
  id: string;
  name: string;
  jobsPerDay: number;
  active: boolean;
}

interface Props {
  bookingId: string;
  bookingStatus: string;
  firstName: string;
  smsConsent: boolean;
  estimate: EstimateInfo | null;
  job: JobInfo | null;
  crews: CrewInfo[];
  followUpsHeld: boolean;
  onChanged: () => Promise<void>;
  /** The booking screen has one place for "done" and "that didn't work" messages. */
  onFlash: (message: string) => void;
  onError: (message: string) => void;
}

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

/** "$12,500" or "12500.50" to cents; null if it isn't a price. */
export function parseDollars(input: string): number | null {
  const clean = input.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const cents = Math.round(Number(clean) * 100);
  return cents >= 100 ? cents : null;
}

export default function EstimatePanel(p: Props) {
  const e = p.estimate;
  const editable = !e || e.status === 'draft' || e.status === 'sent' || e.status === 'withdrawn';
  const [amount, setAmount] = useState(e?.amountCents ? String(e.amountCents / 100) : '');
  const [summary, setSummary] = useState(e?.summary ?? '');
  const [busy, setBusy] = useState(false);
  const setError = p.onError;
  const setFlash = p.onFlash;
  const [crewId, setCrewId] = useState(p.job?.crewId ?? p.crews.find((c) => c.active)?.id ?? '');
  const [day, setDay] = useState(p.job?.day ?? '');
  const [crewFull, setCrewFull] = useState('');

  useEffect(() => {
    setAmount(e?.amountCents ? String(e.amountCents / 100) : '');
    setSummary(e?.summary ?? '');
  }, [e?.amountCents, e?.summary]);

  async function post(body: Record<string, unknown>, done: string): Promise<boolean> {
    setBusy(true);
    setError('');
    setFlash('');
    setCrewFull('');
    try {
      await api(`booking/${p.bookingId}`, { body });
      await p.onChanged();
      setFlash(done);
      return true;
    } catch (err) {
      const ae = err as ApiError;
      if (ae.code === 'crew_full') setCrewFull(ae.message);
      else setError(ae.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function estimateBody(send: boolean) {
    const cents = amount.trim() ? parseDollars(amount) : null;
    if (amount.trim() && cents === null) {
      setError('Enter the price in dollars, like 12500.');
      return null;
    }
    return { action: 'estimate_save', estimate: { amountCents: cents, summary, send } };
  }

  async function attach(file: File | undefined) {
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setError('Attach a PDF.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('That file is over 10 MB. Save a smaller PDF and try again.');
      return;
    }
    setFlash('Attaching...');
    setError('');
    try {
      const u = await api<{ path: string; upload: { url: string; method: 'PUT'; headers: Record<string, string> } }>(`booking/${p.bookingId}`, {
        body: { action: 'estimate_upload' },
      });
      const res = await fetch(u.upload.url, { method: 'PUT', headers: u.upload.headers, body: file });
      if (!res.ok) throw new ApiError(res.status, "The file didn't upload. Try again.");
      await api(`booking/${p.bookingId}`, { body: { action: 'estimate_save', estimate: { filePath: u.path, fileName: file.name.slice(0, 200) } } });
      await p.onChanged();
      setFlash(`Attached ${file.name}.`);
    } catch (err) {
      setFlash('');
      setError((err as ApiError).message);
    }
  }

  if (p.bookingStatus !== 'done' && !e) {
    return (
      <section aria-labelledby="est-h" class="panel">
        <h2 id="est-h">Estimate</h2>
        <p class="muted">After the visit, mark it done below. Then write the estimate here.</p>
      </section>
    );
  }

  const sent = e?.status === 'sent';
  return (
    <>
      <section aria-labelledby="est-h" class="panel estimate-panel">
        <h2 id="est-h">Estimate</h2>

        {e && e.status !== 'draft' && (
          <p class="lead-line">
            <span class={`chip est-${e.status}`}>{ESTIMATE_LABEL[e.status]}</span>{' '}
            {e.sentAt && <span class="muted small">Sent {when(e.sentAt)}{e.sendCount > 1 ? ` (version ${e.sendCount})` : ''}.</span>}
          </p>
        )}

        {sent && (
          <ul class="plain-list small">
            <li>{e.viewedAt ? `Opened ${when(e.viewedAt)}.` : 'Not opened yet.'}</li>
            <li>
              {e.followUpsStoppedAt
                ? 'Follow-ups stopped.'
                : e.repliedAt && e.sentAt && e.repliedAt > e.sentAt
                  ? 'Follow-ups stopped: they asked a question or texted us.'
                  : p.followUpsHeld
                    ? 'Follow-up emails start once a mailing address for the business is on file.'
                    : `Follow-up emails: ${e.followUpsSent} of ${e.followUpsTotal} sent.`}
            </li>
          </ul>
        )}

        {e?.customerNote && (
          <blockquote class="customer-note">
            <p>"{e.customerNote}"</p>
            <footer class="muted small">{p.firstName}{e.repliedAt ? `, ${when(e.repliedAt)}` : ''}</footer>
          </blockquote>
        )}

        {e?.status === 'accepted' && <p>{p.firstName} said yes{e.decidedAt ? ` on ${when(e.decidedAt)}` : ''}. Pick a crew and a day below.</p>}
        {e?.status === 'declined' && <p>{p.firstName} said no thanks{e.decidedAt ? ` on ${when(e.decidedAt)}` : ''}.</p>}

        {editable && p.bookingStatus === 'done' && (
          <div class="estimate-form">
            <label for="est-amount">Price</label>
            <input id="est-amount" type="text" inputMode="decimal" autoComplete="off" placeholder="12500" value={amount} onInput={(ev) => setAmount((ev.currentTarget as HTMLInputElement).value)} />
            <label for="est-summary">What's included</label>
            <textarea id="est-summary" rows={5} maxLength={4000} value={summary} onInput={(ev) => setSummary((ev.currentTarget as HTMLTextAreaElement).value)} />
            <p class="muted small">The customer sees the price and this text on their private page. The email and text only say it's ready.</p>
            <div class="file-row">
              {e?.fileUrl ? (
                <p class="small">
                  Attached: <a href={e.fileUrl} target="_blank" rel="noopener">{e.fileName || 'estimate.pdf'}</a>
                </p>
              ) : null}
              <label class="btn secondary file-btn">
                {e?.fileUrl ? 'Replace the PDF' : 'Attach a PDF (optional)'}
                <input type="file" accept="application/pdf" class="visually-hidden" onChange={(ev) => void attach((ev.currentTarget as HTMLInputElement).files?.[0])} />
              </label>
            </div>
            <div class="minutes">
              {!sent && (
                <button type="button" class="btn secondary" disabled={busy} onClick={() => { const b = estimateBody(false); if (b) void post(b, 'Draft saved.'); }}>
                  Save draft
                </button>
              )}
              <button type="button" class="btn" disabled={busy} onClick={() => { const b = estimateBody(true); if (b) void post(b, sent ? 'Updated estimate sent.' : `Sent to ${p.firstName}.`); }}>
                {sent ? 'Send updated estimate' : 'Send estimate'}
              </button>
            </div>
            <p class="muted small">
              {p.firstName} gets an email{p.smsConsent ? ' and a text' : ''} with a link to see it and answer.
            </p>
          </div>
        )}

        {sent && (
          <details class="more-actions">
            <summary>Answered by phone, or other changes</summary>
            <div class="minutes">
              <button type="button" class="btn secondary" disabled={busy} onClick={() => void post({ action: 'estimate', estimateAction: 'accepted' }, 'Marked: said yes.')}>
                They said yes
              </button>
              <button type="button" class="btn secondary" disabled={busy} onClick={() => void post({ action: 'estimate', estimateAction: 'declined' }, 'Marked: said no thanks.')}>
                They said no
              </button>
              {!e.followUpsStoppedAt && (
                <button type="button" class="btn secondary" disabled={busy} onClick={() => void post({ action: 'estimate', estimateAction: 'stop_followups' }, 'Follow-ups stopped.')}>
                  Stop follow-ups
                </button>
              )}
              <button type="button" class="btn secondary" disabled={busy} onClick={() => void post({ action: 'estimate', estimateAction: 'withdraw' }, 'Estimate taken back.')}>
                Take it back
              </button>
            </div>
          </details>
        )}
      </section>

      {p.job && p.job.status !== 'cancelled' && (
        <section aria-labelledby="job-h" class="panel">
          <h2 id="job-h">Roof job</h2>
          {p.job.status === 'done' ? (
            <p>Done{p.job.doneAt ? ` ${when(p.job.doneAt)}` : ''}. {p.firstName} got a thank-you email.</p>
          ) : (
            <>
              {p.job.status === 'scheduled' && p.job.day && (
                <p class="lead-line">
                  <strong>{dateLong(p.job.day)}</strong>, {p.job.crewName || 'no crew'}
                </p>
              )}
              <fieldset class="crew-pick">
                <legend>Crew</legend>
                <div class="choices one-col">
                  {p.crews.filter((c) => c.active).map((c) => (
                    <label class="choice" key={c.id}>
                      <input type="radio" name="crew" value={c.id} checked={crewId === c.id} onChange={() => setCrewId(c.id)} />
                      <span>{c.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label for="job-day">Day</label>
              <input id="job-day" type="date" min={todayLocal()} value={day} onInput={(ev) => setDay((ev.currentTarget as HTMLInputElement).value)} />
              {crewFull && (
                <div class="error-box" role="alert">
                  <p>{crewFull}</p>
                  <button type="button" class="btn secondary" disabled={busy} onClick={() => void post({ action: 'job_schedule', job: { crewId, day, force: true } }, 'Scheduled.')}>
                    Schedule it anyway
                  </button>
                </div>
              )}
              <div class="minutes">
                <button
                  type="button"
                  class="btn"
                  disabled={busy || !crewId || !day}
                  onClick={() => void post({ action: 'job_schedule', job: { crewId, day } }, p.job?.status === 'scheduled' ? 'Moved. The customer was told.' : 'Scheduled. The customer was told.')}
                >
                  {p.job.status === 'scheduled' ? 'Move the job' : 'Schedule the job'}
                </button>
                {p.job.status === 'scheduled' && (
                  <button type="button" class="btn secondary" disabled={busy} onClick={() => void post({ action: 'job_status', status: 'done' }, 'Marked done. Thank-you sent.')}>
                    Job done
                  </button>
                )}
              </div>
              <p class="muted small">
                {p.firstName} gets the date by email{p.smsConsent ? ' and text' : ''}, and a reminder the evening before.
              </p>
            </>
          )}
        </section>
      )}
    </>
  );
}

export const ESTIMATE_LABEL: Record<EstimateInfo['status'], string> = {
  draft: 'Draft',
  sent: 'Waiting on them',
  accepted: 'Said yes',
  declined: 'Said no',
  withdrawn: 'Taken back',
};
