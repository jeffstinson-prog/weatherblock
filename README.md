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
- `wb_api` holds the only functions the public can call: open windows, book, the manage link, ask for an estimate.
- Capacity is enforced by the database: booking locks the window's row before counting, so a window can never be overbooked, even when two people book at the same moment.
- Owners read and write through row level security.

Tests run the same migrations on plain Postgres 16 or newer, with a few stand-ins for what Supabase provides ([`supabase/test-shim.sql`](supabase/test-shim.sql)).

## Texts and email

Email goes through Resend, texts through Twilio. Every message is written to `wb.messages` first, then sent.

- **No keys, no sending.** Without `RESEND_API_KEY` or the Twilio keys, messages are recorded as `logged` and never leave. The confirmation screen only says "we emailed" or "we texted" when one really went out.
- **Customer:** confirmation (email always, text if they agreed), a reminder 6 to 9 pm the evening before and from 7:30 am the morning of, "on my way", and a note when the time changes or is cancelled.
- **After the visit:** a thank-you when an owner marks it done, "your estimate is ready" with the private link, then follow-up emails on the days in `facts.yaml` (2, 7 and 21), 9 am to 6 pm, at least a day apart. Follow-ups stop on an answer, a question, any text from the customer, or an owner's tap, and wait until `business.mailingAddress` is set (CAN-SPAM). For a roof job: the day it's set, a reminder the evening before, a message when it moves (with "because of the weather" when that's why), and thanks when it's done, with one Google review request when a mailing address is on file.
- **Texts** go only to customers who agreed, up to `texts.maxPerBooking` (12) per booking, enforced; email still goes past the limit. Follow-ups and review requests are email only.
- **Owners:** a text and an email for every estimate request (and one reminder if nobody has called in half an hour), for every new, moved or cancelled booking, and when a customer says yes, no thanks, or asks about an estimate. Until owners are set up in the app, alerts go to the business email in `facts.yaml`.
- **Replies to our number** are kept, STOP and START are honored, and every reply is forwarded to the owners. Point the Twilio number's incoming webhook at `https://<site>/api/twilio/sms`.
- **Every 15 minutes** `netlify/functions/every-15-minutes.mts` calls `/api/jobs` with `CRON_SECRET`: reminders, retries of failed messages, clean-up (gate codes after a week, unused photo uploads after two days).

## Owner app

At `/app/`. Installs to a phone's home screen. Owners sign in with a 6-digit code sent by email (Supabase Auth, no passwords, no public sign-ups).

- **Today** (any day): people who asked for an estimate and haven't been called yet come first, each with a call button, the roof's size and a ballpark. Then inspections in time order with directions, call and text. Each booking shows everything the customer gave, the gate code on tap, photos, your notes, status (booked, done, cancelled, no show), reschedule, "on my way" texts, every message sent, and the history. A booking also shows the roof from above (size, pitch, a ballpark; owners only). Once the visit is done: the estimate (price, what's included, the roof's size and pitch, an optional PDF), whether it was opened, the follow-ups, the customer's answer, and the roof job's crew and day.
- **Upcoming:** the next two weeks, and a warning when a window holds more bookings than inspectors.
- **Estimates:** needs an estimate, waiting on the customer, said yes and needs a day, said no thanks.
- **Jobs:** roof jobs for four weeks by day and crew. "Move this day" moves every job on it (weather) and tells each customer. Crews: names, jobs a day, who's working; scheduling past a crew's jobs a day asks first.
- **Estimate requests** (from Today or More): to call, called, booked, closed. Each request: call, text, directions, the roof sheet, mark called, book a time for them, text them the booking link, close with a reason, notes.
- **More:** inspection availability (windows by weekday, inspectors, notice, how far ahead, days off, the Google Calendar), crews, referral codes (each with a link like `/r/SMITH24`), the CSV export, your alerts.

Add an owner: `node scripts/add-owner.mjs <email> "<name>" [mobile]` with the production variables set.

**Google Calendar:** bookings appear on the calendar and leave it when cancelled; anything else marked busy takes one inspector out of the windows it overlaps. Move and cancel bookings in the app (it's what tells the customer); an event moved or deleted in Google is put back on the next sync. Set up a Google service account, share the calendar with it ("Make changes to events"), and set `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_KEY`.

## Estimate requests

At `/estimate/`. Someone enters their address and how to reach them, and the request comes to the owners first, so one of them can call. The site shows no price for a roof (JT and Justin's call, November 23, 2026).

- **The page.** Address (the same Google suggestions as booking), then a satellite picture of the roof ("Is this your house?"), then name, mobile and an optional email. One button: "Get my free estimate". After that: "one of us will call you", the phone number, and "Pick a time now", which opens the booking form with the address and their details already in. The page never shows the roof's size, its pitch or a price, and none of that is sent to the browser (`/api/estimate` answers with a picture only).
- **The owners hear first.** The request is saved, the roof is measured, and every owner gets a text and an email at once: who, where, the roof's size and pitch, and a ballpark. A request nobody has called after half an hour gets one reminder (8 am to 8 pm). In the owner app, Today starts with the people to call.
- **The roof.** Google's Solar API (Building Insights) measures the roof from aerial imagery: area with the slope, and pitch (`src/server/solar.ts`). When Google has no data for a house, its outline in Microsoft's open building data stands in (`public/data/outlines/`, built by `scripts/build-outlines.mjs`); when that's missing too, the request simply has no roof sheet. 10,000 Google lookups a month cost nothing, then a cent each. It runs on its own key, `GOOGLE_SOLAR_KEY`, best in its own Google Cloud project: Google's terms describe the Solar API for solar and energy systems, so if Google ever objects, only that key is affected.
- **The ballpark** is for the owners: `estimate` in `facts.yaml` (price per square, the large-roof price, the measured roof times `measuredRange`, or an outline times `slopeFactor`), worked out on the server (`src/server/roofsheet.ts`). Tests check that no page, no script and no response to a visitor carries it.
- **Booking closes the loop.** A booking from the same mobile number is tied to the request, takes its roof sheet and its source (an ad, a search), and marks it booked. "Book a time for them" in the owner app opens the booking form filled in; "Text them the booking link" opens the owner's own messages with the customer's link ready.
- **On the written estimate.** The estimate form starts with the measured size and pitch. The owner checks them against the visit, changes them if needed, and the customer sees "Your roof" on their estimate: size, squares, pitch and a satellite picture.
- **Google's data is kept 30 days.** Map positions and roof measurements from Google are deleted after 30 days by the scheduled job (Google's terms limit how long they may be kept). The address and Google's place ID stay. What the owner puts on an estimate is the company's own record and stays.
- **Two switches in `facts.yaml`:** `estimate.callback` finishes "One of us will call you ..." (blank says "soon"). `estimate.showBallpark: true` shows a rough price range after someone sends their name and number, and only then is the page called "Instant estimate". The name follows what the page gives.

## The assistant

At `/ask/`, a page (never a pop-up). One request to the Claude API per question, from a server function (`src/server/assistant/`). Model: `ASSISTANT_MODEL`, default `claude-opus-5-5`, low effort, with the server-side refusal fallback on.

- **It knows only** the facts file (blank facts left out, and it's told which facts we don't have) and the published help center.
- **It says it's automated**, says when it doesn't know, and offers to book or call. It can start a booking: what it learned about the roof is carried into the booking form (never names, numbers or addresses).
- **Every reply passes a code check** of the house rules before anyone sees it (`src/server/assistant/guard.ts`): no prices beyond the facts, no insurance promises, no claim handling, no deductible offers, no credentials, ratings or years in business we can't back up, no "I'm a person", no "you're booked", and only phone numbers, links and percentages we know. A reply that fails is replaced with "call us" and shows up in the owner app's question list.
- **The same check runs over every built page** (`npm run test:content`).
- **Live tests** (`npm run test:assistant`, needs `ANTHROPIC_API_KEY`): the top 30 questions and 15 attempts to break the rules. A separate workflow runs them when the facts, the help center or the assistant change, once the repository has the key as a secret.

## Design

One small system, in [`src/styles/global.css`](src/styles/global.css): type, color, space, buttons, cards, rows and forms. Every page is built from it.

- **Type.** Fraunces for headings, Figtree for everything else. Both are open source (SIL Open Font License) and served from this site, not from a font service; the license files sit next to the fonts in `src/assets/fonts/`. System fonts sized to match show until they load, so the page doesn't jump.
- **Color.** From the logo: blue `#268EBC` and sea green `#80BBAE`. Both are too light for small text, so text, links and buttons use a deeper blue. Warm paper background, white cards, deep ocean for the dark sections. One light design for every visitor: the site does not switch to dark colors when a phone is set to dark mode (JT's call). Every text pair is checked for WCAG AA contrast by the end-to-end tests.
- **Icons.** A small set from [Lucide](https://lucide.dev) (ISC license), kept in `src/icons/data.ts`. To add one: add its name in `scripts/build-icons.mjs`, then `npm install --no-save lucide-static && node scripts/build-icons.mjs`.
- **Page parts.** `Header` (stays in view; a phone gets a menu sheet), `PageHero` (the top of every inner page), `BookCall` (the closing section), `StickyCta` (a Book and Call bar on phones once the page's own buttons scroll away), `Footer`. Booking and the private link use a quiet header and a short footer (`focus` on the layout), so nothing pulls people out of the form.
- **Flows.** `src/styles/booking.css` styles booking, the private link, the estimate page and the assistant; `src/styles/owner.css` the owner app.
- **Motion.** Short and small, and off for anyone whose device asks for reduced motion.
- **No inline styles.** The site's content security policy blocks `style=""` attributes; use a class.

## Test

```sh
npm test                                   # unit tests: facts, help center, house rules, the rule check
npm run test:content                       # every built page keeps the house rules (after a build)
npm run db:local && npm run test:db        # database: capacity, two people racing for one spot, row level security
npm run build:test && npm run test:e2e     # Playwright at 320px and 390px (one phone set to dark mode: the site must stay light), with axe: booking, estimate requests, manage link, owner app
FORCE_INDEXABLE=1 npm run build:node && npm run lhci   # Lighthouse, phone settings, 95+ required; three runs a page, judged on the middle one
node scripts/lighthouse-summary.mjs        # what Lighthouse measured, one line per page
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
| `src/estimate/` | The estimate page (Preact) |
| `src/owner/` | The owner app (Preact) |
| `src/assistant/`, `src/server/assistant/` | The assistant page, its prompt and the rule check |
| `src/server/` | Server code: database, booking, estimate requests, the owners' roof sheet, maps, storage |
| `src/pages/api/` | Server endpoints |
| `supabase/migrations/` | Database schema |
| `src/pages/` | Pages (one file per URL) |
| `src/components/`, `src/layouts/` | Shared pieces |
| `src/styles/global.css` | The design system: type, color, buttons, cards, forms |
| `src/styles/booking.css`, `src/styles/owner.css` | Booking and the other flows; the owner app |
| `src/assets/fonts/`, `src/icons/` | The two typefaces and the icon set |
| `tests/unit/`, `tests/e2e/` | Tests |

See [`STATUS.md`](STATUS.md) for what's done and what's next, and [`LAUNCH.md`](LAUNCH.md) for what's left before launch.
