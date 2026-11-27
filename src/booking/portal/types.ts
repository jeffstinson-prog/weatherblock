// What the private page gets from /api/manage (see src/server/portal.ts), and what
// the page itself is given from facts.yaml. The phone never sees the booking's id.

export interface PortalEstimate {
  status: 'sent' | 'accepted' | 'declined';
  amountCents: number | null;
  summary: string;
  hasFile: boolean;
  sentAt: string;
  decidedAt: string | null;
  askedAt: string | null;
  roofSqft: number | null;
  roofPitch: number | null;
}

export interface PortalJob {
  status: 'to_schedule' | 'scheduled' | 'done';
  day: string | null;
  doneAt: string | null;
}

export interface PortalPhoto {
  id: string;
  url: string;
  caption: string;
  source: 'customer' | 'team';
  at: string;
}

export interface ThreadItem {
  id: string;
  from: 'us' | 'you';
  /** Both, for an email and a text we sent together about the same thing. */
  channels: ('email' | 'sms' | 'portal' | 'estimate')[];
  text: string;
  at: string;
}

export interface PortalBooking {
  ref: string;
  status: 'booked' | 'done' | 'cancelled' | 'no_show';
  startsAt: string;
  endsAt: string;
  address: string;
  firstName: string;
  smsConsent: boolean;
  canChange: boolean;
  estimate: PortalEstimate | null;
  /** A satellite view of the home, when the estimate states the roof's size. */
  roofPicture?: string | null;
  job: PortalJob | null;
  bookedAt: string;
  photos: PortalPhoto[];
  messages: ThreadItem[];
  /**
   * The warranty document for a finished job. The server doesn't send one yet; once it
   * does (a signed link, like the estimate's), Documents lists it. Until then nothing
   * on the page mentions a warranty.
   */
  warranty?: { url: string; issuedAt: string | null } | null;
}

/** Facts the page needs, passed in from facts.yaml by the Astro page. */
export interface PortalFacts {
  businessName: string;
  /** "Ocean Isle Beach, NC" */
  town: string;
  team: string[];
  phone: string;
  phoneHref: string;
  /** sms: link, blank when the number doesn't take texts. */
  smsHref: string;
  email: string;
  bookLabel: string;
  domain: string;
  /** The "ask for reviews" link. Blank: no review request on the page. */
  reviewUrl: string;
  /** Finishes "Your estimate will be ready ...". Blank: "soon". */
  turnaround: string;
  /** Lines to get ready for a roof job's day, from facts.yaml. */
  jobDayPrep: string[];
  /** Working hours on a job's day, e.g. "7 am to 5 pm". Blank: not mentioned. */
  jobHours: string;
  byDrone: boolean;
  homeNotRequired: boolean;
  deliverables: string;
}

/** Talks to /api/manage with this page's token. */
export type Call = <T>(payload: Record<string, unknown>) => Promise<T>;

/** A note to the customer: at the top of the page, or under the message box. */
export type Notify = (text: string | null, where?: 'top' | 'messages') => void;
