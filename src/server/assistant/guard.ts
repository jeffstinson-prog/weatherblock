// The house rules, checked in code on every assistant reply (and, in tests,
// on every page of the site). A reply that breaks one is never shown.
//
//   price           no prices except facts.prices (sourced grant amounts are fine)
//   insurance       never promise or suggest insurance will pay
//   claims          never say we file, handle or negotiate claims
//   deductible      never offer to cover or waive a deductible
//   credential      no license, insurance, bond, certification or warranty claim unless in facts
//   rating          no ratings or review counts except the ones in facts
//   years           no "years in business" claims
//   human           never claim to be a person
//   booked          never say a time is open or that someone is booked
//   number          phone numbers, links and percentages must come from what we know
import { facts, has } from '../../facts';

export interface Allowed {
  amounts: Set<number>;
  phones: Set<string>;
  hosts: Set<string>;
  percents: Set<string>;
}

export interface Violation {
  rule: string;
  sentence: string;
}

const NEGATION =
  /\b(no|not|never|don'?t|do not|doesn'?t|does not|didn'?t|can'?t|cannot|can not|won'?t|will not|isn'?t|is not|aren'?t|are not|wasn'?t|nobody|neither|nor|without|unable|only (?:your|the) insurance company)\b/i;
const IN_PROGRESS = /\b(working on|not yet|in progress|isn'?t done|until we have)\b/i;

export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?:])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const WE =
  /\b(we|we're|we are|we've|we have|we'll|our (?:company|team|crew|crews|roofers|business|work|installers?))\b/i;

function aboutUs(s: string): boolean {
  const name = facts.business.name.toLowerCase();
  return WE.test(s) || s.toLowerCase().includes(name) || /^(licensed|insured|bonded|certified|fully insured)\b/i.test(s);
}

const n = (v: string) => Number(v.replace(/,/g, ''));

type Check = (s: string, allowed: Allowed) => boolean;

const CHECKS: Record<string, Check> = {
  price: (s, a) => {
    const amounts = [...s.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s*(k|thousand)?/gi)];
    for (const m of amounts) {
      const value = n(m[1]!) * (m[2] ? 1000 : 1);
      if (!a.amounts.has(value)) return true;
    }
    if (/\b\d[\d,]*\s*(dollars|bucks)\b/i.test(s)) return true;
    // A number per square is a price. It passes only as a dollar amount from the facts (checked above).
    if (/\bper (square|sq\.? ?ft|square foot)\b/i.test(s) && /\d/.test(s) && amounts.length === 0) return true;
    return false;
  },

  insurance: (s) => {
    if (NEGATION.test(s)) return false;
    return (
      /\b(insurance|insurer|your policy|the policy|your carrier|insurance company|they)\b.{0,50}\b(will|would|should|is going to|are going to|'ll|usually|typically|generally|often|normally|always|probably|likely)\b.{0,25}\b(pay|pays|cover|covers|replace|approve|reimburse)/i.test(s) ||
      /\bcovered by (your |the )?(insurance|policy|insurer)\b/i.test(s) ||
      /\b(insurance|insurer) (pays|covers) (for )?(it|this|that|storm|wind|hail|the|your|a new)\b/i.test(s) ||
      /\b(get|getting) (you )?a (new|free) roof\b/i.test(s)
    );
  },

  claims: (s) => {
    if (NEGATION.test(s)) return false;
    return (
      /\b(we|we'll|we will|we can|we'd|i can|i'll|i will|our team|our company)\b.{0,40}\b(file|handle|manage|submit|process|negotiate|settle|fight|argue|deal with|take care of|work with)\b.{0,40}\b(claims?|adjusters?|insurance compan(y|ies)|insurers?|your insurance)\b/i.test(s) ||
      /\b(we|i|our team)\b.{0,30}\b(meet|talk|speak)\b.{0,20}\badjusters?\b/i.test(s) ||
      /\bon your behalf\b/i.test(s)
    );
  },

  deductible: (s) => {
    if (NEGATION.test(s)) return false;
    return (
      /\b(cover|waive|pay|absorb|eat|rebate|refund|discount|credit|reduce|help (you )?with|take care of)\b.{0,30}\bdeductibles?\b/i.test(s) ||
      /\bdeductibles?\s+(is |will be |gets |can be )?(waived|covered|free|taken care of|on us)\b/i.test(s) ||
      // "A free roof" is the storm chaser's promise. A free roof inspection or estimate is not.
      /\bfree (new )?roof\b(?!\s+(inspection|estimate))/i.test(s)
    );
  },

  credential: (s) => {
    if (NEGATION.test(s) || IN_PROGRESS.test(s) || !aboutUs(s)) return false;
    if (/\b(licensed|license)\b/i.test(s) && !has('credentials.license.number')) return true;
    if (/\b(fully insured|insured|bonded|liability insurance|workers'? comp)/i.test(s) && !has('credentials.insurance.liability')) return true;
    if (/\b(warrant(y|ies|ied)|guarantee[sd]?|lifetime)\b/i.test(s) && !has('credentials.warranty.workmanship')) return true;
    if (/\b(certified|certification|accredited|preferred (contractor|installer)|master elite|platinum|award[- ]winning|factory[- ]trained|approved (contractor|installer))\b/i.test(s)) {
      const known = facts.credentials.certifications.some((c) => s.toLowerCase().includes(c.toLowerCase()));
      return !known;
    }
    if (/\b(gaf|owens corning|certainteed|iko|atlas|malarkey|tamko)\b/i.test(s) && facts.credentials.certifications.length === 0) return true;
    return false;
  },

  rating: (s) => {
    const g = facts.reviews.google;
    for (const m of s.matchAll(/\b([0-5](?:\.\d)?)[ -]?stars?\b/gi)) {
      if (g.rating === null || Number(m[1]) !== g.rating) return true;
    }
    for (const m of s.matchAll(/\b(\d+)\s+(?:google |online |five[- ]star |5[- ]star )?(reviews|ratings)\b/gi)) {
      if (g.count === null || Number(m[1]) !== g.count) return true;
    }
    if (NEGATION.test(s)) return false;
    return /(\bA\+|\bBBB\b|\btop[- ]rated\b|\bbest[- ]rated\b|#1\b|\bnumber one\b|\bhighest[- ]rated\b)/i.test(s);
  },

  years: (s) => {
    if (NEGATION.test(s)) return false;
    return (
      /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty)\+?\s+years?\b.{0,30}\b(experience|in business|serving|of service)\b/i.test(s) ||
      /\b(in business|serving \w+) since (19|20)\d{2}\b/i.test(s)
    );
  },

  human: (s) => {
    if (NEGATION.test(s)) return false;
    return /\b(i am|i'm)\s+(a\s+)?(real\s+)?(human|person|man|woman|justin|jt|the owner|an owner|an employee|a roofer|staff)\b/i.test(s);
  },

  booked: (s) => {
    if (NEGATION.test(s)) return false;
    return (
      /\b(you're|you are) (all )?(booked|scheduled|confirmed)\b/i.test(s) ||
      /\bi(?: have|'ve)? (booked|scheduled|reserved|put you down)\b/i.test(s) ||
      /\b(we have|there is|there's|there are)\b.{0,15}\b(an )?(opening|openings|availability|slot|slots)\b/i.test(s)
    );
  },

  number: (s, a) => {
    for (const m of s.matchAll(/(?:\+?1[\s.-]?)?\(?\b(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/g)) {
      if (!a.phones.has(`${m[1]}${m[2]}${m[3]}`)) return true;
    }
    for (const m of s.matchAll(/\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+(?:com|org|net|gov|io|co|us))\b/gi)) {
      const host = m[1]!.toLowerCase();
      if (![...a.hosts].some((h) => host === h || host.endsWith(`.${h}`) || h.endsWith(`.${host}`))) return true;
    }
    for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s?%/g)) {
      if (!a.percents.has(m[1]!)) return true;
    }
    return false;
  },
};

// Rules that only make sense for the assistant: it can't book, so it must never
// say someone is booked. (Our confirmation messages say exactly that, rightly.)
const ASSISTANT_ONLY = new Set(['booked']);

export function check(text: string, allowed: Allowed, who: 'assistant' | 'site' = 'assistant'): Violation[] {
  const out: Violation[] = [];
  for (const sentence of sentences(text)) {
    for (const [rule, fn] of Object.entries(CHECKS)) {
      if (who === 'site' && ASSISTANT_ONLY.has(rule)) continue;
      // A question claims nothing ("Will you cover my deductible?"), so only the number check applies.
      if (sentence.endsWith('?') && rule !== 'number') continue;
      if (fn(sentence, allowed)) out.push({ rule, sentence });
    }
  }
  if (/[\u2013\u2014]/.test(text)) out.push({ rule: 'dash', sentence: text.slice(0, 120) });
  return out;
}
