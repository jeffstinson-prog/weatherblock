import { describe, expect, it } from 'vitest';
import { dueKind, local } from '../../src/server/reminders';
import { twilioSignature, validTwilioSignature } from '../../src/server/messaging/inbound';
import {
  emailConfirmation,
  emailOwner,
  ownerSms,
  smsCancelled,
  smsConfirmation,
  smsDayBefore,
  smsMorning,
  smsOnMyWay,
  smsRescheduled,
  type BookingDetails,
} from '../../src/server/messaging/templates';

const b: BookingDetails = {
  id: '00000000-0000-4000-8000-000000000001',
  ref: 'K7M3QX',
  startsAt: '2026-11-20T13:00:00.000Z', // 8 am Eastern
  endsAt: '2026-11-20T15:00:00.000Z',
  address: '101 Test Beach Dr W, Ocean Isle Beach, NC 28469',
  name: 'Pat Tester',
  mobile: '+19105553001',
  email: 'pat@example.com',
  smsConsent: true,
  relationship: 'owner',
  roofMaterial: 'shingle',
  roofAge: '10-15',
  reason: 'leak',
  notes: 'Stain in the kitchen',
  someoneHome: 'no',
  hasGateCode: true,
  pets: '',
  leadSource: 'google_gbp',
  referralCode: '',
  photos: 2,
};
const link = 'https://weatherblockroofingnc.com/b/#' + 'a'.repeat(43);
const site = 'https://weatherblockroofingnc.com';

describe('message wording', () => {
  const all = [
    smsConfirmation(b, link),
    smsDayBefore(b, link),
    smsMorning(b),
    smsOnMyWay('Justin', 20),
    smsRescheduled(b, link),
    smsCancelled(b, site),
    ownerSms('new', b, `${site}/app/`),
    ownerSms('rescheduled', b, `${site}/app/`, '2026-11-19T13:00:00.000Z'),
    emailConfirmation(b, link, site).text,
    emailConfirmation(b, link, site).html,
    emailOwner('new', b, `${site}/app/`, site).text,
  ];

  it('uses no em or en dashes', () => {
    for (const m of all) expect(m).not.toMatch(/[–—]/);
  });

  it('says the time in plain words, in Eastern time', () => {
    expect(smsConfirmation(b, link)).toContain('Fri, Nov 20, 8 to 10 am');
    expect(smsDayBefore(b, link)).toContain('between 8 and 10 am');
    expect(ownerSms('rescheduled', b, `${site}/app/`, '2026-11-19T13:00:00.000Z')).toContain('was Thu, Nov 19, 8 to 10 am');
  });

  it('the confirmation text says how to stop texts, and keeps the reference readable', () => {
    const t = smsConfirmation(b, link);
    expect(t).toContain('Reply STOP to opt out');
    expect(t).toContain('Ref K7M-3QX');
    expect(t.length).toBeLessThan(320);
  });

  it('every customer text names the business first', () => {
    for (const t of [smsConfirmation(b, link), smsDayBefore(b, link), smsMorning(b), smsRescheduled(b, link), smsCancelled(b, site)]) {
      expect(t.startsWith('WeatherBlock Roofing:')).toBe(true);
    }
  });

  it('the confirmation email carries a calendar file and the private link', () => {
    const e = emailConfirmation(b, link, site);
    expect(e.attachments?.[0]?.filename).toBe('roof-inspection.ics');
    const ics = Buffer.from(e.attachments![0]!.content, 'base64').toString();
    expect(ics).toContain('DTSTART:20261120T130000Z');
    expect(e.html).toContain(link);
    expect(e.subject).toBe('Your roof inspection: Fri, Nov 20, 8 to 10 am');
  });

  it('the owner email never prints the gate code itself', () => {
    const e = emailOwner('new', b, `${site}/app/`, site);
    expect(e.text).toContain('Gate code: Yes, in the app');
  });

  it('escapes anything a customer typed before it goes into an email', () => {
    const e = emailOwner('new', { ...b, notes: '<script>alert(1)</script>' }, `${site}/app/`, site);
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('&lt;script&gt;');
  });
});

describe('when reminders go out (Eastern time)', () => {
  const start = new Date('2026-11-20T13:00:00Z'); // Fri 8 am EST
  it('evening before, from 6 pm to 9 pm', () => {
    expect(dueKind(start, new Date('2026-11-19T22:59:00Z'))).toBeNull(); // 5:59 pm
    expect(dueKind(start, new Date('2026-11-19T23:00:00Z'))).toBe('remind_eve'); // 6:00 pm
    expect(dueKind(start, new Date('2026-11-20T01:59:00Z'))).toBe('remind_eve'); // 8:59 pm
    expect(dueKind(start, new Date('2026-11-20T02:00:00Z'))).toBeNull(); // 9:00 pm
  });
  it('morning of, from 7:30 am, and not within 30 minutes of the window', () => {
    expect(dueKind(start, new Date('2026-11-20T12:29:00Z'))).toBeNull(); // 7:29 am
    expect(dueKind(new Date('2026-11-20T19:00:00Z'), new Date('2026-11-20T12:30:00Z'))).toBe('remind_morn'); // 2 pm window, 7:30 am
    expect(dueKind(start, new Date('2026-11-20T12:31:00Z'))).toBeNull(); // 8 am window, 29 minutes out
  });
  it('handles daylight saving time', () => {
    // June: Eastern is UTC-4. 8 am EDT window, reminder at 6 pm EDT the day before.
    expect(dueKind(new Date('2027-06-02T12:00:00Z'), new Date('2027-06-01T22:00:00Z'))).toBe('remind_eve');
    expect(local(new Date('2027-06-01T22:00:00Z'))).toEqual({ date: '2027-06-01', minutes: 18 * 60 });
  });
});

describe('Twilio webhook signature', () => {
  const url = 'https://weatherblockroofingnc.com/api/twilio/sms';
  const params = { From: '+19105553001', To: '+19105550000', Body: 'Running late?', MessageSid: 'SM123' };
  it('accepts a correct signature and rejects a changed message', () => {
    const sig = twilioSignature('secret-token', url, params);
    expect(validTwilioSignature('secret-token', url, params, sig)).toBe(true);
    expect(validTwilioSignature('secret-token', url, { ...params, Body: 'Changed' }, sig)).toBe(false);
    expect(validTwilioSignature('other-token', url, params, sig)).toBe(false);
  });
});
