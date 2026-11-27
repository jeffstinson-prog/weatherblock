// The homeowner portal: where a project stands, what the page leads with, how our
// texts read in the customer's thread, and what the owners hear when a customer writes.
import { describe, expect, it } from 'vitest';
import { facts } from '../../src/facts';
import { dayWord, stampLabel, timeLabel } from '../../src/booking/format';
import { progressSteps, showsTracker, stageOf, type ProgressInput } from '../../src/booking/progress';
import { messagePreview, ownerPortalMessageEmail, pushPortalMessage } from '../../src/server/messaging/portal-templates';
import { smsCancelled, smsConfirmation, smsDayBefore, smsMorning, smsRescheduled, type BookingDetails } from '../../src/server/messaging/templates';
import { smsEstimateReady, smsInspected, smsJobMoved, smsJobScheduled } from '../../src/server/messaging/pipeline-templates';

const NOW = Date.parse('2026-12-01T15:00:00Z'); // 10 am Eastern, Tuesday, December 1

const booked: ProgressInput = {
  status: 'booked',
  startsAt: '2026-12-04T13:00:00Z', // Friday 8 am Eastern
  endsAt: '2026-12-04T15:00:00Z',
  bookedAt: '2026-11-27T17:00:00Z',
  estimate: null,
  job: null,
};
const sent = { status: 'sent' as const, sentAt: '2026-12-05T19:00:00Z', decidedAt: null };

const reached = (b: ProgressInput) =>
  progressSteps(b)
    .filter((s) => s.reached)
    .map((s) => s.key);
const current = (b: ProgressInput) => progressSteps(b).find((s) => s.current)?.key;

describe('the tracker', () => {
  it('has six steps in order, with their labels', () => {
    expect(progressSteps(booked).map((s) => s.label)).toEqual(['Booked', 'Inspected', 'Estimate ready', 'Approved', 'Job scheduled', 'Done']);
  });

  it('a booked visit: booked is where things are, with the day it was booked', () => {
    const steps = progressSteps(booked);
    expect(reached(booked)).toEqual(['booked']);
    expect(current(booked)).toBe('booked');
    expect(steps[0]!.at).toBe(booked.bookedAt);
    expect(steps.slice(1).every((s) => s.at === null && !s.current)).toBe(true);
  });

  it('follows the project to a finished roof, each step with its date', () => {
    const inspected = { ...booked, status: 'done' as const };
    expect(current(inspected)).toBe('inspected');
    expect(progressSteps(inspected)[1]!.at).toBe(booked.startsAt);

    const out = { ...inspected, estimate: sent };
    expect(current(out)).toBe('estimate');
    expect(progressSteps(out)[2]!.at).toBe(sent.sentAt);

    const yes = { ...inspected, estimate: { ...sent, status: 'accepted' as const, decidedAt: '2026-12-06T14:00:00Z' }, job: { status: 'to_schedule' as const, day: null, doneAt: null } };
    expect(current(yes)).toBe('approved');
    expect(progressSteps(yes)[3]!.at).toBe('2026-12-06T14:00:00Z');

    const set = { ...yes, job: { status: 'scheduled' as const, day: '2026-12-08', doneAt: null } };
    expect(current(set)).toBe('scheduled');
    expect(progressSteps(set)[4]!.at).toBe('2026-12-08T12:00:00Z');

    const done = { ...yes, job: { status: 'done' as const, day: '2026-12-08', doneAt: '2026-12-08T22:00:00Z' } };
    expect(reached(done)).toEqual(['booked', 'inspected', 'estimate', 'approved', 'scheduled', 'done']);
    expect(current(done)).toBe('done');
    expect(progressSteps(done)[5]!.at).toBe('2026-12-08T22:00:00Z');
  });

  it('a later step means the earlier ones happened, even if nobody marked them', () => {
    const out = { ...booked, estimate: sent }; // the visit was never marked done
    expect(reached(out)).toEqual(['booked', 'inspected', 'estimate']);
    expect(progressSteps(out)[1]!.at).toBe(booked.startsAt);
  });

  it('exactly one step is current', () => {
    for (const b of [booked, { ...booked, status: 'done' as const }, { ...booked, estimate: sent }]) {
      expect(progressSteps(b).filter((s) => s.current)).toHaveLength(1);
    }
  });
});

describe('what the page leads with', () => {
  it('the visit before it happens, then the estimate on its way once the window has passed', () => {
    expect(stageOf(booked, NOW)).toBe('upcoming');
    expect(stageOf(booked, Date.parse('2026-12-04T14:00:00Z'))).toBe('upcoming'); // under way
    expect(stageOf(booked, Date.parse('2026-12-04T15:00:00Z'))).toBe('awaiting_estimate');
    expect(stageOf({ ...booked, status: 'done' }, NOW)).toBe('awaiting_estimate');
  });

  it('the estimate, the answer, then the job', () => {
    const done = { ...booked, status: 'done' as const };
    expect(stageOf({ ...done, estimate: sent }, NOW)).toBe('estimate');
    expect(stageOf({ ...done, estimate: { ...sent, status: 'declined', decidedAt: sent.sentAt } }, NOW)).toBe('declined');
    expect(stageOf({ ...done, estimate: { ...sent, status: 'accepted', decidedAt: sent.sentAt } }, NOW)).toBe('approved');
    const job = (status: 'to_schedule' | 'scheduled' | 'done') => ({ status, day: status === 'to_schedule' ? null : '2026-12-08', doneAt: status === 'done' ? '2026-12-08T22:00:00Z' : null });
    expect(stageOf({ ...done, estimate: sent, job: job('to_schedule') }, NOW)).toBe('approved');
    expect(stageOf({ ...done, estimate: sent, job: job('scheduled') }, NOW)).toBe('scheduled');
    expect(stageOf({ ...done, estimate: sent, job: job('done') }, NOW)).toBe('job_done');
  });

  it('a cancelled or missed visit, and a no thanks, show no tracker', () => {
    expect(stageOf({ ...booked, status: 'cancelled' }, NOW)).toBe('cancelled');
    expect(stageOf({ ...booked, status: 'no_show' }, NOW)).toBe('missed');
    expect(showsTracker('cancelled')).toBe(false);
    expect(showsTracker('missed')).toBe(false);
    expect(showsTracker('declined')).toBe(false);
    expect(showsTracker('upcoming')).toBe(true);
    expect(showsTracker('job_done')).toBe(true);
  });
});

describe('dates on the page', () => {
  it('times and days, in the business time zone', () => {
    expect(timeLabel('2026-12-01T20:15:00Z')).toBe('3:15 pm');
    expect(timeLabel('2026-12-01T17:00:00Z')).toBe('noon');
    expect(timeLabel('2026-12-01T13:00:00Z')).toBe('8 am');
    expect(stampLabel('2026-12-01T13:00:00Z', NOW)).toBe('Today, 8 am');
    expect(stampLabel('2026-11-30T20:15:00Z', NOW)).toBe('Yesterday, 3:15 pm');
    expect(stampLabel('2026-11-27T20:15:00Z', NOW)).toBe('Fri, Nov 27, 3:15 pm');
    expect(dayWord('2026-12-01T22:00:00Z', NOW)).toBe('Today');
    expect(dayWord('2026-12-02T13:00:00Z', NOW)).toBe('Tomorrow');
    expect(dayWord('2026-12-04T13:00:00Z', NOW)).toBe('Fri, Dec 4');
  });
});

const b: BookingDetails = {
  id: '00000000-0000-4000-8000-000000000001',
  ref: 'K7M3QX',
  startsAt: '2026-12-04T13:00:00.000Z',
  endsAt: '2026-12-04T15:00:00.000Z',
  address: '101 Test Beach Dr W, Ocean Isle Beach, NC 28469',
  name: 'Pat Tester',
  mobile: '+19105553001',
  email: 'pat@example.com',
  smsConsent: true,
  relationship: 'owner',
  roofMaterial: 'shingle',
  roofAge: '10-15',
  reason: 'leak',
  notes: '',
  someoneHome: 'no',
  hasGateCode: false,
  pets: '',
  leadSource: 'direct',
  referralCode: '',
  photos: 0,
};
const link = 'https://example.com/b/#' + 'a'.repeat(43);

describe("our texts in the customer's thread", () => {
  it('read without our name, links, our number or the opt-out line', () => {
    expect(messagePreview('sms', null, smsConfirmation(b, link))).toBe("You're booked for Fri, Dec 4, 8 to 10 am. Ref K7M-3QX.");
    expect(messagePreview('sms', null, smsDayBefore(b, link))).toBe("Reminder, we'll be at your home tomorrow between 8 and 10 am.");
    expect(messagePreview('sms', null, smsMorning(b))).toBe('See you today between 8 and 10 am.');
    expect(messagePreview('sms', null, smsRescheduled(b, link))).toBe('Your inspection is now Fri, Dec 4, 8 to 10 am. Ref K7M-3QX.');
    expect(messagePreview('sms', null, smsCancelled(b, 'https://example.com'))).toBe('Your inspection on Fri, Dec 4 is cancelled.');
    expect(messagePreview('sms', null, smsEstimateReady(link, false))).toBe('Your estimate is ready.');
    expect(messagePreview('sms', null, smsJobScheduled('2026-12-08'))).toBe("Your roof job is set for Tue, Dec 8. We'll text you the day before.");
    expect(messagePreview('sms', null, smsJobMoved('2026-12-08', '2026-12-10', true))).toBe('Because of the weather, we moved your roof job from Tue, Dec 8 to Thu, Dec 10.');
    const inspected = messagePreview('sms', null, smsInspected());
    expect(inspected).toMatch(/^Thanks for having us today\. Your estimate will be ready /);
    expect(inspected).not.toMatch(/STOP|https?:/);
  });

  it('an email shows its subject; a message from the page shows in full', () => {
    expect(messagePreview('email', 'Your estimate is ready', 'Hi Pat...')).toBe('Your estimate is ready');
    expect(messagePreview('portal', null, '  Two lines\nof text  ')).toBe('Two lines\nof text');
  });

  it('a text that was only a link still says something', () => {
    expect(messagePreview('sms', null, `${facts.business.name}: To book again: https://example.com/book/`)).toBe('A text with a link to this page.');
  });
});

describe('what the owners hear', () => {
  const c = { id: b.id, name: 'Pat Tester', mobile: '+19105553001', email: 'pat@example.com', address: b.address };
  const words = 'Is the driveway OK for the dumpster?\nWe park two cars there.';

  it('a ping: who, the first 180 characters, and where to tap', () => {
    const ping = pushPortalMessage(c, 'x'.repeat(300));
    expect(ping).toEqual({ title: 'Message from Pat Tester', body: 'x'.repeat(180), url: `/app/#/booking/${b.id}`, tag: `message-${b.id}` });
  });

  it('an email with their words, how to reach them, and the app', () => {
    const email = ownerPortalMessageEmail(c, words, true, 'https://example.com/app/#/booking/1', 'https://example.com');
    expect(email.subject).toBe(`Message from Pat Tester: ${b.address}`);
    expect(email.text).toContain(words);
    expect(email.text).toContain('(910) 555-3001');
    expect(email.text).toContain('Follow-ups about their estimate have stopped.');
    expect(email.html).toContain('Is the driveway OK for the dumpster?<br>We park two cars there.');
    expect(email.html).toContain('Open in the app');
    expect(ownerPortalMessageEmail(c, words, false, 'x', 'y').text).not.toContain('Follow-ups');
  });

  it('escapes what the customer typed in the email', () => {
    const email = ownerPortalMessageEmail(c, '<script>alert(1)</script>', false, 'x', 'https://example.com');
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('uses no em or en dashes', () => {
    const email = ownerPortalMessageEmail(c, words, true, 'x', 'y');
    for (const t of [email.subject, email.text, email.html, pushPortalMessage(c, words).title]) expect(t).not.toMatch(/[–—]/);
  });
});

describe('getting ready for the job day', () => {
  it('says only the lines in facts.yaml, and the working hours only when they are set', async () => {
    const { prepLines } = await import('../../src/booking/portal/NextStep');
    const base = { jobDayPrep: ['Move cars out of the driveway the evening before.', 'Keep pets inside while we work.'], jobHours: '' } as never;
    expect(prepLines(base)).toEqual([
      { icon: 'car', text: 'Move cars out of the driveway the evening before.' },
      { icon: 'paw-print', text: 'Keep pets inside while we work.' },
    ]);
    const withHours = { jobDayPrep: ['We cover your plants.'], jobHours: '7 am to 5 pm' } as never;
    expect(prepLines(withHours)).toEqual([
      { icon: 'trees', text: 'We cover your plants.' },
      { icon: 'volume-2', text: 'Expect noise from 7 am to 5 pm.' },
    ]);
    expect(prepLines({ jobDayPrep: [], jobHours: '' } as never)).toEqual([]);
  });
});
