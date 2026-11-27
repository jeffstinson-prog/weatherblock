// The one place the site reads facts from. Everything else imports from here.
import raw from '../../facts.yaml?raw';
import { makeHas, parseFacts } from './parse';

export const facts = parseFacts(raw);
export const has = makeHas(facts);
export type { Facts } from './schema';
export { applyFacts, fill, formatDate, getPath, isBlank, isOn } from './template';

/** "© 2026 <legal name>", from facts.yaml */
export function copyrightLine(year = new Date().getFullYear()): string {
  const holder = facts.business.legalName || facts.business.name;
  return `© ${year} ${holder}`;
}

/** Plain phone link, e.g. tel:+19104441849 */
export function telHref(): string {
  return facts.contact.phoneE164 ? `tel:${facts.contact.phoneE164}` : '';
}

export function smsHref(): string {
  return facts.contact.phoneE164 && facts.contact.takesTexts ? `sms:${facts.contact.phoneE164}` : '';
}

/**
 * Search engines are allowed in only after launch (facts.web.launched).
 * FORCE_INDEXABLE=1 is for the Lighthouse SEO check in CI and never set on Netlify.
 */
export const indexable = (): boolean => facts.web.launched || process.env.FORCE_INDEXABLE === '1';

/** True when it's fine to say the business is licensed. */
export const canClaimLicense = (): boolean => has('credentials.license.number');
export const canClaimInsured = (): boolean => has('credentials.insurance.liability');
