// The booking form's choices and checks, shared by the page and the server so
// they always agree. Every error says how to fix it.

export const RELATIONSHIPS = [
  { value: 'owner', label: "It's my home" },
  { value: 'renter', label: 'I rent it' },
  { value: 'property_manager', label: 'I manage it' },
  { value: 'agent', label: "I'm the real estate agent" },
  { value: 'buyer', label: "I'm buying it" },
  { value: 'family', label: "A family member's" },
  { value: 'other', label: 'Something else' },
] as const;

export const MATERIALS = [
  { value: 'shingle', label: 'Shingles' },
  { value: 'metal', label: 'Metal' },
  { value: 'tile', label: 'Tile' },
  { value: 'flat', label: 'Flat or low slope' },
  { value: 'other', label: 'Something else' },
  { value: 'unknown', label: 'Not sure' },
] as const;

export const AGES = [
  { value: '0-5', label: 'Under 5 years' },
  { value: '5-10', label: '5 to 10 years' },
  { value: '10-15', label: '10 to 15 years' },
  { value: '15-20', label: '15 to 20 years' },
  { value: '20+', label: 'Over 20 years' },
  { value: 'unknown', label: 'Not sure' },
] as const;

export const REASONS = [
  { value: 'leak', label: 'A leak' },
  { value: 'storm', label: 'Storm damage' },
  { value: 'damage', label: 'Missing or damaged shingles' },
  { value: 'replace', label: 'Thinking about a new roof' },
  { value: 'sale', label: 'Buying or selling' },
  { value: 'insurance', label: 'My insurance company asked' },
  { value: 'checkup', label: 'A checkup' },
  { value: 'other', label: 'Something else' },
] as const;

export const SOMEONE_HOME = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'not_sure', label: 'Not sure' },
] as const;

export const HEARD_ABOUT = [
  { value: '', label: 'Choose one (optional)' },
  { value: 'google', label: 'Google' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'nextdoor', label: 'Nextdoor' },
  { value: 'yelp', label: 'Yelp' },
  { value: 'thumbtack', label: 'Thumbtack' },
  { value: 'friend', label: 'A friend or neighbor' },
  { value: 'agent', label: 'A real estate agent' },
  { value: 'property_manager', label: 'A property manager' },
  { value: 'truck_or_sign', label: 'Our truck or a yard sign' },
  { value: 'repeat', label: "We've worked together before" },
  { value: 'other', label: 'Something else' },
] as const;

type Values<T extends readonly { value: string }[]> = T[number]['value'];
export type Relationship = Values<typeof RELATIONSHIPS>;
export type Material = Values<typeof MATERIALS>;
export type Age = Values<typeof AGES>;
export type Reason = Values<typeof REASONS>;
export type SomeoneHome = Values<typeof SOMEONE_HOME>;

export const labelOf = (list: readonly { value: string; label: string }[], value: string | undefined): string =>
  list.find((o) => o.value === value)?.label ?? '';

export const isOneOf = (list: readonly { value: string }[], value: unknown): boolean =>
  typeof value === 'string' && value !== '' && list.some((o) => o.value === value);

/** "910 555 0123", "(910) 555-0123", "+1 910..." to "+19105550123". Null if it isn't a US mobile-shaped number. */
export function normalizeMobile(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null;
  return `+1${ten}`;
}

export function formatMobile(e164: string): string {
  const d = e164.replace(/^\+1/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}

export function isEmail(input: string): boolean {
  const v = input.trim();
  return v.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v);
}

export const REFERRAL_CODE = /^[A-Z0-9]{2,20}$/;

export interface Draft {
  draftKey: string;
  startedAt: number;
  address: {
    text: string;
    placeId?: string;
    lat?: number;
    lng?: number;
    county?: string;
    city?: string;
    zip?: string;
    state?: string;
    inArea?: boolean;
    /** True when the person chose to use the address as typed. */
    typed?: boolean;
  };
  relationship: string;
  roof: { material: string; age: string; reason: string; notes: string };
  photos: { id: string; thumb: string }[];
  slot: { id: string; startsAt: string; endsAt: string } | null;
  visit: { someoneHome: string; gateCode: string; pets: string };
  contact: { name: string; mobile: string; email: string; smsConsent: boolean };
  source: {
    heardAbout: string;
    referralCode: string;
    utm: Record<string, string>;
    viaAssistant: boolean;
  };
}

export type Errors = Record<string, string>;

export const MESSAGES = {
  addressPick: 'Start typing your address, then pick it from the list. If it isn\'t listed, tap "Use the address I typed".',
  addressShort: 'Enter the street address, like 12 Ocean Blvd, Ocean Isle Beach.',
  relationship: 'Choose whose home this is.',
  material: 'Choose what the roof is made of. "Not sure" is fine.',
  age: 'Choose about how old the roof is. "Not sure" is fine.',
  reason: 'Choose why you want the inspection.',
  slot: 'Choose a day and a time window.',
  someoneHome: 'Tell us if someone will be home. "Not sure" is fine.',
  name: 'Enter your name.',
  mobile: 'Enter a 10 digit US mobile number, like 910 555 0123.',
  email: 'Enter an email address, like name@example.com.',
  referral: 'Referral codes are letters and numbers only, like SMITH24. Leave it blank if you don\'t have one.',
} as const;

export function validateAddress(d: Pick<Draft, 'address' | 'relationship'>): Errors {
  const e: Errors = {};
  if (d.address.text.trim().length < 5) e.address = MESSAGES.addressShort;
  else if (!d.address.placeId && !d.address.typed) e.address = MESSAGES.addressPick;
  if (!isOneOf(RELATIONSHIPS, d.relationship)) e.relationship = MESSAGES.relationship;
  return e;
}

export function validateRoof(d: Pick<Draft, 'roof'>): Errors {
  const e: Errors = {};
  if (!isOneOf(MATERIALS, d.roof.material)) e.material = MESSAGES.material;
  if (!isOneOf(AGES, d.roof.age)) e.age = MESSAGES.age;
  if (!isOneOf(REASONS, d.roof.reason)) e.reason = MESSAGES.reason;
  return e;
}

export function validateTime(d: Pick<Draft, 'slot' | 'visit'>): Errors {
  const e: Errors = {};
  if (!d.slot) e.slot = MESSAGES.slot;
  if (!isOneOf(SOMEONE_HOME, d.visit.someoneHome)) e.someoneHome = MESSAGES.someoneHome;
  return e;
}

export function validateContact(d: Pick<Draft, 'contact' | 'source'>): Errors {
  const e: Errors = {};
  if (d.contact.name.trim().length < 1) e.name = MESSAGES.name;
  if (!normalizeMobile(d.contact.mobile)) e.mobile = MESSAGES.mobile;
  if (!isEmail(d.contact.email)) e.email = MESSAGES.email;
  const code = d.source.referralCode.trim().toUpperCase();
  if (code && !REFERRAL_CODE.test(code)) e.referralCode = MESSAGES.referral;
  return e;
}

export const STEPS = ['address', 'roof', 'time', 'contact', 'review'] as const;
export type Step = (typeof STEPS)[number];

export function validateStep(step: Step, d: Draft): Errors {
  switch (step) {
    case 'address':
      return validateAddress(d);
    case 'roof':
      return validateRoof(d);
    case 'time':
      return validateTime(d);
    case 'contact':
      return validateContact(d);
    case 'review':
      return { ...validateAddress(d), ...validateRoof(d), ...validateTime(d), ...validateContact(d) };
  }
}

/** Where the first problem is, so the review step can send people back to fix it. */
export function firstStepWithErrors(d: Draft): Step | null {
  for (const step of STEPS.slice(0, 4)) {
    if (Object.keys(validateStep(step, d)).length > 0) return step;
  }
  return null;
}

/** The exact consent wording shown next to the checkbox. Stored with each booking. */
export function smsConsentText(businessName: string, maxPerBooking: number): string {
  return (
    `Text me about this appointment. ${businessName} will send a confirmation, reminders and updates, ` +
    `up to ${maxPerBooking} messages per booking. Message and data rates may apply. ` +
    `Reply STOP to opt out, HELP for help. Texting is optional.`
  );
}
