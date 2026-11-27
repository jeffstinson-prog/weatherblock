// Where a customer's project stands, for their private page: six steps from
// booking to a finished roof, and the stage that decides what the page says
// happens next. Worked out on the phone from what the server already sends.

export interface ProgressInput {
  status: 'booked' | 'done' | 'cancelled' | 'no_show';
  startsAt: string;
  endsAt: string;
  /** When they booked. */
  bookedAt: string;
  estimate: { status: 'sent' | 'accepted' | 'declined'; sentAt: string; decidedAt: string | null } | null;
  job: { status: 'to_schedule' | 'scheduled' | 'done'; day: string | null; doneAt: string | null } | null;
}

export type StepKey = 'booked' | 'inspected' | 'estimate' | 'approved' | 'scheduled' | 'done';

export interface Step {
  key: StepKey;
  label: string;
  reached: boolean;
  /** The step the project is on now: the last one reached. */
  current: boolean;
  /** When it happened (for a scheduled job, its day). Only for steps reached. */
  at: string | null;
}

export const STEP_LABELS: Record<StepKey, string> = {
  booked: 'Booked',
  inspected: 'Inspected',
  estimate: 'Estimate ready',
  approved: 'Approved',
  scheduled: 'Job scheduled',
  done: 'Done',
};

/** A job's day (2026-12-08) as a moment on that day, so it formats as the same day anywhere. */
const onDay = (day: string | null) => (day ? `${day}T12:00:00Z` : null);

export function progressSteps(b: ProgressInput): Step[] {
  const e = b.estimate;
  const j = b.job;
  const steps: [StepKey, boolean, string | null][] = [
    ['booked', true, b.bookedAt || null],
    ['inspected', b.status === 'done', b.startsAt],
    ['estimate', Boolean(e), e?.sentAt ?? null],
    ['approved', e?.status === 'accepted' || Boolean(j), e?.status === 'accepted' ? e.decidedAt : null],
    ['scheduled', j?.status === 'scheduled' || j?.status === 'done', onDay(j?.day ?? null)],
    ['done', j?.status === 'done', j?.doneAt ?? null],
  ];
  // A later step means the earlier ones happened, even when nobody marked them.
  let last = 0;
  steps.forEach(([, reached], i) => {
    if (reached) last = i;
  });
  return steps.map(([key, , at], i) => ({ key, label: STEP_LABELS[key], reached: i <= last, current: i === last, at: i <= last ? at : null }));
}

/**
 * What the page leads with.
 *   upcoming           the inspection is ahead (or under way)
 *   awaiting_estimate  the visit is over; the estimate is being written
 *   estimate           the estimate is out and waits for their answer
 *   declined           they said no thanks
 *   approved           they said yes; a day for the job comes next
 *   scheduled          the job has a day
 *   job_done           the roof is done
 *   cancelled, missed  the visit was cancelled, or didn't happen
 */
export type Stage = 'upcoming' | 'awaiting_estimate' | 'estimate' | 'declined' | 'approved' | 'scheduled' | 'job_done' | 'cancelled' | 'missed';

export function stageOf(b: ProgressInput, now = Date.now()): Stage {
  const e = b.estimate;
  const j = b.job;
  if (j?.status === 'done') return 'job_done';
  if (j?.status === 'scheduled') return 'scheduled';
  if (j || e?.status === 'accepted') return 'approved';
  if (e?.status === 'declined') return 'declined';
  if (e?.status === 'sent') return 'estimate';
  if (b.status === 'cancelled') return 'cancelled';
  if (b.status === 'no_show') return 'missed';
  if (b.status === 'done' || Date.parse(b.endsAt) <= now) return 'awaiting_estimate';
  return 'upcoming';
}

/** Progress toward a finished roof. A cancelled visit, a missed one or a no thanks has none to show. */
export const showsTracker = (stage: Stage): boolean => !['cancelled', 'missed', 'declined'].includes(stage);
