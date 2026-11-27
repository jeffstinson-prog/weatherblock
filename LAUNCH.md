# Launch checklist

What's left before real customers book. Roughly in order. Anything that costs
money, touches DNS, or texts or emails real people waits for your OK.

You do the sign-ups, payments and answers. Items marked **(me)** are mine: the
settings, code and tests, once you've made the account or given the answer.

## 1. Accounts

Use the business Gmail (weatherblockroofing@gmail.com) as the login where you
can, then add each other, so the business owns every account. Keys go in
Netlify's environment settings (and GitHub secrets for tests), never in the repo.
The full list of settings is in `.env.example`.

- [x] **GitHub**: the private repo `weatherblock` (done November 19, 2026).
  - [x] GitHub Actions is on (November 21, 2026), so the tests run on every pull request and on `main`.
- [x] **Netlify** (done November 20, 2026): the project `heartfelt-profiterole-59a6a3`, connected to the repo. Test site: https://heartfelt-profiterole-59a6a3.netlify.app. Booking checked end to end on it.
  - [x] Netlify builds from `main` (switched November 21, 2026, after all nine pull requests were merged). The redesign is live on the test site, and booking was checked end to end on it again: a time tapped on the home page, a made-up booking, then cancelled from its private link.
- [ ] **Supabase**: the project is WeatherBlock Roofing (`fsyrlkpzxljwhqpfxofh`). It signs owner logins with published keys (ES256), which the site checks, so no JWT secret is needed.
  - [x] Load the tables (done November 19, 2026), and the update for estimates, crews and roof jobs (done November 20, 2026).
  - [x] Load the update for estimate requests (done November 24, 2026). `npm run --silent db:setup-sql` prints every migration as one file to paste into the SQL Editor; `-- --after <version>` prints only the newer ones. Each runs as one transaction and ends with a summary line to check.
  - [x] Sign-ups off (done November 19, 2026).
  - [ ] With the Resend step: send sign-in email through Resend (Authentication, SMTP settings), then change the "Magic Link" email template to include the 6-digit code, for example `Your sign-in code: {{ .Token }}`. Supabase only allows template edits once custom SMTP is set up, and its built-in email is only for testing. Until then, owners can't sign in to the owner app.
  - [ ] If it's on the free plan, move it to Pro ($25 a month) before real bookings. Free projects have no daily backups and pause after a quiet week.
  - Deploy previews share this project until launch, so their test bookings land here too (cleared on launch day).
- [ ] **Resend** (free up to 100 emails a day, about 25 bookings): verify the domain, create an API key, then the Supabase sign-in email (above). Step by step: [`GO-LIVE.md`](GO-LIVE.md), steps 1 and 2.
- [ ] **Twilio**: buy a local 910 number, create a Messaging Service, and point incoming messages at `https://weatherblockroofingnc.com/api/twilio/sms`. Then 10DLC (section 2). Step by step: [`GO-LIVE.md`](GO-LIVE.md), step 4.
- [ ] **Google Cloud** (needs a card on file; this traffic stays inside the free monthly caps):
  - Turn on Places API (New), Maps Static API and Google Calendar API.
  - A server key limited to Places API (New).
  - A browser key limited to Maps Static API and the site's domains, plus a URL signing secret.
  - A service account for the calendar, in a project of its own under the business Gmail. Its key file goes into Netlify whole, as `GOOGLE_SERVICE_ACCOUNT_KEY`, and the calendar's ID as `GOOGLE_CALENDAR_ID` (or in the owner app, Availability). The calendar is shared with the service account's email ("Make changes to events"). Step by step: [`GO-LIVE.md`](GO-LIVE.md), step 5.
  - The roof measurement that comes with each estimate request: a second Google Cloud project with the Solar API turned on, and a key limited to it, as `GOOGLE_SOLAR_KEY`. Keeping it separate means that if Google ever objects to roofing use (its terms describe the Solar API for energy systems), booking's address search isn't touched; requests fall back to the free outlines on their own. 10,000 lookups a month are free.
  - The test site borrows keys from the StayOIB project (November 23, 2026). Before launch, make these three keys in a Google Cloud project that belongs to this business.
- [ ] **Claude, for the assistant**: it already works on the test site through Netlify's built-in AI, billed to your Netlify credits, which all of your Netlify sites share. Before launch, add WeatherBlock's own Anthropic API key with a monthly spend limit as `ANTHROPIC_API_KEY` in Netlify (it takes over automatically), so its bill is separate and a busy month can't use up credits your other sites need. Also add it as a GitHub secret for the live assistant tests (step 5).
- [ ] **Netlify settings** (me, once the accounts above exist). In place now: the database, the Supabase keys, `APP_ENV=preview`, and the three random secrets.
  - At launch: `APP_ENV=production` and the live keys.
  - Deploy previews: `APP_ENV=preview`, the preview database and test keys (Twilio test credentials send nothing).
  - Netlify dropped its 4 KB limit on function variables in June 2026, so the Google key file (about 2.4 KB) fits.
- [ ] **Owners**: add yourselves in Supabase with the SQL in [`GO-LIVE.md`](GO-LIVE.md), step 3 (or send me your emails and mobiles, and I run `node scripts/add-owner.mjs <email> "<name>" <mobile>` once I can reach the database). Then sign in at `/app/`, check your alert settings, and add the app to your home screen.

## 2. Texts: carrier registration (A2P 10DLC)

US carriers block business texts from unregistered numbers. Registration takes
days to a few weeks and needs the live site, with its privacy and text message
pages, on the real domain. Until it's approved, texts are recorded in the owner
app and not sent; email works from day one. The form's boxes, ready to paste, are
in [`GO-LIVE.md`](GO-LIVE.md), step 4.

- [ ] **Brand**: WeatherBlock Roofing Incorporated, EIN, the principal office address on file with the state, website, contact.
- [ ] **Campaign**: "Low volume mixed" (about $1.50 a month), or "Customer care" if Twilio steers you there. One-time fees run about $20 (brand plus vetting).
  - Description: for customers who book a roof inspection online and opt in: appointment confirmations, reminders, "on my way", schedule changes, a note when their estimate is ready, and for roof work they agree to, the scheduled day, a reminder the day before and weather changes. No marketing.
  - Sample messages: copy them from `src/server/messaging/templates.ts` and `src/server/messaging/pipeline-templates.ts`.
  - How people opt in: an optional, unchecked box on step 4 of the booking form at `/book/`, with the exact wording shown there. Terms at `/text-messages/`, privacy at `/privacy/`.
  - Opt-out STOP, help HELP.

## 3. Facts (`facts.yaml`)

Each of these is blank or unconfirmed, and the site hides whatever depends on it.

- [ ] A mailing address for the business (`business.mailingAddress`). A P.O. box works. Follow-up and review emails print it at the bottom, as the CAN-SPAM Act requires, and wait until it's set.
- [ ] The Google review link (`pipeline.reviewUrl`): Google Business Profile, "Ask for reviews", copy the link.
- [ ] When estimates are usually ready (`pipeline.estimateTurnaround`), for example "within 2 business days". It finishes the sentence in the thank-you after each visit.
- [x] How fast you call back an estimate request (`estimate.callback`): "within one business hour" (JT, November 24). The estimate page, the customer's email, the help answer and the assistant say it, and your alerts show what was promised. The site nudges you once if nobody has called after half an hour.
- [ ] Justin: is $450 per square for the roof as measured, or with waste added? The ballpark you get with each estimate request runs from Google's measured roof to 15% more for waste (`measuredRange`). Customers don't see it. Also check the crews in the owner app (Jobs, Crews): names and jobs a day.
- [ ] Decide once more, when you run ads: keep prices off the site (`estimate.showBallpark: false`, the page is "Free estimate"), or show a rough range after someone sends their name and number (`true`, and the page becomes "Instant estimate"). Either is honest. A page called "instant estimate" that gives no estimate is not, and ad platforms reject it.
- [ ] Phone hours. Also fix the Google Business Profile, which says "Open 24 hours".
- [ ] NC license number, and whose name it's under.
- [ ] Liability insurance (carrier and limit), workers' comp.
- [ ] Workmanship warranty; any manufacturer certifications.
- [ ] FORTIFIED: when the certification comes through, set `fortified.certified: true`. The grant and FORTIFIED answers change with it.
- [ ] Who flies the drone, and their FAA Part 107 certificate.
- [ ] How long a visit takes.
- [ ] Confirm nobody needs to be home for a drone inspection. The site says so now (`inspection.homeNotRequired`).
- [ ] JT's role, if you want one shown next to "Justin runs the crews".
- [ ] The Google rating: update `reviews.google` and its date when it changes.
- [ ] Job photos, each with the homeowner's OK. The before and after shots on the temp site count once you have that.
- [ ] Logo vector files (SVG, AI, EPS or PDF).
- [ ] Availability in the owner app: real windows, inspectors, notice and days off (Thanksgiving is open now). The starting point is Monday to Saturday, four 2-hour windows from 8 am, one inspector, 12 hours' notice. [`GO-LIVE.md`](GO-LIVE.md), step 6, has the same as SQL for before the app's sign-in works.
- [ ] Acorn: their dealer agreement asks contractors to clear financing wording with them. Send them `/financing/`, and confirm the `d=QP3YO` link is yours.
- [ ] Read every page and help answer once. Justin especially: materials, repair or replace, storm damage.
- [ ] Have your attorney read `/privacy/` and `/terms/`.

## 3b. Estimate requests and ads

The estimate page is built to be the page an ad points to: one job, no menu, a phone number, and every request lands with you first.

- [ ] Alerts need the accounts in section 1: Resend for email, Twilio for texts, and you two added as owners with your mobile numbers. Until then requests are saved and wait in the owner app.
- [ ] Decide who calls, and how fast. A request nobody has called gets one reminder after half an hour, between 8 am and 8 pm.
- [ ] Point each ad at the estimate page with a tag, so every request and booking shows where it came from: `https://weatherblockroofingnc.com/estimate/?utm_source=google&utm_medium=cpc&utm_campaign=roof-estimate` (use `facebook` and `paid_social` for Facebook and Instagram).
- [ ] Ad wording that matches the page, so Google and Facebook approve it and people get what they were promised. For example: "Free roof estimate in Brunswick County. Start with your address." or "Thinking about a new roof? Enter your address and we'll call to set up a free estimate." Leave out "instant", "price in seconds" and anything about insurance paying, unless `estimate.showBallpark` is on and the page really shows a range.
- [ ] Counting results inside Google Ads or Facebook takes their tracking code on the site. The site has none today, and the privacy page says so. Tell me when you want it: the privacy page and the site's security settings change with it.

## 4. Moving the domain off the temp site (DNS: I'll ask before each change)

`weatherblockroofingnc.com` is registered at Namecheap. By November 24 its DNS
had moved to Netlify, it's this site's main address, and HTTPS works. Namecheap's
email forwarding ended with the move: the domain has no mail records now.

- [x] In Netlify, add the custom domain, with Netlify's DNS (by November 24).
- [x] Netlify's HTTPS certificate (working November 24: every page, www to the main address, the roof pictures).
- [x] Set `SITE_URL=https://weatherblockroofingnc.com` (JT, November 25). It takes effect with the next deploy.
- [ ] Add Resend's DNS records in Netlify ([`GO-LIVE.md`](GO-LIVE.md), step 1).
- [ ] If anyone used an @weatherblockroofingnc.com address: set up forwarding again (one more record in Netlify).
- [ ] Remove the domain from the temp site's builder, and stop paying for it.
- [ ] Point the Google Business Profile's website link at `https://weatherblockroofingnc.com/?utm_source=google&utm_medium=gbp`, so those bookings show where they came from.

## 5. Launch day

- [ ] Clear the test bookings and requests out of the database: the look-first and delete SQL is in [`GO-LIVE.md`](GO-LIVE.md), step 7 (rehearsed on a copy).
- [ ] Set `web.launched: true` in `facts.yaml` (me). Search engines are kept out until then.
- [ ] `APP_ENV=production` for Production in Netlify ([`GO-LIVE.md`](GO-LIVE.md), step 7).
- [ ] On your phone, book a real inspection. Get the text and the email, see it in the owner app and on the calendar, then reschedule and cancel from the link.
- [ ] Run `npm run test:assistant`, read the answers, and fix any help answer it stumbles on (me).
- [ ] Add the site to Google Search Console and submit `/sitemap-index.xml`.

## Monthly cost, roughly

| | |
| --- | --- |
| Netlify | in your Pro team, no new plan |
| Supabase | $0 on the free plan while testing; $25 on Pro from launch |
| Twilio | about $12 at 100 bookings a month |
| Resend | $0 (free up to 100 a day; $20 if a storm rush goes past that) |
| Google Maps and Calendar | $0 under the free caps |
| Roof measurements for estimate requests and bookings (Google, first 10,000 a month; then 1 cent each) | $0 |
| Claude API (the assistant) | about 10 cents a conversation on Opus 5.5; on Netlify's built-in AI until you add your own key |

## Reviews, from day one

- Ask every customer for a Google review, the same way, whether the job went perfectly or not. Never offer anything for one. Google's rules forbid both incentives and asking only the happy customers.
- Answer each review yourself, in your own words.

## After launch (from the brief)

- Inspection report: the inspector uploads photos and findings from a phone, and the customer gets a private link.
- Opt-in storm alerts by text.
