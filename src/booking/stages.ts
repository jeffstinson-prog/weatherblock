// Where a customer is, from first call to finished roof. The server works it out
// from what happened; the owner app shows it.
export const STAGES = ['new', 'contacted', 'booked', 'inspected', 'estimate_sent', 'won', 'scheduled', 'done', 'lost'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  new: 'New lead',
  contacted: 'Contacted',
  booked: 'Inspection booked',
  inspected: 'Inspected',
  estimate_sent: 'Estimate sent',
  won: 'Won',
  scheduled: 'Job scheduled',
  done: 'Completed',
  lost: 'Lost',
};
/** Short names for the board's columns and the filter. */
export const STAGE_SHORT: Record<Stage, string> = {
  new: 'New',
  contacted: 'Contacted',
  booked: 'Booked',
  inspected: 'Inspected',
  estimate_sent: 'Estimate out',
  won: 'Won',
  scheduled: 'Scheduled',
  done: 'Done',
  lost: 'Lost',
};
