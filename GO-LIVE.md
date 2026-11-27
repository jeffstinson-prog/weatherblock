# Going live, step by step

Do the steps in this order, on a computer. Some of these screens are hard to use on a phone.

Keys and passwords go into Netlify or Supabase, pasted in by you. Never paste them into our chat, a text or an email.

| Step | What it turns on | Time |
| --- | --- | --- |
| 0. Site address | Done November 24 | |
| 1. Email | Confirmations to customers, and an email to you for every booking and estimate request | 20 minutes, plus up to an hour for a check |
| 2. Sign-in email | The 6-digit code you sign in to the owner app with | 10 minutes |
| 3. Owners | You and Justin in the owner app | 10 minutes |
| 4. Texts | Texts to customers who ask for them, and to you | 30 minutes of forms, then a few days for approval |
| 5. Calendar | Bookings on your Google Calendar, and anything busy there blocks those times | 20 minutes |
| 6. Open times | Your real hours, days off, and how many inspections at once | 10 minutes |
| 7. Go live | Production mode, test data cleared, search engines let in | 15 minutes |

Before the storm: 1, 2, 3, 5 and 6. Start the forms in step 4 the same day, because approval takes days. Until texts are approved, email tells you about every request.

## Where things stand

- The site is live at weatherblockroofingnc.com, and `SITE_URL` is set.
- It saves every booking and estimate request, but sends nothing yet. **Nobody hears about a booking until step 1 is done, so don't share the link before then.**
- Customers can pick any window Monday to Saturday, 8 am to 4 pm, for the next 3 weeks, Thanksgiving included. That's the starting schedule, with no calendar connected. Steps 5 and 6 replace it with yours.

## Step 1. Email (Resend)

1. Go to **resend.com** and click **Sign up**. Use weatherblockroofing@gmail.com, and confirm the email Resend sends you.
2. In Resend, click **Domains** on the left, then **Add domain**.
3. Type `weatherblockroofingnc.com`. Region: **North Virginia (us-east-1)**. Click **Add** (it may say **Add domain**).
4. Resend shows a list of DNS records. Keep this tab open.
5. In a new tab, go to **app.netlify.com**. In the left menu, click **Domains** (the team's list, not inside the project). Click **weatherblockroofingnc.com**.
6. Find **DNS records** and click **Add new record**. Add each record from Resend's list, one at a time:
   - **Record type**: the type Resend shows (MX or TXT).
   - **Name**: only the first part. For `send.weatherblockroofingnc.com`, type `send`. For `resend._domainkey.weatherblockroofingnc.com`, type `resend._domainkey`.
   - **Value**: click Resend's copy button, then paste. Don't retype it.
   - **Priority** (MX only): the number Resend shows, usually `10`.
   - Leave **TTL** as it is, and click **Save**.

   Resend's list is usually these three:

   | Type | Name | Value | Priority |
   | --- | --- | --- | --- |
   | MX | `send` | like `feedback-smtp.us-east-1.amazonses.com` | 10 |
   | TXT | `send` | like `v=spf1 include:amazonses.com ~all` | |
   | TXT | `resend._domainkey` | a long key starting `p=` | |

   If yours shows other records, add those the same way.
7. Add one more record the same way, for Gmail and Yahoo: **Record type** `TXT`, **Name** `_dmarc`, **Value** `v=DMARC1; p=none;`.
8. Back in Resend, click **Verify DNS Records** (it may just say **Verify**). It usually turns green within 15 minutes. Carry on meanwhile.
9. In Resend, click **API Keys** on the left, then **Create API Key**.
   - Name: `website`
   - Permission: **Sending access**
   - Domain: `weatherblockroofingnc.com`

   Click **Add**. Copy the key (it starts with `re_`). Resend shows it only once.
10. In Netlify, open the project **heartfelt-profiterole-59a6a3**. Click **Project configuration** (it may say **Site configuration**), then **Environment variables**, then **Add a variable**, then **Add a single variable**.
    - **Key**: `RESEND_API_KEY`
    - Tick **Contains secret values**.
    - Choose **Different value for each deploy context**. Paste the key into **Production** only, and leave the rest empty. Test copies of the site then stay quiet.
    - Click **Create variable**.
11. Click **Deploys** in the left menu, then **Trigger deploy**, then **Deploy project** (it may say **Deploy site**). Wait about 2 minutes, until it says **Published**.
12. Test it once Resend shows the domain as verified. On your phone, book a made-up inspection at weatherblockroofingnc.com/book/ with your real mobile and email. Within a minute you get the confirmation, and weatherblockroofing@gmail.com gets the new booking alert. Cancel it from the link in the confirmation.

Good to know:

- Emails come from "WeatherBlock Roofing" at bookings@weatherblockroofingnc.com. Replies go to weatherblockroofing@gmail.com.
- From now on the site emails whatever address is typed. When you test, use your own.
- Resend's free plan sends 100 emails a day. A booking uses about 4 (the confirmation, an alert to each of you, a reminder), so that covers about 25 bookings a day. If the storm brings more, upgrade to Resend's Pro plan before it hits (about $20 a month; check the price in Resend). Once the day's 100 are used, nothing is emailed until the next day.

## Step 2. The owner app's sign-in email (10 minutes, after step 1)

1. In Resend, **API Keys**, **Create API Key**. Name: `supabase sign-in`. Permission: **Sending access**. Domain: `weatherblockroofingnc.com`. Click **Add**, and copy it.
2. Go to **supabase.com/dashboard** and open the project **WeatherBlock Roofing**.
3. Click **Authentication** in the left menu, then **Emails**, then the **SMTP Settings** tab.
4. Turn on **Enable Custom SMTP**, and fill in:
   - **Sender email**: `signin@weatherblockroofingnc.com`
   - **Sender name**: `WeatherBlock Roofing`
   - **Host**: `smtp.resend.com`
   - **Port number**: `465`
   - **Username**: `resend`
   - **Password**: the key from 1

   Click **Save changes**.
5. Click the **Templates** tab, then **Magic Link**. Replace what's there:
   - **Subject**: `Your sign-in code`
   - **Body**: `Your sign-in code is {{ .Token }}. If you didn't ask for it, ignore this email.`

   Click **Save changes**.

## Step 3. You and Justin as owners (10 minutes, after step 2)

1. In Supabase, click **Authentication**, then **Users**. Click **Add user**, then **Create new user**. Type your email and any password (you won't use it), tick **Auto Confirm User**, and click **Create user**. Do the same for Justin.
2. Click **SQL Editor** in the left menu, then **New query**. Paste this, put in your two emails and mobiles, and click **Run**.

   ```sql
   insert into wb.owners (user_id, name, email, mobile)
   select u.id, o.name, u.email, o.mobile
   from (values
     ('JT Stinson',    'JT-EMAIL-HERE',     '+19100000000'),
     ('Justin Coffey', 'JUSTIN-EMAIL-HERE', '+19100000000')
   ) as o (name, email, mobile)
   join auth.users u on lower(u.email) = lower(o.email)
   on conflict (user_id) do update set name = excluded.name, mobile = excluded.mobile, active = true;
   ```

   Write mobiles as +1 and ten digits, no spaces or dashes. It should say 2 rows. If it says 0, the emails don't match the users from 1. Running it again is safe.
3. On your phone, open **weatherblockroofingnc.com/app/**. Type your email, tap **Email me a code**, and type the code from the email.
4. In the app, tap **More** and scroll to **Your alerts**. Check your mobile, and that **Email me too** is ticked. Tap **Save alerts**.
5. Add the app to your home screen. iPhone, in Safari: tap the Share button, then **Add to Home Screen**. Android, in Chrome: tap the menu, then **Add to Home screen**.
6. On your phone, turn on notifications for the email account your alerts go to. Until texts are approved, that email is what pings you.

From here on, alerts go to your and Justin's own emails instead of weatherblockroofing@gmail.com.

If the code doesn't arrive within a minute, check spam. Still nothing: in Supabase, change the port in step 2 to `587` and try again.

## Step 4. Texts (Twilio)

Rough costs, to check in Twilio before you pay: the number about $1.15 a month; registration about $19.50 once ($4.50 for the brand, $15 for the campaign review); the campaign $1.50 a month; each text about a cent.

1. Go to **twilio.com**, click **Sign up**, and use weatherblockroofing@gmail.com. Verify the email and your mobile when Twilio asks.
2. Click **Upgrade** at the top of the Console and add a card. A trial account only texts numbers you've verified, and adds a trial notice to every text.
3. Buy a number. In the left menu: **Phone Numbers**, **Manage**, **Buy a number**. Country: United States. Number: `910`. Tick **SMS**. Click **Search**, then **Buy** next to one you like.
4. Make the Messaging Service. In the left menu: **Messaging**, **Services**, **Create Messaging Service**.
   - Name: `WeatherBlock texts`. For what it's for, pick **Notify my users** (or the closest). Click **Create Messaging Service**.
   - **Add Senders**: sender type **Phone Number**, tick your new number, click **Add Phone Numbers**.
   - **Set up integration**: under **Incoming Messages**, choose **Send a webhook**. **Request URL**: `https://weatherblockroofingnc.com/api/twilio/sms`, method **HTTP POST**. Replies to your number then show in the owner app, and STOP and START work.
   - Skip the compliance step here. It's 6, below.
5. In the service, open **Opt-Out Management** and set the HELP reply to: `WeatherBlock Roofing: appointment texts. For help call (910) 209-5275. Reply STOP to opt out.`
6. Register with the carriers. In the left menu: **Messaging**, **Regulatory Compliance**, **Onboarding** (it may say **A2P 10DLC**). Twilio walks you through three parts:
   - **Customer profile**: WeatherBlock Roofing Incorporated, its EIN, corporation, the principal office address on file with the NC Secretary of State, website `https://weatherblockroofingnc.com`, and you or Justin as the contact.
   - **Brand**: **Low-Volume Standard** (under 6,000 texts a day; it skips the extra vetting fee).
   - **Campaign**: use case **Low Volume Mixed**. Link it to the **WeatherBlock texts** Messaging Service. Paste these into the boxes:

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
7. When Twilio emails that the campaign is approved (usually a few days), add three variables in Netlify, **Production** only, then **Trigger deploy**:
   - `TWILIO_ACCOUNT_SID`: on the Twilio Console's home page, under **Account Info**.
   - `TWILIO_AUTH_TOKEN`: next to it. Tick **Contains secret values**.
   - `TWILIO_MESSAGING_SERVICE_SID`: on the Messaging Service's page. It starts with `MG`.

   Don't add them before approval: carriers block texts from numbers that aren't registered.
8. Test: in the owner app, **More**, **Your alerts**, tick **Text me when a booking comes in or changes**, and tap **Save alerts**. Send an estimate request on the site with your own name and number. A text reaches you within a minute.

## Step 5. Your calendar (Google)

What it does: every booking shows up on a Google Calendar, and anything marked busy on that calendar blocks those times on the site. The site checks the calendar every 15 minutes.

Which calendar: the one that shows when the inspector is busy. If Justin does the inspections and keeps his appointments in Google Calendar, use his: they then block times on their own. Otherwise, use the calendar of weatherblockroofing@gmail.com and put your blocks there.

**A. A key for the site** (Google Cloud, signed in as weatherblockroofing@gmail.com)

1. Go to **console.cloud.google.com** and sign in with weatherblockroofing@gmail.com. Agree to the terms if asked. No card is needed for this.
2. At the top, click the project list (it may say **Select a project**), then **New project**. Name: `WeatherBlock calendar`. Location: **No organization**. Click **Create**. When it's done, pick it in the project list.
3. In the search box at the top, type `Google Calendar API`. Open it and click **Enable**.
4. In the search box, type `Service accounts` and open it. Click **Create service account**. Name: `website calendar`. Click **Create and continue**, then **Done**. Skip the optional steps.
5. Click the new service account in the list. Open the **Keys** tab. Click **Add key**, then **Create new key**. Choose **JSON** and click **Create**. A file downloads. Treat it like a password.

   If Google says key creation is disabled, the project belongs to an organization that blocks keys. Go back to 2, signed in as weatherblockroofing@gmail.com, and pick **No organization**.

**B. Give the key to the site** (Netlify)

6. Open the downloaded file in a text editor: Notepad on Windows, TextEdit on a Mac. Select all, and copy.
7. In Netlify, the project, **Project configuration**, **Environment variables**, **Add a variable**, **Add a single variable**:
   - **Key**: `GOOGLE_SERVICE_ACCOUNT_KEY`
   - Tick **Contains secret values**.
   - Choose **Different value for each deploy context**, and paste the whole file into **Production** only.
   - Click **Create variable**.
8. In the file, find the line with `"client_email"`. Copy the address after it, between the quotes. It ends in `iam.gserviceaccount.com`.

**C. Share the calendar** (Google Calendar on a computer, signed in as whoever owns the calendar)

9. Go to **calendar.google.com**. On the left, under **My calendars**, point at the calendar, click its three dots, then **Settings and sharing**.
10. Under **Share with specific people or groups**, click **Add people and groups**. Paste the address from 8. Permissions: **Make changes to events**. Click **Send**.
11. Scroll down to **Integrate calendar**, and copy the **Calendar ID**. For someone's main calendar, it's their Gmail address.

Google only lets you change sharing on a computer, not in the phone app.

**D. Tell the site which calendar** (Netlify)

12. Add one more variable: **Key** `GOOGLE_CALENDAR_ID`, **Value** the Calendar ID from 11. It's not a secret: leave **Contains secret values** unticked, and keep **Same value for all deploy contexts**. Click **Create variable**.
13. **Deploys**, **Trigger deploy**, **Deploy project**.
14. Check it: in the owner app, **More**, **Inspection availability**. Under Google Calendar, tap **Sync the calendar now**. The status should say **Connected**. If it says **Problem**, the message under it says what to fix. Without the app yet: put a busy event on the calendar for tomorrow at 10 am, wait 15 minutes, and the 10 to 12 window is gone from the booking page. Then delete the event.

How it works from here:

- Each booking appears on the calendar within 15 minutes, with the address, the customer's name and number, why they booked, and a link to it in the owner app.
- Anything marked **Busy** blocks the windows it overlaps. Anything marked **Free** doesn't, and neither does a meeting you said no to.
- All-day events start as **Free** in Google Calendar. To block a whole day, change the event to **Busy**, or add a day off in step 6.
- Move or cancel bookings in the owner app, not in Google Calendar. The app is what tells the customer. A booking moved or deleted in Google is put back.
- With one inspector, a busy event closes those windows. With two, it takes one of the two.
- So the other partner sees bookings too, share the calendar with them the same way (**See all event details** is enough).

## Step 6. Open times

In the owner app (after step 3): **More**, then **Inspection availability**.

- **Inspectors**: how many inspections can happen in the same window. With 1, each window takes one booking. If you both inspect during the storm, set 2.
- **Minimum notice, in hours**: how soon someone can book. It's 12 now. If you can get out the same day, lower it (3, say).
- **How far ahead people can book**: 21 days now.
- **Windows**: the two-hour arrival windows for each weekday. Remove the ones you don't work, or add some (Sundays, say).
- Tap **Save availability**.
- **Days off**: pick a date, add a note, and tap **Add day off**. Thanksgiving, Thursday November 26, is open right now.

Before step 3 works, you can do the same in Supabase: **SQL Editor**, **New query**, paste the lines you want, and click **Run**.

```sql
-- Thanksgiving off (change the date and note for any other day off)
insert into wb.days_off (day, note) values ('2026-11-26', 'Thanksgiving')
on conflict (day) do update set note = excluded.note;

-- Two inspections at once
update wb.settings set inspectors = 2 where id = 1;

-- Bookable as little as 3 hours ahead
update wb.settings set min_notice_hours = 3 where id = 1;

-- Sundays, 10 am to 4 pm (0 is Sunday, 1 Monday, up to 6 for Saturday)
insert into wb.weekly_windows (weekday, start_time, end_time)
values (0, '10:00', '12:00'), (0, '12:00', '14:00'), (0, '14:00', '16:00')
on conflict (weekday, start_time) do nothing;
```

The site uses each change at once. Bookings already made stay as they are.

## Step 7. Go live

1. **Production mode.** In Netlify, **Environment variables**, click **APP_ENV**, then **Edit** (it may be under the three dots, **Options**). Choose **Different value for each deploy context**. Production: `production`. The others: `preview`. Save, then **Trigger deploy**.
2. **Clear the test data.** In Supabase, **SQL Editor**, **New query**. First, see what would go:

   ```sql
   select 'booking' as kind, ref, name, email, mobile, status, created_at
   from wb.bookings
   where email ilike '%@example.com' or mobile ~ '^\+1[0-9]{3}555' or name ilike '%(test)%'
   union all
   select 'request', ref, name, email, mobile, status, created_at
   from wb.estimate_requests
   where email ilike '%@example.com' or mobile ~ '^\+1[0-9]{3}555' or name ilike '%(test)%'
   order by created_at;
   ```

   That lists the made-up bookings and requests: emails at example.com, 555 numbers, names with "(test)". Your own test bookings from step 1 are real-looking, so cancel those from their links instead. If the list is only test entries, run this to delete them and their messages:

   ```sql
   with test_bookings as (
     select id from wb.bookings
     where email ilike '%@example.com' or mobile ~ '^\+1[0-9]{3}555' or name ilike '%(test)%'
   ), test_requests as (
     select id from wb.estimate_requests
     where email ilike '%@example.com' or mobile ~ '^\+1[0-9]{3}555' or name ilike '%(test)%'
   ), gone_messages as (
     delete from wb.messages
     where booking_id in (select id from test_bookings) or request_id in (select id from test_requests)
     returning 1
   ), gone_requests as (
     delete from wb.estimate_requests where id in (select id from test_requests) returning 1
   ), gone_bookings as (
     delete from wb.bookings where id in (select id from test_bookings) returning 1
   )
   select (select count(*) from gone_bookings) as bookings_deleted,
          (select count(*) from gone_requests) as requests_deleted,
          (select count(*) from gone_messages) as messages_deleted;
   ```

   Run the first one again: it should list nothing.
3. **Supabase plan.** The free plan pauses a project after a quiet week and keeps no daily backups. Before you rely on it, move to Pro (about $25 a month): Supabase, your organization, **Billing**.
4. **Search engines.** Tell me "launch". I switch on search engines (a one-line change) and it goes live when you say merge.
5. **Your Google Business Profile.** Set its website to `https://weatherblockroofingnc.com/?utm_source=google&utm_medium=gbp`, so those bookings show where they came from.
6. **One last check.** Book a real inspection on your phone. You get the email (and the text, once step 4 is approved), it's in the owner app and on the calendar. Then reschedule and cancel it from the link.

Tell me after each step and I'll check it from my side.
