// The owners' screen: the call-back promise as a time, how long ago, the town, and what their phones show.
import { describe, expect, it } from 'vitest';
import { townOf } from '../../src/booking/format';
import { ago, callBy, promiseLabel } from '../../src/owner/promise';
import * as p from '../../src/server/messaging/push-templates';

// 10:00 am Eastern on a Wednesday in winter (UTC-5).
const at = (iso: string) => Date.parse(iso);

describe('the call-back promise', () => {
  it('daytime: an hour after the request came in', () => {
    expect(callBy('2026-11-25T15:00:00.000Z').toISOString()).toBe('2026-11-25T16:00:00.000Z');
    expect(promiseLabel('2026-11-25T15:00:00.000Z', at('2026-11-25T15:22:00.000Z'))).toEqual({ by: 'Call by 11 am', left: '38 min left', late: false });
    expect(promiseLabel('2026-11-25T15:00:00.000Z', at('2026-11-25T16:12:00.000Z'))).toEqual({ by: 'Call by 11 am', left: '12 min late', late: true });
  });

  it('after 7 pm: by 9 the next morning; before 8 am: by 9 that morning', () => {
    expect(callBy('2026-11-26T01:30:00.000Z').toISOString()).toBe('2026-11-26T14:00:00.000Z'); // 8:30 pm, due 9 am
    expect(callBy('2026-11-26T11:00:00.000Z').toISOString()).toBe('2026-11-26T14:00:00.000Z'); // 6 am, due 9 am
    expect(promiseLabel('2026-11-26T01:30:00.000Z', at('2026-11-26T01:40:00.000Z')).by).toBe('Call by 9 am Thu');
  });

  it('works across the change to daylight time', () => {
    expect(callBy('2027-03-14T02:00:00.000Z').toISOString()).toBe('2027-03-14T13:00:00.000Z'); // 9 pm EST Sat, due 9 am EDT Sun
  });

  it('says how long ago, plainly', () => {
    const now = at('2026-11-25T15:00:00.000Z');
    expect(ago('2026-11-25T14:59:40.000Z', now)).toBe('Just now');
    expect(ago('2026-11-25T14:48:00.000Z', now)).toBe('12 min ago');
    expect(ago('2026-11-25T12:00:00.000Z', now)).toBe('3 hr ago');
    expect(ago('2026-11-24T12:00:00.000Z', now)).toBe('Yesterday');
  });
});

describe('the town, for short lists', () => {
  it('is the part before the state', () => {
    expect(townOf('12 Ocean Blvd W, Holden Beach, NC 28462')).toBe('Holden Beach');
    expect(townOf('111 Causeway Dr, Ocean Isle Beach, NC 28469')).toBe('Ocean Isle Beach');
    expect(townOf('Somewhere typed by hand')).toBe('Somewhere typed by hand');
  });
});

describe("what the owners' phones show", () => {
  const visit = { id: 'b1', name: 'Dana Whitley', startsAt: '2026-11-27T13:00:00.000Z', endsAt: '2026-11-27T15:00:00.000Z', address: '12 Ocean Blvd W, Holden Beach, NC 28462' };
  const all = [
    p.pushNewBooking(visit),
    p.pushBookingChanged('rescheduled', visit),
    p.pushBookingChanged('cancelled', visit),
    p.pushNewRequest({ id: 'r1', name: 'Robert Hayes', mobile: '+19105550131', address: '77 Cedar Ln, Supply, NC 28462' }),
    p.pushRequestReminder({ id: 'r1', name: 'Robert Hayes', mobile: '+19105550131' }, 42),
    p.pushTextIn('Dana Whitley (910) 555-0121', 'Running late, gate is open', 'b1'),
    p.pushEstimateAnswer('accepted', { id: 'b1', name: 'Dana Whitley' }, 1240000, ''),
    p.pushEstimateAnswer('question', { id: 'b1', name: 'Dana Whitley' }, null, 'Does it include gutters?'),
  ];

  it('who, when and where, and opens that customer', () => {
    expect(all[0]).toEqual({ title: 'New inspection booked', body: 'Dana Whitley, Fri, Nov 27, 8 to 10 am. Holden Beach.', url: '/app/#/booking/b1', tag: 'booking-b1' });
    expect(all[3]!.body).toBe('Robert Hayes, Supply. Call (910) 555-0131. They were told: a call within one business hour.');
    expect(all[3]!.url).toBe('/app/#/request/r1');
    expect(all[4]!.body).toBe('Robert Hayes asked for an estimate 42 minutes ago. (910) 555-0131.');
    expect(all[6]!.body).toBe('Dana Whitley said yes to the estimate of $12,400. Time to schedule the job.');
  });

  it('uses no em dashes or en dashes, and stays short for a lock screen', () => {
    for (const m of all) {
      expect(`${m.title} ${m.body}`).not.toMatch(/[–—]/);
      expect(m.body.length).toBeLessThan(200);
      expect(m.url.startsWith('/app/')).toBe(true);
    }
  });
});
