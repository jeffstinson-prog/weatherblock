import { z } from 'zod';

// Every text fact defaults to "" (blank). Blank facts are hidden everywhere.
const text = () => z.string().trim().default('');
const optionalUrl = () => z.union([z.literal(''), z.url()]).default('');
const isoDate = () => z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD')]).default('');

export const FactsSchema = z.strictObject({
  business: z.strictObject({
    name: z.string().trim().min(1),
    shortName: text(),
    legalName: text(),
    owners: z.array(z.strictObject({ name: z.string().trim().min(1), role: text() })).default([]),
    city: text(),
    state: text(),
    zip: text(),
    mailingAddress: text(),
    lines: z.array(z.string().trim().min(1)).default([]),
    verse: z.strictObject({ text: text(), ref: text() }),
  }),
  contact: z.strictObject({
    phone: text(),
    phoneE164: z.union([z.literal(''), z.string().regex(/^\+1\d{10}$/, 'use +1 and 10 digits')]).default(''),
    takesTexts: z.boolean().default(false),
    email: z.union([z.literal(''), z.email()]).default(''),
    hours: text(),
  }),
  web: z.strictObject({
    domain: z.string().trim().min(3),
    launched: z.boolean().default(false),
  }),
  serviceArea: z.strictObject({
    summary: text(),
    short: text(),
    state: z.string().length(2),
    counties: z.array(z.string().trim().min(1)).default([]),
  }),
  services: z.array(
    z.strictObject({
      key: z.string().trim().min(1),
      name: z.string().trim().min(1),
      path: z.string().startsWith('/').endsWith('/'),
    }),
  ),
  inspection: z.strictObject({
    free: z.boolean(),
    byDrone: z.boolean().default(false),
    windowHours: z.number().int().positive(),
    deliverables: text(),
    homeNotRequired: z.boolean().default(false),
    duration: text(),
  }),
  credentials: z.strictObject({
    registration: z.strictObject({ id: text(), lookupUrl: optionalUrl() }),
    license: z.strictObject({ holder: text(), kind: text(), number: text(), lookupUrl: optionalUrl() }),
    insurance: z.strictObject({ liability: text(), workersComp: text() }),
    warranty: z.strictObject({ workmanship: text() }),
    certifications: z.array(z.string().trim().min(1)).default([]),
    fortified: z.strictObject({
      certified: z.boolean().default(false),
      inProgress: z.boolean().default(false),
    }),
    drone: z.strictObject({ part107: text() }),
  }),
  reviews: z.strictObject({
    google: z.strictObject({
      rating: z.number().min(1).max(5).nullable().default(null),
      count: z.number().int().nonnegative().nullable().default(null),
      asOf: isoDate(),
      url: optionalUrl(),
    }),
  }),
  prices: z
    .array(z.strictObject({ label: z.string().trim().min(1), amount: z.string().trim().min(1) }))
    .default([]),
  estimate: z.strictObject({
    on: z.boolean().default(false),
    callback: text(),
    showBallpark: z.boolean().default(false),
    material: text(),
    pricePerSquare: z.number().positive(),
    largeRoof: z.strictObject({
      minSquares: z.number().positive(),
      pricePerSquare: z.tuple([z.number().positive(), z.number().positive()]),
    }),
    measuredRange: z.tuple([z.number().min(0.8).max(1.5), z.number().min(0.8).max(1.5)]),
    slopeFactor: z.tuple([z.number().min(1).max(2), z.number().min(1).max(2)]),
  }),
  pipeline: z.strictObject({
    estimateTurnaround: text(),
    followUpDays: z
      .array(z.number().int().min(1).max(90))
      .max(5)
      .refine((d) => d.every((x, i) => i === 0 || x > d[i - 1]!), 'list the days in order, smallest first')
      .default([2, 7, 21]),
    reviewUrl: optionalUrl(),
    // The customer's page before a roof job's day: short lines, and the working hours if you want them said.
    jobDayPrep: z.array(z.string().trim().min(1).max(120)).max(6).default([]),
    jobHours: text(),
  }),
  financing: z.strictObject({
    provider: text(),
    url: optionalUrl(),
    disclosure: text(),
    notes: z.array(z.string().trim().min(1)).default([]),
  }),
  insuranceClaims: z.strictObject({ weDo: text(), youDo: text() }),
  photos: z
    .array(
      z.strictObject({
        file: z.string().trim().min(1),
        alt: z.string().trim().min(1),
        homeownerOk: z.string().trim().min(1),
      }),
    )
    .default([]),
  texts: z.strictObject({ maxPerBooking: z.number().int().positive() }),
});

export type FactsInput = z.infer<typeof FactsSchema>;

/** Values computed from the facts, for use in text as {{derived.*}}. */
export interface Derived {
  /** "Justin Coffey and JT Stinson" */
  ownerNames: string;
  /** "Justin runs the crews." (one sentence per owner with a role) */
  ownerRoles: string;
  /** "a free inspection" or "an inspection" */
  anInspection: string;
  /** "the free inspection" or "the inspection" */
  theInspection: string;
  /** "Book a free inspection" or "Book an inspection" */
  bookLabel: string;
  /** What the estimate page is called: "Free estimate", or "Instant estimate" when it shows a ballpark. */
  estimateName: string;
  /** The page's heading: "Free roof estimate" or "Instant roof estimate" */
  estimateTitle: string;
  /** "a free estimate", or "an instant estimate" when the page shows a ballpark */
  anEstimate: string;
  /** The button that sends a request: "Get my free estimate" */
  estimateCta: string;
  /** Booking a visit from the estimate page: "Book my free estimate" */
  bookEstimateLabel: string;
  /** When we call back about a request: the fact, or "soon" */
  estimateCallback: string;
}

export type Facts = FactsInput & { derived: Derived };
