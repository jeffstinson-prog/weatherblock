// Estimate requests: the form's checks, and what the owners and the customer hear.
import { afterEach, describe, expect, it } from 'vitest';
import { validateRequest } from '../../src/estimate/rules';
import { facts } from '../../src/facts';
import {
  emailRequestReceived,
  ownerRequestEmail,
  ownerRequestReminderSms,
  ownerRequestSms,
  waited,
  type RequestDetails,
} from '../../src/server/messaging/request-templates';
import type { RoofSheet } from '../../src/server/roofsheet';

const roof: RoofSheet = {
  source: 'google',
  sqft: [2250, 2590],
  squares: [22.5, 26],
  pitch: '6/12',
  imageryDate: '2025-03-10',
  box: null,
  ballpark: [10100, 11700],
};
const r: RequestDetails = {
  id: '00000000-0000-4000-8000-000000000002',
  ref: 'K7M3QX',
  name: 'Pat Tester',
  mobile: '+19105553001',
  email: 'pat@example.com',
  address: '101 Test Beach Dr W, Ocean Isle Beach, NC 28469',
  leadSource: 'google_cpc',
  createdAt: '2026-11-23T15:00:00.000Z',
  roof,
};
const site = 'https://weatherblockroofingnc.com';
const app = `${site}/app/#/request/${r.id}`;
const link = `${site}/estimate/book/#r=${'a'.repeat(43)}`;

describe('estimate request: the form', () => {
  const ok = { address: { text: '101 Test Beach Dr W, Ocean Isle Beach, NC 28469', placeId: 'test-oib-1' }, contact: { name: 'Pat Tester', mobile: '910 555 3001', email: '' } };

  it('needs an address, a name and a mobile number; email is optional', () => {
    expect(validateRequest(ok)).toEqual({});
    expect(validateRequest({ ...ok, contact: { ...ok.contact, email: 'pat@example.com' } })).toEqual({});
  });

  it('says how to fix each problem', () => {
    const errors = validateRequest({ address: { text: '12 Oc' }, contact: { name: ' ', mobile: '555-0142', email: 'pat@' } });
    expect(errors.address).toMatch(/pick it from the list/);
    expect(errors.name).toBe('Enter your name.');
    expect(errors.mobile).toMatch(/10 digit US mobile number/);
    expect(errors.email).toMatch(/name@example.com/);
    expect(validateRequest({ ...ok, address: { text: '12' } }).address).toMatch(/street address/);
  });

  it('takes an address typed by hand', () => {
    expect(validateRequest({ ...ok, address: { text: '12 Nowhere Lane, Supply, NC 28462', typed: true } })).toEqual({});
  });
});

describe('estimate request: what the owners hear', () => {
  it('the text says who, where, the roof and the ballpark, and links to the app', () => {
    expect(ownerRequestSms(r, app)).toBe(
      `Estimate request: Pat Tester, (910) 555-3001. 101 Test Beach Dr W, Ocean Isle Beach, NC 28469. Roof about 22.5 squares (2,250 square feet), 6/12 pitch. Ballpark $10,100 to $11,700. Call them, then open: ${app}`,
    );
  });

  it('says so when the roof was not measured', () => {
    expect(ownerRequestSms({ ...r, roof: null }, app)).toContain('Roof not measured from above.');
  });

  it('the email lists the same, with the imagery date and the size with waste', () => {
    const e = ownerRequestEmail(r, app, site);
    expect(e.subject).toBe('Estimate request: Pat Tester, 101 Test Beach Dr W, Ocean Isle Beach, NC 28469');
    expect(e.text).toContain('Customer: Pat Tester, (910) 555-3001, pat@example.com');
    expect(e.text).toContain("Measured from: Google's aerial imagery, March 2025");
    expect(e.text).toContain('With waste: Up to 26 squares');
    expect(e.text).toContain('Source: google_cpc');
    expect(e.text).toContain('Reference: K7M-3QX');
    expect(e.text).toContain('Promised: A call within one business hour');
    expect(e.text).toContain(`Open in the app: ${app}`);
    expect(e.html).toContain('Open in the app');
  });

  it('the reminder says how long they have waited', () => {
    expect(ownerRequestReminderSms(r, app, 42)).toBe(
      `Still to call: Pat Tester, (910) 555-3001, asked for an estimate 42 minutes ago. They were told: a call within one business hour. ${app}`,
    );
    expect(waited(0.4)).toBe('1 minute');
    expect(waited(200)).toBe('3 hours');
    expect(waited(60 * 30)).toBe('a day');
  });
});

describe('estimate request: what the customer hears', () => {
  const callback = facts.estimate.callback;
  const promise = facts.derived.estimateCallback;
  afterEach(() => {
    facts.estimate.callback = callback;
    facts.derived.estimateCallback = promise;
  });

  it('a copy of the request with no price and nothing about the roof size', () => {
    const e = emailRequestReceived(r, link, site, null);
    expect(e.subject).toBe('We got your estimate request');
    expect(e.text).toContain('Hi Pat, we got your request for a free roof estimate at 101 Test Beach Dr W, Ocean Isle Beach, NC 28469.');
    expect(e.text).toContain('One of us will call you within one business hour at (910) 555-3001 to set it up.');
    expect(e.text).toContain(link);
    for (const body of [e.text, e.html]) {
      expect(body).not.toMatch(/\$\s?\d/);
      expect(body).not.toMatch(/square|pitch|ballpark/i);
    }
  });

  it('says "soon" when the facts file promises no time', () => {
    facts.estimate.callback = '';
    facts.derived.estimateCallback = 'soon';
    expect(emailRequestReceived(r, link, site, null).text).toContain('One of us will call you soon at (910) 555-3001');
  });

  it('carries a ballpark only when one is passed in', () => {
    const e = emailRequestReceived(r, link, site, { low: '$10,100', high: '$11,700', material: 'architectural shingles' });
    expect(e.text).toContain('Your ballpark for a new roof with architectural shingles: $10,100 to $11,700. A rough guide, not a quote.');
  });

  it('uses no em dashes or en dashes, and names the business only through the facts', () => {
    const all = [
      ownerRequestSms(r, app),
      ownerRequestReminderSms(r, app, 42),
      ownerRequestEmail(r, app, site).text,
      ownerRequestEmail(r, app, site).html,
      emailRequestReceived(r, link, site, null).text,
      emailRequestReceived(r, link, site, null).html,
    ];
    for (const m of all) expect(m).not.toMatch(/[–—]/);
    expect(emailRequestReceived(r, link, site, null).html).toContain(facts.business.name);
  });
});
