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

Supabase Postgres. The schema is in [`supabase/migrations/`](supabase/migrations/), applied in order.

- `wb` holds the tables. The public can't read them.
- `wb_api` holds the only functions the public can call: open windows, book, the manage link.
- Capacity is enforced by the database: booking locks the window's row before counting, so a window can never be overbooked, even when two people book at the same moment.
- Owners read and write through row level security.

Tests run the same migrations on plain Postgres 16 or newer, with a few stand-ins for what Supabase provides ([`supabase/test-shim.sql`](supabase/test-shim.sql)).

## Texts and email

Email goes through Resend, texts through Twilio. Every message is written to `wb.messages` first, then sent.

- **No keys, no sending.** Without `RESEND_API_KEY` or the Twilio keys, messages are recorded as `logged` and never leave. The confirmation screen only says "we emailed" or "we texted" when one really went out.
- **Customer:** confirmation (email always, text if they agreed), a reminder 6 to 9 pm the evening before and from 7:30 am the morning of, "on my way", and a note when the time changes or is cancelled.
- **Owners:** a text and an email for every new, moved or cancelled booking. Until owners are set up in the app, alerts go to the business email in `facts.yaml`.
- **Replies to our number** are kept, STOP and START are honored, and every reply is forwarded to the owners. Point the Twilio number's incoming webhook at `https://<site>/api/twilio/sms`.
- **Every 15 minutes** `netlify/functions/every-15-minutes.mts` calls `/api/jobs` with `CRON_SECRET`: reminders, retries of failed messages, clean-up (gate codes after a week, unused photo uploads after two days).

## Test

```sh
npm test                                   # unit tests: facts, help center, house rules
npm run db:local && npm run test:db        # database: capacity, two people racing for one spot, row level security
npm run build:node && npm run test:e2e     # Playwright at 320px and 390px, light and dark, with axe accessibility checks
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
| `src/server/` | Server code: database, booking, maps, storage |
| `src/pages/api/` | Server endpoints |
| `supabase/migrations/` | Database schema |
| `src/pages/` | Pages (one file per URL) |
| `src/components/`, `src/layouts/` | Shared pieces |
| `src/styles/global.css` | Colors from the logo, type, buttons, forms |
| `tests/unit/`, `tests/e2e/` | Tests |

See [`STATUS.md`](STATUS.md) for what's done and what's next.
