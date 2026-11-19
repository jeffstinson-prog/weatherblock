# Status

Updated 2026-11-19.

## Done

- **Site and help center.** All public pages, built only from `facts.yaml`. 29 help answers, searchable. Three more wait on blank facts and stay hidden: visit length, license, warranty.
- **Verified at the source** (links on each answer):
  - June 1, 2027 NC homeowners changes: NC Rate Bureau circulars P-25-3, P-25-5, P-26-2 and P-26-4. Roof payment schedule, cosmetic damage exclusion and matching exclusion, each with a buyback.
  - Roof grants: NCIUA runs two programs. Island homes, like the island part of Ocean Isle Beach, use Strengthen Your Roof (up to $10,000). Mainland Brunswick County uses Strengthen Your Coastal Roof (up to $6,000). Since November 1, 2025 only Certified FORTIFIED Roofing Contractors can install grant-funded roofs, so the site says we can't do those yet.
  - Public adjuster law: N.C. Gen. Stat. Article 33A.
  - Deductibles: no NC statute bans waivers. The site states our policy (never) and quotes NCDOI's general warning.
  - Acorn Finance: marketplace, not a lender; soft credit check to see offers. Wording from Acorn's own pages.
- **Checked against the best sites** (November 19): the biggest US roofing companies' sites (Roofing Contractor's Top 100), 11 local competitors, and published research on booking forms (Baymard, Nielsen Norman Group, GOV.UK). Only one local competitor lets people pick a time online. Changes that came from it: the soonest times show without scrolling, a change made from the review goes straight back to it, the review says "You're not booked yet", the mobile and email fields say what they're for, "Check us yourself" on the about page (state registration and reviews, each linked), and three answers (vacation homes, hurricane deductibles, door-to-door roofers, sourced from NCDOI).
- **Online booking.** Five steps: address (suggestions as you type, service area checked), roof (material, age, reason, notes, up to 6 photos), a two-hour window, contact and text consent, then review with the satellite image. Saved on the phone as you go for 24 hours. Confirmation with a reference, Apple and Google calendar buttons, and a private link to reschedule or cancel. No passwords, nothing personal in any URL (the link's secret sits after `#`).
- **Capacity in the database.** Booking locks the window's row, then counts. Tested with eight bookings racing for one spot (exactly one wins) and in the browser with two phones (the loser is offered the nearest open times).
- **Texts and email.** Confirmation, a reminder the evening before (6 to 9 pm) and the morning of (from 7:30 am), changes and cancellations, owner alerts by text and email, replies to our number forwarded to the owners, STOP and START honored. Without keys everything is logged, not sent. Retries and clean-up run every 15 minutes.
- **Owner app** at `/app/`, installable: sign in with an emailed code; Today with directions, call and text; booking details with the gate code on tap, photos, notes, status, reschedule and "on my way"; Upcoming with overbooking warnings; Availability (windows, inspectors, notice, days off); referral codes with share links; CSV export (no gate codes); your alerts.
- **Google Calendar sync** both ways: bookings go on the calendar and come off when cancelled; anything else busy blocks those windows; events moved or deleted in Google are put back. Waits on a Google service account.
- **The assistant** at `/ask/`: Claude Opus 5.5 by default, answers only from the help center and facts, says it's automated, offers to book or call, and carries what it learned into the booking form. A code check of every house rule reads each reply before it's shown; the same check passes on every built page. Questions it couldn't answer are listed in the owner app for 30 days.
- **Availability** comes from weekly windows, days off, number of inspectors and busy times from the calendar. Starting point until Justin changes it in the owner app: Monday to Saturday, 8 to 10, 10 to noon, noon to 2, 2 to 4, one inspector, bookable 12 hours to 21 days ahead.
- **Protection.** Row level security on every table; the public can only call five narrow functions. Rate limits, a hidden bot field, at most 3 upcoming bookings per mobile number. Gate codes deleted a week after the visit.
- **Checks on every pull request.** Unit tests, type check, database tests on Postgres, Playwright at 320px and 390px in light and dark with axe (WCAG 2.2 AA), the full booking flow, Lighthouse at phone settings. Locally: 100 in all four Lighthouse categories on all 9 pages checked, including the booking page.

## Next

1. Review the pull requests and merge them in order, starting with the site.
2. Work through [`LAUNCH.md`](LAUNCH.md): accounts, 10DLC, facts, the domain move. Supabase: tables loaded and sign-ups off (November 19). The sign-in code email waits for Resend, since Supabase only allows template edits with custom SMTP.
3. Run the live assistant tests once there's an Anthropic key: `npm run test:assistant` (top 30 questions and 15 attempts to break the rules). Not run yet; no key in this environment.

## Waiting on JT and Justin

All of it is in [`LAUNCH.md`](LAUNCH.md). The facts in section 3 only change what the site shows, in `facts.yaml`; none of them needs a code change.
