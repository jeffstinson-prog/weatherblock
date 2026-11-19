# Launch checklist

What's left before real customers book. Roughly in order. Anything that costs
money, touches DNS, or texts or emails real people waits for your OK.

## 1. Accounts

Use the business Gmail (weatherblockroofing@gmail.com) as the login where you
can, then add each other, so the business owns every account. Keys go in
Netlify's environment settings (and GitHub secrets for tests), never in the repo.
The full list of settings is in `.env.example`.

- [ ] **GitHub**: the empty private repo, with the Claude GitHub app allowed on it.
- [ ] **Netlify**: add the site from the repo (Add new site, Import from GitHub). It goes in your existing Pro team, no new plan. Deploy previews then appear on every pull request.
- [ ] **Supabase**: a WeatherBlock organization on Pro ($25 a month). Your current Supabase account already has its two free projects.
  - One project for the live site, in us-east-1. A second small project for deploy previews keeps test bookings out of the real calendar (about $10 a month more).
  - Run the migrations in `supabase/migrations/` in order (Supabase CLI `supabase db push`, or paste each into the SQL editor).
  - Authentication: email sign-in on, sign-ups off, and the "Magic link" email template changed to show the 6-digit code (`{{ .Token }}`). Send auth email through Resend (Authentication, SMTP settings); Supabase's built-in email is only for testing.
- [ ] **Resend** (free up to 100 emails a day): verify the domain (DNS, step 4), create an API key.
- [ ] **Twilio**: buy a local 910 number, create a Messaging Service, and point incoming messages at `https://weatherblockroofingnc.com/api/twilio/sms`. Then 10DLC (step 2).
- [ ] **Google Cloud** (needs a card on file; this traffic stays inside the free monthly caps):
  - Turn on Places API (New), Maps Static API and Google Calendar API.
  - A server key limited to Places API (New).
  - A browser key limited to Maps Static API and the site's domains, plus a URL signing secret.
  - A service account for the calendar. Put its email and private key in Netlify. Justin shares his calendar with the service account's email ("Make changes to events") and enters the calendar ID in the owner app (Availability).
- [ ] **Anthropic**: an API key with a monthly spend limit, in Netlify and as the `ANTHROPIC_API_KEY` GitHub secret. Then run the live assistant tests (step 5).
- [ ] **Netlify settings**:
  - Production: `APP_ENV=production` and the live keys.
  - Deploy previews: `APP_ENV=preview`, the preview database and test keys (Twilio test credentials send nothing).
  - Random 32+ character values for `MANAGE_TOKEN_SECRET`, `RATE_LIMIT_SALT` and `CRON_SECRET` (`openssl rand -base64 32`).
  - All variables together must stay under Netlify's 4 KB limit for functions. The Google private key is the big one, about 1.7 KB.
- [ ] **Owners**: `node scripts/add-owner.mjs <email> "<name>" <mobile>` for each of you. Then sign in at `/app/`, check your alert settings, and add the app to your home screen.

## 2. Texts: carrier registration (A2P 10DLC)

US carriers block business texts from unregistered numbers. Registration takes
days to a few weeks and needs the live site, with its privacy and text message
pages, on the real domain. Until it's approved, texts are recorded in the owner
app and not sent; email works from day one.

- [ ] **Brand**: WeatherBlock Roofing Incorporated, EIN, the principal office address on file with the state, website, contact.
- [ ] **Campaign**: "Low volume mixed" (about $1.50 a month), or "Customer care" if Twilio steers you there. One-time fees run about $20 (brand plus vetting).
  - Description: appointment confirmations, reminders, "on my way" and schedule changes for roof inspections customers book online.
  - Sample messages: copy them from `src/server/messaging/templates.ts`.
  - How people opt in: an optional, unchecked box on step 4 of the booking form at `/book/`, with the exact wording shown there. Terms at `/text-messages/`, privacy at `/privacy/`.
  - Opt-out STOP, help HELP.

## 3. Facts (`facts.yaml`)

Each of these is blank or unconfirmed, and the site hides whatever depends on it.

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
- [ ] Availability in the owner app: real windows, inspectors and notice. The starting point is Monday to Saturday, four 2-hour windows from 8 am, one inspector.
- [ ] Acorn: their dealer agreement asks contractors to clear financing wording with them. Send them `/financing/`, and confirm the `d=QP3YO` link is yours.
- [ ] Read every page and help answer once. Justin especially: materials, repair or replace, storm damage.
- [ ] Have your attorney read `/privacy/` and `/terms/`.

## 4. Moving the domain off the temp site (DNS: I'll ask before each change)

Today `weatherblockroofingnc.com` is registered at Namecheap, which also runs
its DNS. The domain points at the temp site, and Namecheap's email forwarding
is on (the MX and SPF records). Keep the email forwarding.

- [ ] In Netlify, add the custom domain (`weatherblockroofingnc.com` and `www`).
- [ ] At Namecheap, point the bare domain and `www` at Netlify, per Netlify's instructions at the time. Leave the MX and SPF records alone.
- [ ] Add Resend's DNS records (DKIM, and the `send` subdomain's records).
- [ ] Wait for Netlify's HTTPS certificate, then set `SITE_URL=https://weatherblockroofingnc.com`.
- [ ] Remove the domain from the temp site's builder.
- [ ] Point the Google Business Profile's website link at `https://weatherblockroofingnc.com/?utm_source=google&utm_medium=gbp`, so those bookings show where they came from.

## 5. Launch day

- [ ] Set `web.launched: true` in `facts.yaml`. Search engines are kept out until then.
- [ ] On your phone, book a real inspection. Get the text and the email, see it in the owner app and on Justin's calendar, then reschedule and cancel from the link.
- [ ] Run `npm run test:assistant`, read the answers, and fix any help answer it stumbles on.
- [ ] Add the site to Google Search Console and submit `/sitemap-index.xml`.

## Monthly cost, roughly

| | |
| --- | --- |
| Netlify | in your Pro team, no new plan |
| Supabase | $25, plus about $10 for a preview project |
| Twilio | about $12 at 100 bookings a month |
| Resend | $0 (free up to 100 a day; $20 if a storm rush goes past that) |
| Google Maps and Calendar | $0 under the free caps |
| Claude API | about 10 cents a conversation on Opus 5.5 |

## After launch (from the brief)

- Inspection report: the inspector uploads photos and findings from a phone, and the customer gets a private link.
- Roof size from aerial data with a price range, once Justin gives per-square pricing. Check the data provider's terms first.
- Opt-in storm alerts by text.
