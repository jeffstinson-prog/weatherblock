// Where a lead came from, in words: the website (and what sent them there),
// or the team adding them by hand after a call, a walk-in or a referral.

/** Leads the team adds by hand in the owner app. */
export const MANUAL_SOURCES = ['phone_call', 'walk_in', 'referral', 'door_knock', 'other'] as const;

const SOURCE_LABEL: Record<string, string> = {
  direct: 'Straight to the website',
  assistant: 'Website assistant',
  search: 'Search engines',
  social: 'Social media',
  google_gbp: 'Google Business Profile',
  google_cpc: 'Google ads',
  google_organic: 'Google search',
  facebook: 'Facebook',
  referral: 'Referral',
  phone_call: 'Phone call',
  walk_in: 'Walk-in',
  door_knock: 'Door knock',
  other: 'Other',
};

/** Where a lead came from, in words. */
export function sourceLabel(s: string): string {
  if (SOURCE_LABEL[s]) return SOURCE_LABEL[s]!;
  if (s.startsWith('said_')) return `Said: ${s.slice(5).replace(/_/g, ' ')}`;
  if (s.startsWith('web_')) return `A link on ${s.slice(4)}`;
  if (s.startsWith('ref_')) return 'Referral code';
  return s.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
