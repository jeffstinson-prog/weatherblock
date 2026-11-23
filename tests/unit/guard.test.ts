// Trying to break each house rule. Every "breaks" line must be caught;
// every "fine" line (often the same words, said honestly) must get through.
import { describe, expect, it } from 'vitest';
import { check } from '../../src/server/assistant/guard';
import { allowedFromKnowledge, knowledgeText, systemPrompt } from '../../src/server/assistant/knowledge';
import { helpArticles } from '../../src/help/load';
import {
  emailConfirmation,
  ownerSms,
  smsCancelled,
  smsConfirmation,
  smsDayBefore,
  smsMorning,
  smsOnMyWay,
  smsRescheduled,
  type BookingDetails,
} from '../../src/server/messaging/templates';

const allowed = allowedFromKnowledge();
const rules = (text: string) => check(text, allowed).map((v) => v.rule);

const BREAKS: Record<string, string[]> = {
  price: [
    'A new roof usually runs about $12,000.',
    'Repairs start at 500 dollars.',
    'Most jobs come in around $8k.',
    'We charge 350 per square.',
  ],
  insurance: [
    'Your insurance will pay for storm damage.',
    'Insurance usually covers hail damage.',
    'That should be covered by your insurance.',
    'They will likely approve it.',
    'We can get you a new roof through your claim.',
  ],
  claims: [
    "We'll file the claim for you.",
    'We handle the insurance company so you do not have to deal with it.'.replace('do not have to ', ''),
    'Our team will meet with your adjuster.',
    'We work with your insurance on your behalf.',
  ],
  deductible: ['We can cover your deductible.', "We'll help with your deductible.", 'Your deductible can be waived.', 'Ask about a free roof.'],
  credential: [
    "We're licensed and insured.",
    'WeatherBlock Roofing is fully insured.',
    'Licensed and insured.',
    'Our work comes with a lifetime warranty.',
    'We are GAF certified.',
    "We're a FORTIFIED certified contractor.",
  ],
  rating: ['We have 4.9 stars.', 'We have over 200 reviews.', "We're A+ rated with the BBB.", "We're the top-rated roofer in town."],
  years: ['We have 20 years of experience.', 'Proudly in business since 1998.'],
  human: ["I'm Justin, the owner.", 'I am a real person.'],
  booked: ["You're booked for Tuesday.", "I've scheduled you for 9 am.", 'We have an opening tomorrow at 10.'],
  number: ['Call us at 910-555-1234.', 'Check roofdeals.com for coupons.', 'The schedule pays 80% on a new roof.'],
  dash: ['We inspect by drone — no foot traffic.'],
};

const FINE = [
  'The inspection is free.',
  "We can't promise what insurance will pay.",
  'Only your insurance company decides what it pays.',
  "We don't file, handle or negotiate claims.",
  'We never cover, waive, rebate or discount an insurance deductible.',
  "We're working on our FORTIFIED certification.",
  'Call or text (910) 209-5275.',
  'Strengthen Your Roof pays up to $10,000 for homes between the Intracoastal Waterway and the ocean.',
  'Roofs under 5 years old are paid at 100%.',
  'We had a 5.0 star rating from 11 reviews as of November 19, 2026.',
  "I don't have our license number on file, so call us.",
  "I'm an automated assistant, not a person.",
  'In North Carolina, someone you pay to negotiate a claim for you has to be a licensed public adjuster, or a lawyer.',
  'Acorn Finance is not a lender. The lender sets approval, rates and terms.',
  'You can book online at weatherblockroofingnc.com/book/ in about a minute.',
  'You file the claim and settle it with your insurance company.',
  'Your deductible is the part of a covered claim you pay, under your own policy.',
  'The booking page shows the open times.',
  'Will you cover or waive my deductible?',
  'Book a free roof inspection online in about a minute.',
  'Ask for a free roof estimate and one of us calls you to set it up.',
];

describe('the rule check catches every way to break a rule', () => {
  for (const [rule, lines] of Object.entries(BREAKS)) {
    for (const line of lines) {
      it(`${rule}: "${line}"`, () => {
        expect(rules(line)).toContain(rule);
      });
    }
  }
});

describe('the rule check lets honest answers through', () => {
  for (const line of FINE) {
    it(`"${line}"`, () => {
      expect(check(line, allowed)).toEqual([]);
    });
  }
});

describe('the whole site keeps the rules', () => {
  it('every help center answer passes', () => {
    const problems = helpArticles.flatMap((a) => check(a.text, allowed, 'site').map((v) => `${a.slug}: [${v.rule}] ${v.sentence}`));
    expect(problems).toEqual([]);
  });

  it('every text and email we send passes', () => {
    const b: BookingDetails = {
      id: 'x', ref: 'K7M3QX', startsAt: '2026-11-20T13:00:00.000Z', endsAt: '2026-11-20T15:00:00.000Z',
      address: '101 Test Beach Dr W, Ocean Isle Beach, NC 28469', name: 'Pat Tester', mobile: '+19102095275',
      email: 'pat@example.com', smsConsent: true, relationship: 'owner', roofMaterial: 'shingle', roofAge: '10-15',
      reason: 'leak', notes: '', someoneHome: 'no', hasGateCode: false, pets: '', leadSource: 'direct', referralCode: '', photos: 0,
    };
    const link = 'https://weatherblockroofingnc.com/b/#' + 'a'.repeat(43);
    const texts = [
      smsConfirmation(b, link), smsDayBefore(b, link), smsMorning(b), smsOnMyWay('Justin', 20), smsRescheduled(b, link),
      smsCancelled(b, 'https://weatherblockroofingnc.com'), ownerSms('new', b, 'https://weatherblockroofingnc.com/app/'),
      emailConfirmation(b, link, 'https://weatherblockroofingnc.com').text,
    ];
    const problems = texts.flatMap((t) => check(t, allowed, 'site').map((v) => `[${v.rule}] ${v.sentence}`));
    expect(problems).toEqual([]);
  });
});

describe('what the assistant is told', () => {
  const prompt = systemPrompt();
  it('includes the facts we have and none we left blank', () => {
    expect(prompt).toContain('(910) 209-5275');
    expect(prompt).toContain('Inspection cost: free');
    expect(prompt).not.toMatch(/License: /);
    expect(prompt).toContain('license number (do not say whether we are licensed)');
    expect(prompt).toContain('FORTIFIED: working on certification, not certified yet');
  });
  it('includes every published help answer and its sources', () => {
    for (const a of helpArticles) expect(prompt).toContain(`[help:${a.slug}]`);
    expect(knowledgeText()).toContain('P-25-3');
  });
  it('states every rule', () => {
    for (const phrase of ['No prices', 'Never promise', 'Never say we file', 'Never offer to cover', 'Never claim a license', 'You are automated']) {
      expect(prompt).toContain(phrase);
    }
  });
  it('uses no em or en dashes', () => {
    expect(prompt).not.toMatch(/[–—]/);
  });
});
