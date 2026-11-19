# Status

Updated 2026-11-19.

## Done

- **Site and help center.** All public pages, built only from `facts.yaml`. 23 help answers, searchable. Three more wait on blank facts and stay hidden: visit length, license, warranty.
- **Verified at the source** (links on each answer):
  - June 1, 2027 NC homeowners changes: NC Rate Bureau circulars P-25-3, P-25-5, P-26-2 and P-26-4. Roof payment schedule, cosmetic damage exclusion and matching exclusion, each with a buyback.
  - Roof grants: NCIUA runs two programs. Island homes, like the island part of Ocean Isle Beach, use Strengthen Your Roof (up to $10,000). Mainland Brunswick County uses Strengthen Your Coastal Roof (up to $6,000). Since November 1, 2025 only Certified FORTIFIED Roofing Contractors can install grant-funded roofs, so the site says we can't do those yet.
  - Public adjuster law: N.C. Gen. Stat. Article 33A.
  - Deductibles: no NC statute bans waivers. The site states our policy (never) and quotes NCDOI's general warning.
  - Acorn Finance: marketplace, not a lender; soft credit check to see offers. Wording from Acorn's own pages.
- **Look.** Logo from Justin's site (`src/assets/logo.png`, untouched). Favicon and app icon are a crop of the logo's roof mark. Palette from the logo, darkened where needed so text passes contrast. Light and dark follow the phone.
- **Checks on every pull request.** Unit tests, type check, Playwright at 320px and 390px in light and dark with axe (WCAG 2.2 AA), broken link crawl, Lighthouse at phone settings. Locally: 100 in all four Lighthouse categories on the 8 pages checked.

## Next

1. Online booking with live availability, capacity enforced in the database, the manage link (reschedule, cancel).
2. Texts and email: confirmations, reminders, owner alerts.
3. Owner app and Google Calendar sync.
4. The assistant and its rule tests.
5. Launch checklist.

## Waiting on JT and Justin

- Phone hours to publish (Google says "Open 24 hours")
- NC license number and whose name it's under
- Liability insurance (carrier and limit), workers' comp
- Workmanship warranty, any manufacturer certifications
- Who flies the drone and their FAA Part 107 certificate
- How long a visit takes
- Confirm nobody needs to be home for a drone inspection (the site says so now; `inspection.homeNotRequired` in `facts.yaml`)
- Logo vector files
- Job photos with the homeowner's OK (the before and after shots on Justin's temp site need that OK first)
- Acorn: their dealer agreement asks contractors to clear financing wording with them. Send them `/financing/` before launch, and confirm the `d=QP3YO` link is ours.
