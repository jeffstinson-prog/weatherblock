# WeatherBlock Roofing website

The public site, booking, owner app and assistant for WeatherBlock Roofing, Ocean Isle Beach, NC.

Built with Astro and TypeScript, hosted on Netlify. Pages are plain HTML; small Preact pieces handle anything you tap.

## The facts file

Everything the site and the assistant say about the business comes from [`facts.yaml`](facts.yaml): the name, phone, service area, what the inspection costs, licenses, insurance, warranty, reviews, financing.

- Leave a value blank and everything that depends on it stays hidden, everywhere.
- The business name is set once there. Renaming is a one-line change.
- Help center answers live in [`src/content/help/`](src/content/help/), one Markdown file per question. They can use facts as `{{contact.phone}}`, and a paragraph that mentions a blank fact is left out. See the top of [`src/facts/template.ts`](src/facts/template.ts) for the syntax.

## Run it

Needs Node 22.23 or newer.

```sh
npm install
npm run dev          # http://localhost:4321
```

## Database

Supabase Postgres. The schema is in [`supabase/migrations/`](supabase/migrations/), applied in order. For a new, empty project, `npm run --silent db:setup-sql` prints them all as one file to paste into the SQL Editor; `npm run --silent db:setup-sql -- --after <version>` prints only the newer ones, for a project that has the rest.

- `wb` holds the tables. The public can't read them.
- `wb_api` holds the only functions the public can call: open windows, book, the manage link.
- Capacity is enforced by the database: booking locks the window's row before counting, so a window can never be overbooked, even when two people book at the same moment.
- Owners read and write through row level security.

Tests run the same migrations on plain Postgres 16 or newer, with a few stand-ins for what Supabase provides ([`supabase/test-shim.sql`](supabase/test-shim.sql)).

## Texts and email

Email goes through Resend, texts through Twilio. Every message is written to `wb.messages` first, then sent.

- **No keys, no sending.** Without `RESEND_API_KEY` or the Twilio keys, messages are recorded as `logged` and never leave. The confirmation screen only says "we emailed" or "we texted" when one really went out.
- **Customer:** confirmation (email always, text if they agreed), a reminder 6 to 9 pm the evening before and from 7:30 am the morning of, "on my way", and a note when the time changes or is cancelled.
- **After the visit:** a thank-you when an owner marks it done, "your estimate is ready" with the private link, then follow-up emails on the days in `facts.yaml` (2, 7 and 21), 9 am to 6 pm, at least a day apart. Follow-ups stop on an answer, a question, any text from the customer, or an owner's tap, and wait until `business.mailingAddress` is set (CAN-SPAM). For a roof job: the day it's set, a reminder the evening before, a message when it moves (with "because of the weather" when that's why), and thanks when it's done, with one Google review request when a mailing address is on file.
- **Texts** go only to customers who agreed, up to `texts.maxPerBooking` (12) per booking, enforced; email still goes past the limit. Follow-ups and review requests are email only.
- **Owners:** a text and an email for every new, moved or cancelled booking, and when a customer says yes, no thanks, or asks about an estimate. Until owners are set up in the app, alerts go to the business email in `facts.yaml`.
- **Replies to our number** are kept, STOP and START are honored, and every reply is forwarded to the owners. Point the Twilio number's incoming webhook at `https://<site>/api/twilio/sms`.
- **Every 15 minutes** `netlify/functions/every-15-minutes.mts` calls `/api/jobs` with `CRON_SECRET`: reminders, retries of failed messages, clean-up (gate codes after a week, unused photo uploads after two days).

## Owner app

At `/app/`. Installs to a phone's home screen. Owners sign in with a 6-digit code sent by email (Supabase Auth, no passwords, no public sign-ups).

- **Today** (any day): inspections in time order with directions, call and text. Each booking shows everything the customer gave, the gate code on tap, photos, your notes, status (booked, done, cancelled, no show), reschedule, "on my way" texts, every message sent, and the history. Once the visit is done: the estimate (price, what's included, an optional PDF), whether it was opened, the follow-ups, the customer's answer, and the roof job's crew and day.
- **Upcoming:** the next two weeks, and a warning when a window holds more bookings than inspectors.
- **Estimates:** needs an estimate, waiting on the customer, said yes and needs a day, said no thanks.
- **Jobs:** roof jobs for four weeks by day and crew. "Move this day" moves every job on it (weather) and tells each customer. Crews: names, jobs a day, who's working; scheduling past a crew's jobs a day asks first.
- **More:** inspection availability (windows by weekday, inspectors, notice, how far ahead, days off, the Google Calendar), crews, referral codes (each with a link like `/r/SMITH24`), the CSV export, your alerts.

Add an owner: `node scripts/add-owner.mjs <email> "<name>" [mobile]` with the production variables set.

**Google Calendar:** bookings appear on the calendar and leave it when cancelled; anything else marked busy takes one inspector out of the windows it overlaps. Move and cancel bookings in the app (it's what tells the customer); an event moved or deleted in Google is put back on the next sync. Set up a Google service account, share the calendar with it ("Make changes to events"), and set `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_KEY`.

## Instant estimate

At `/estimate/`. Pick an address, get a ballpark for a new roof, in a few seconds. Nothing is stored.

- **Address:** the same Google suggestions as the booking form.
- **The roof:** Google's Solar API (Building Insights) measures the actual roof from aerial imagery: its area with the slope, the area seen from above, and the pitch (`src/server/solar.ts`, called from `/api/estimate`). 10,000 lookups a month cost nothing, then a cent each. It runs on its own key, `GOOGLE_SOLAR_KEY`, best in its own Google Cloud project: Google's terms describe the Solar API for solar and energy systems, so if Google ever objects, only that key is affected and the page falls back on its own.
- **When Google has no data** for a house (new construction, mostly): building outlines from Microsoft Global ML Building Footprints (Open Database License), cut to the county by `scripts/build-outlines.mjs` into `public/data/outlines/`, shown on a USDA aerial photo with "Is this your house?". When that's missing too: heated square feet and stories.
- **The price:** `instantEstimate` in `facts.yaml`: price per square, the large-roof price per square, Google's measured roof times `measuredRange` (1.0 to 1.15, for waste), or an outline times `slopeFactor` (1.1 to 1.3). Rounded out to $100. No price for a building too big or small to be one house.
- **Booking:** one tap carries the chosen address (already picked, no retyping), the satellite picture and the ballpark into the booking form, so Justin sees it.
- **Refresh the outlines** when Microsoft publishes new data: download the county's files (see the top of `scripts/build-outlines.mjs`) and run it.

## The assistant

At `/ask/`, a page (never a pop-up). One request to the Claude API per question, from a server function (`src/server/assistant/`). Model: `ASSISTANT_MODEL`, default `claude-opus-5-5`, low effort, with the server-side refusal fallback on.

- **It knows only** the facts file (blank facts left out, and it's told which facts we don't have) and the published help center.
- **It says it's automated**, says when it doesn't know, and offers to book or call. It can start a booking: what it learned about the roof is carried into the booking form (never names, numbers or addresses).
- **Every reply passes a code check** of the house rules before anyone sees it (`src/server/assistant/guard.ts`): no prices beyond the facts, no insurance promises, no claim handling, no deductible offers, no credentials, ratings or years in business we can't back up, no "I'm a person", no "you're booked", and only phone numbers, links and percentages we know. A reply that fails is replaced with "call us" and shows up in the owner app's question list.
- **The same check runs over every built page** (`npm run test:content`).
- **Live tests** (`npm run test:assistant`, needs `ANTHROPIC_API_KEY`): the top 30 questions and 15 attempts to break the rules. A separate workflow runs them when the facts, the help center or the assistant change, once the repository has the key as a secret.

## Test

```sh
npm test                                   # unit tests: facts, help center, house rules, the rule check
npm run test:content                       # every built page keeps the house rules (after a build)
npm run db:local && npm run test:db        # database: capacity, two people racing for one spot, row level security
npm run build:test && npm run test:e2e     # Playwright at 320px and 390px, light and dark, with axe: booking, manage link, owner app
FORCE_INDEXABLE=1 npm run build:node && npm run lhci   # Lighthouse, phone settings, 95+ required
```

The database and end-to-end tests need a Postgres you can throw away. Set `DATABASE_URL` (default `postgres://postgres:postgres@127.0.0.1:5432/wb_test`; end-to-end uses `wb_e2e`). Lighthouse needs Chrome; if it isn't found, set `CHROME_PATH`.

All of these run on every pull request in GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Deploy

Netlify builds every pull request as a deploy preview and deploys `main` to production.

- Build command `npm run build`, publish directory `dist` (both set in [`netlify.toml`](netlify.toml)).
- Environment variables: see [`.env.example`](.env.example). Keys go in Netlify's environment settings, never in the repo.
- Until `web.launched` is `true` in `facts.yaml`, every page tells search engines to stay out.

## Where things are

| Path | What |
| --- | --- |
| `facts.yaml` | Every fact the site may state |
| `src/content/help/` | Help center answers |
| `src/booking/` | The booking form and the manage link (Preact) |
| `src/owner/` | The owner app (Preact) |
| `src/assistant/`, `src/server/assistant/` | The assistant page, its prompt and the rule check |
| `src/server/` | Server code: database, booking, maps, storage |
| `src/pages/api/` | Server endpoints |
| `supabase/migrations/` | Database schema |
| `src/pages/` | Pages (one file per URL) |
| `src/components/`, `src/layouts/` | Shared pieces |
| `src/styles/global.css` | Colors from the logo, type, buttons, forms |
| `tests/unit/`, `tests/e2e/` | Tests |

See [`STATUS.md`](STATUS.md) for what's done and what's next, and [`LAUNCH.md`](LAUNCH.md) for what's left before launch.
