# Email and texts: setup

What this turns on:

- **Email (Resend):** booking confirmations and reminders, estimate emails, alerts to you about every booking and estimate request, and the 6-digit code you sign in to the owner app with.
- **Texts (Twilio):** the same for customers who tick the texts box when they book, and text alerts to you.

Until each key is in, the site saves every message and shows it in the owner app, but sends nothing.

Do the steps in order. Steps 0 to 3 take about an hour and work the same day. Step 4 (texts) takes about 30 minutes of forms, then the phone carriers' approval, usually under a week.

Keys and passwords go into Netlify or Supabase, typed in by you. Never paste them into our chat or an email.

## Step 0. The domain (5 minutes)

The domain points at the new site: its DNS is on Netlify, and it's the site's main address. On November 24 it worked: every page loads securely, www goes to the main address, and the roof pictures show.

1. Netlify, project `heartfelt-profiterole-59a6a3`: **Site configuration**, **Environment variables**, **Add a variable**: `SITE_URL` = `https://weatherblockroofingnc.com`. Links in emails and texts, and the check on replies to our number, use it.
2. **Deploys**, **Trigger deploy**, **Deploy site**. A new variable only takes effect after a deploy.

The new site is now what people see at your address. It's still in test mode (hidden from Google), and nobody hears about a booking until step 1 is done. So do step 1 soon.

Mail to any @weatherblockroofingnc.com address stopped arriving when the DNS moved (there are no mail records now). The site and its messages use weatherblockroofing@gmail.com, so nothing here depends on it. If you or Justin used such an address, tell me: a free forwarding service can bring it back with one more record.

## Step 1. Resend: email (about 20 minutes, plus waiting for the check)

1. Go to resend.com and sign up with weatherblockroofing@gmail.com. The free plan covers 100 emails a day, 3,000 a month.
2. **Domains**, **Add domain**: `weatherblockroofingnc.com`, region North Virginia (us-east-1).
3. Resend lists DNS records. Add each one in **Netlify** (your DNS lives there now, not at Namecheap): Netlify, **Domains** (in the team menu), `weatherblockroofingnc.com`, **DNS records**, **Add new record**.

   | Type | Name | Value | Priority |
   | --- | --- | --- | --- |
   | MX | `send` | the value Resend shows (like `feedback-smtp.us-east-1.amazonses.com`) | 10 |
   | TXT | `send` | the value Resend shows (like `v=spf1 include:amazonses.com ~all`) | |
   | TXT | `resend._domainkey` | the long key Resend shows, copied exactly | |
   | TXT | `_dmarc` | `v=DMARC1; p=none;` | |

   Type only the part before the domain in the Name box: `send`, not `send.weatherblockroofingnc.com`. The last record is optional but recommended: Gmail and Yahoo look for it.
4. Back in Resend, click **Verify DNS Records**. It usually turns green within 15 minutes; it can take up to 72 hours.
5. **API Keys**, **Create API key**: name `website`, permission **Sending access**, domain `weatherblockroofingnc.com`. Copy it; Resend shows it once.
6. Netlify, the project, **Site configuration**, **Environment variables**, **Add a variable**:
   - Key `RESEND_API_KEY`, the value you copied, tick **Contains secret values**.
   - Deploy contexts: **Production** only, so test previews stay quiet.
7. **Deploys**, **Trigger deploy**, **Deploy site**.
8. Test: book a made-up inspection at https://weatherblockroofingnc.com/book/ with your own email. The confirmation should arrive within a minute. Cancel it from the link in that email.

Emails come from "WeatherBlock Roofing" at bookings@weatherblockroofingnc.com, and replies go to weatherblockroofing@gmail.com. Nothing to set up for either.

Once the key is in, the site sends real emails to whatever address is typed. While testing, use only your own addresses.

## Step 2. The owner app's sign-in email (10 minutes, after step 1)

1. Resend, **API Keys**, **Create API key**: name `supabase sign-in`, **Sending access**, the same domain. Copy it.
2. Supabase, project WeatherBlock Roofing: **Authentication**, **Emails**, **SMTP Settings**. Turn on custom SMTP:
   - Sender email: `signin@weatherblockroofingnc.com`
   - Sender name: `WeatherBlock Roofing`
   - Host: `smtp.resend.com`
   - Port: `465` (if codes don't arrive, try `587`)
   - Username: `resend`
   - Password: the key from 1

   Save. (Resend can also fill these in for you: Resend, **Integrations**, **Supabase**.)
3. **Authentication**, **Emails**, **Templates**, **Magic Link**:
   - Subject: `Your sign-in code`
   - Body: `Your sign-in code is {{ .Token }}. If you didn't ask for it, ignore this email.`

   Save.

## Step 3. Add you and Justin as owners (5 minutes, after step 2)

1. Supabase, **Authentication**, **Users**, **Add user**, **Create new user**: your email, any password (you won't use it), and tick **Auto Confirm User**. Then the same for Justin.
2. Supabase, **SQL Editor**. Paste this, put in your name, mobile and email, and click **Run**. Then run it again with Justin's.

   ```sql
   insert into wb.owners (user_id, name, email, mobile)
   select id, 'JT Stinson', email, '+19105551234' from auth.users where email = 'you@example.com'
   on conflict (user_id) do update set name = excluded.name, mobile = excluded.mobile, active = true;
   ```

   Write the mobile as +1 and ten digits, no spaces.
3. Sign in at https://weatherblockroofingnc.com/app/ with your email: a 6-digit code arrives. In **More**, **Your alerts**, check your mobile, and that **Email me** is on. Add the app to your home screen.
4. Turn on notifications for that email account on your phone. Until texts are approved (step 4), the alert email is what pings you about a new request.

## Step 4. Twilio: texts (about 30 minutes of forms, then carrier approval)

Rough costs, to check in Twilio before you pay: the number about $1.15 a month; registration about $19.50 once ($4.50 for the brand, $15 for the campaign review); the campaign $1.50 a month; each text about a cent.

1. Go to twilio.com and sign up with weatherblockroofing@gmail.com. **Upgrade** the account (add a card): a trial account only texts numbers you verify, and adds a trial notice to every text.
2. **Phone Numbers**, **Buy a number**: United States, area code 910, with SMS.
3. **Messaging**, **Services**, **Create Messaging Service**: name `WeatherBlock texts`.
   - Add the new number to its **Sender Pool**.
   - **Integration**, incoming messages: **Send a webhook**, Request URL `https://weatherblockroofingnc.com/api/twilio/sms`, method POST. Replies to the number then show in the owner app, and STOP and START are honored.
   - **Opt-Out Management**: set the HELP reply to: `WeatherBlock Roofing: appointment texts. For help call (910) 209-5275. Reply STOP to opt out.`
4. **A2P 10DLC registration** (Messaging, Regulatory Compliance). Do this after step 0: the reviewer opens your website, and it has to load with HTTPS and show the privacy and text message pages.
   - **Business profile:** WeatherBlock Roofing Incorporated, its EIN, corporation, the principal office address on file with the NC Secretary of State, website https://weatherblockroofingnc.com, and you or Justin as the contact.
   - **Brand:** Low-Volume Standard (under 6,000 texts a day; it skips the extra vetting fee).
   - **Campaign:** use case **Low Volume Mixed**. The boxes, ready to paste:

   **Campaign description**
   > Appointment texts for customers who book a roof inspection on our website and opt in: booking confirmations, reminders, an "on my way" note, schedule changes, a note when their estimate is ready, and for roof work they agree to, the scheduled day, a reminder and weather changes. Also alerts to the business's two owners about new bookings and estimate requests. No marketing.

   **Message flow (how people opt in)**
   > Customers opt in on our booking form at https://weatherblockroofingnc.com/book/, step 4 "Your details", with an optional checkbox that is unchecked by default. Booking works without it. The checkbox text: "Text me about my inspection, my estimate and any roof work I go ahead with. WeatherBlock Roofing will send confirmations, reminders and updates, up to 12 messages per booking. Message and data rates may apply. Reply STOP to opt out, HELP for help. Texting is optional." Terms: https://weatherblockroofingnc.com/text-messages/. Privacy: https://weatherblockroofingnc.com/privacy/. The two owners turn on text alerts for themselves in our owner app.

   **Sample messages** (paste three to five)
   > WeatherBlock Roofing: you're booked for Tue, Dec 1, 8 to 10 am. Ref K7M-3QX. Change or cancel: https://weatherblockroofingnc.com/b/#Q8xT2... Reply STOP to opt out.

   > WeatherBlock Roofing: reminder, we'll be at your home tomorrow between 8 and 10 am. Change or cancel: https://weatherblockroofingnc.com/b/#Q8xT2...

   > WeatherBlock Roofing: Justin is on the way. About 20 minutes.

   > WeatherBlock Roofing: your estimate is ready. See it and let us know what you'd like to do: https://weatherblockroofingnc.com/b/#Q8xT2...

   > WeatherBlock Roofing: your roof job is set for Tue, Dec 8. We'll text you the day before. Questions: (910) 209-5275.

   **Other answers:** opt-in keyword START, opt-out STOP, help HELP. Embedded links: yes. Phone numbers: yes. Age-gated content: no. Direct lending: no.
5. When the campaign is approved, add three variables in Netlify (**Production** only), then **Trigger deploy**:
   - `TWILIO_ACCOUNT_SID`: on the Twilio console's home page.
   - `TWILIO_AUTH_TOKEN`: next to it; tick **Contains secret values**.
   - `TWILIO_MESSAGING_SERVICE_SID`: the Messaging Service's ID, starting with MG.

   Don't add them before approval: the carriers block texts from numbers that aren't registered.
6. Test: in the owner app, **More**, **Your alerts**, turn on **Text me**. Send an estimate request on the site with your own name and number: a text should reach you within a minute.

## When you're done

Tell me after each step. I'll check that emails arrive, the sign-in works, a test request reaches you, and texts go out, and I'll clear out the test bookings before launch.
