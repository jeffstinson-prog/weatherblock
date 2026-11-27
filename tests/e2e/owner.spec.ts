// The owner app on a phone: sign in with an emailed code, work a booking,
// availability, referral codes, the CSV export. Supabase Auth is stood in
// for by intercepting its requests; the server checks real signed tokens.
import { expect, test, type Page } from '@playwright/test';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { expectAccessible, expectNoSideScroll } from './helpers';

const DB = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/wb_e2e';
const SECRET = process.env.SUPABASE_JWT_SECRET ?? 'e2e-only-jwt-secret-0123456789abcdef';
const OWNER = '6f1c2d4e-0000-4000-8000-00000000a001';
const EMAIL = 'justin@example.com';

test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone-320', 'owner app runs once, on the smallest phone');
});

let bookingDate = '';
let ref = '';

test.beforeAll(async ({ request }) => {
  const sql = postgres(DB);
  await sql`insert into auth.users (id, email) values (${OWNER}, ${EMAIL}) on conflict (id) do nothing`;
  await sql`insert into wb.owners (user_id, name, email, mobile) values (${OWNER}, 'Justin Coffey', ${EMAIL}, '+19105550111') on conflict (user_id) do nothing`;
  await sql.end();
  // A booking to work with, made the way a customer would.
  const { slots } = (await (await request.get('/api/slots')).json()) as { slots: { id: string; startsAt: string }[] };
  const slot = slots[slots.length - 1]!;
  const res = await request.post('/api/bookings', {
    data: {
      draftKey: crypto.randomUUID(),
      startedAt: Date.now() - 60_000,
      address: { text: '202 Test Causeway Rd, Ocean Isle Beach, NC 28469', typed: true },
      relationship: 'owner',
      roof: { material: 'shingle', age: '15-20', reason: 'storm', notes: 'Shingles in the yard' },
      slotId: slot.id,
      visit: { someoneHome: 'yes', gateCode: 'GATE77', pets: 'Cat indoors' },
      contact: { name: 'Riley Owner', mobile: '910 555 7777', email: 'riley@example.com', smsConsent: true },
    },
  });
  expect(res.status()).toBe(201);
  ref = ((await res.json()) as { booking: { ref: string } }).booking.ref;
  bookingDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(slot.startsAt));
});

async function session() {
  const now = Math.floor(Date.now() / 1000);
  const access = await new SignJWT({ role: 'authenticated', email: EMAIL, aud: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(OWNER)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(new TextEncoder().encode(SECRET));
  const user = { id: OWNER, aud: 'authenticated', role: 'authenticated', email: EMAIL, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'refresh-token', user };
}

async function signIn(page: Page) {
  let codeRequested = false;
  await page.route('https://test-project.supabase.co/auth/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/otp')) {
      codeRequested = true;
      return route.fulfill({ status: 200, json: {} });
    }
    if (path.endsWith('/verify') || path.endsWith('/token')) return route.fulfill({ status: 200, json: await session() });
    if (path.endsWith('/user')) return route.fulfill({ status: 200, json: (await session()).user });
    if (path.endsWith('/logout')) return route.fulfill({ status: 204, body: '' });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/app/');
  await expect(page.getByRole('heading', { name: 'Owner sign-in' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter your email address');
  await page.getByLabel('Your email').fill(EMAIL);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
  expect(codeRequested).toBe(true);
  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.home-hello h1')).toHaveText(/^Good (morning|afternoon|evening), Justin$/);
}

test('the owner API refuses anyone who is not signed in', async ({ request }) => {
  expect((await request.get('/api/owner/day')).status()).toBe(401);
  expect((await request.get('/api/owner/day', { headers: { authorization: 'Bearer nonsense' } })).status()).toBe(401);
});

test('sign in, then work a booking from a phone', async ({ page }) => {
  await signIn(page);
  await expectAccessible(page);
  await page.goto(`/app/#/day/${bookingDate}`);
  const card = page.locator('.visit', { hasText: '202 Test Causeway Rd' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('link', { name: 'Directions' })).toHaveAttribute('href', /google\.com\/maps\/dir/);
  await expect(card.getByRole('link', { name: /Call Riley Owner/ })).toHaveAttribute('href', 'tel:+19105557777');
  await expectNoSideScroll(page);
  await expectAccessible(page);

  await card.locator('.visit-main').click();
  await expect(page.getByRole('heading', { name: '202 Test Causeway Rd, Ocean Isle Beach, NC 28469' })).toBeVisible();
  await expect(page.locator('.kv').getByText(ref.slice(0, 3) + '-' + ref.slice(3))).toBeVisible();
  await page.getByRole('button', { name: 'Show gate code' }).click();
  await expect(page.getByText('GATE77')).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('textbox', { name: 'Your notes' }).fill('Bring the 32 foot ladder');
  await page.getByRole('button', { name: 'Save notes' }).click();
  await expect(page.getByRole('status')).toHaveText('Notes saved.');

  await page.getByRole('button', { name: '20 min' }).click();
  await expect(page.getByRole('status')).toHaveText('Sent: on the way, about 20 minutes.');

  await page.getByRole('button', { name: 'Pick a new time' }).click();
  // The last open day: the booking tests use the first days, so the two never compete.
  // Only the first six days show at first; the rest are one tap away, and focus lands on the next day.
  await page.getByRole('button', { name: 'Show more days' }).click();
  await expect(page.locator('.days .day').nth(6)).toBeFocused();
  await page.locator('.days .day').last().click();
  await page.locator('input[name="slot"]').first().check();
  await page.getByRole('button', { name: 'Move it' }).click();
  await expect(page.getByRole('status')).toContainText('Moved to');

  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Marked done.');
  await expect(page.locator('.lead-line .chip')).toHaveText('Done');

  await page.getByText(/^Messages \(/).click();
  await expect(page.locator('.log').first()).toContainText('is on the way');
  await expectNoSideScroll(page);
});

test('estimate requests: who to call, the roof sheet, and booking a time for them', async ({ page, request }) => {
  const { place } = (await (await request.post('/api/places/details', { data: { placeId: 'test-oib-1', sessionToken: 's' } })).json()) as { place: object };
  const res = await request.post('/api/estimate-requests', {
    data: {
      key: crypto.randomUUID(),
      startedAt: Date.now() - 60_000,
      address: place,
      contact: { name: 'Quinn Caller', mobile: '910 555 4301', email: '' },
      source: { utm: { source: 'google', medium: 'cpc' } },
    },
  });
  expect(res.status(), await res.text()).toBe(201);

  // Home starts with the people to call, and when the call is promised by.
  await signIn(page);
  const card = page.locator('.call-card', { hasText: 'Quinn Caller' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('link', { name: 'Call (910) 555-4301, Quinn Caller' })).toHaveAttribute('href', 'tel:+19105554301');
  await expect(card).toContainText('Ballpark $10,100 to $11,700.');
  await expect(card.locator('.promise')).toHaveText(/\d+ (min|hr) (left|late)/);
  await expect(card).toContainText(/call by \d/);
  await expectAccessible(page);
  await expectNoSideScroll(page);

  // One request: the roof from above, a ballpark only the owners see, and where they came from.
  await card.getByRole('link', { name: 'Quinn Caller', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Quinn Caller', level: 1 })).toBeVisible();
  await expect(page.locator('.roof-sheet')).toContainText('About 2,250 square feet, 22.5 squares');
  await expect(page.locator('.roof-sheet')).toContainText('$10,100 to $11,700');
  await expect(page.locator('.kv').getByText('google_cpc')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Text them the booking link' })).toHaveAttribute('href', /^sms:\+19105554301\?&body=.*estimate%2Fbook%2F%23r%3D/);
  await expectAccessible(page);
  await expectNoSideScroll(page);

  await page.getByRole('button', { name: 'Mark called' }).click();
  await expect(page.getByRole('status')).toHaveText('Marked called.');
  await expect(page.locator('.lead-line .chip')).toHaveText('Called');

  await page.getByRole('button', { name: 'Close it' }).click();
  await page.getByLabel('Why?').selectOption('Not interested');
  await page.getByRole('button', { name: 'Close the request' }).click();
  await expect(page.getByRole('status')).toHaveText('Closed.');
  await expect(page.getByText('Closed: Not interested.')).toBeVisible();
  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByRole('status')).toHaveText('Reopened.');

  await page.getByRole('link', { name: 'Back to requests' }).click();
  await expect(page.getByRole('heading', { name: 'Estimate requests', level: 1 })).toBeVisible();
  const row = page.locator('.visit', { hasText: 'Quinn Caller' });
  await expect(row).toBeVisible();
  await expectAccessible(page);
  await expectNoSideScroll(page);

  // Book a time for them: the booking form opens with their address and details in.
  await row.getByRole('link', { name: 'Open' }).click();
  await page.getByRole('button', { name: 'Book a time for them' }).click();
  await expect(page).toHaveURL(/\/estimate\/book\/$/);
  await expect(page.getByRole('heading', { name: 'Book your free estimate', level: 1 })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Address of the home' })).toHaveValue('101 Test Beach Dr W, Ocean Isle Beach, NC 28469');
  await expect(page.getByText('Found it.')).toBeVisible();
  await page.evaluate(() => localStorage.clear());
});

test('home: the numbers, marking a call done from the card, and turning on notifications', async ({ page, request }) => {
  const { place } = (await (await request.post('/api/places/details', { data: { placeId: 'test-oib-1', sessionToken: 's' } })).json()) as { place: object };
  const res = await request.post('/api/estimate-requests', {
    data: { key: crypto.randomUUID(), startedAt: Date.now() - 60_000, address: place, contact: { name: 'Morgan Lead', mobile: '910 555 4302', email: '' } },
  });
  expect(res.status(), await res.text()).toBe(201);
  // A phone that hasn't been asked about notifications yet (headless browsers say "denied" outright).
  await page.addInitScript(() => {
    let permission: NotificationPermission = 'default';
    Object.defineProperty(Notification, 'permission', { get: () => permission });
    Notification.requestPermission = async () => (permission = 'granted');
  });
  await signIn(page);

  const toCall = page.locator('.stat', { hasText: 'To call' }).locator('.stat-n');
  const before = Number(await toCall.textContent());
  expect(before).toBeGreaterThan(0);
  await expect(page.getByRole('navigation', { name: 'At a glance' }).getByRole('link')).toHaveCount(4);

  const card = page.locator('.call-card', { hasText: 'Morgan Lead' });
  await card.getByRole('button', { name: 'Called' }).click();
  await expect(page.locator('.flash')).toHaveText('Morgan Lead marked called.');
  await expect(card).toHaveCount(0);
  await expect(toCall).toHaveText(String(before - 1));

  // Notifications: the card offers them until they're on. Without the server's keys it says so plainly.
  const push = page.locator('.push-card');
  await expect(push.getByRole('heading', { name: 'Get a ping for every new lead' })).toBeVisible();
  await push.getByRole('button', { name: 'Turn on notifications' }).click();
  await expect(push.getByRole('alert')).toHaveText("Notifications aren't set up on the server yet.");
  await expectAccessible(page);
  await expectNoSideScroll(page);

  // The same card lives in More, with the alert settings.
  await page.getByRole('link', { name: 'More' }).click();
  await expect(page.locator('.push-card')).toBeVisible();
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.locator('.home-hello h1')).toBeVisible();
});

test('availability: a day off, and a bad window is refused with a reason', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'More' }).click();
  await page.getByRole('link', { name: 'Inspection availability' }).click();
  await expect(page.getByRole('heading', { name: 'Availability', level: 1 })).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel('Date').fill('2026-12-24');
  await page.getByLabel(/^Note/).fill('Christmas Eve');
  await page.getByRole('button', { name: 'Add day off' }).click();
  await expect(page.getByRole('status')).toHaveText('Day off added.');
  await expect(page.getByText(/Thu, Dec 24: Christmas Eve/)).toBeVisible();
  await page.getByRole('button', { name: /Remove day off 2026-12-24/ }).click();
  await expect(page.getByRole('status')).toHaveText('Day off removed.');

  const sunday = page.getByRole('group', { name: 'Sunday' });
  await sunday.getByRole('button', { name: /Add a window/ }).click();
  await sunday.getByLabel('Sunday window 1 starts').fill('10:00');
  await sunday.getByLabel('Sunday window 1 ends').fill('09:00');
  await page.getByRole('button', { name: 'Save availability' }).click();
  await expect(page.getByRole('alert')).toContainText('ends before it starts');
});

test('referral codes and the CSV export', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'More' }).click();
  await page.getByRole('link', { name: 'Referral codes' }).click();
  await page.getByLabel('Code').fill('beach9');
  await page.getByLabel('Name').fill('Beach Realty');
  await page.getByLabel('Type').selectOption('agent');
  await page.getByRole('button', { name: 'Add code' }).click();
  await expect(page.getByRole('status')).toHaveText('Added BEACH9.');
  await expect(page.getByText('https://weatherblockroofingnc.com/r/BEACH9')).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('link', { name: 'Back to More' }).click();
  await page.getByLabel('From', { exact: true }).fill('2026-01-01');
  await page.getByLabel('To', { exact: true }).fill('2027-12-31');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()]);
  const csv = readFileSync((await download.path())!, 'utf8');
  expect(csv.split('\r\n')[0]).toContain('"Reference","Status","Date"');
  expect(csv).toContain(ref);
  expect(csv).not.toContain('GATE77');
  await expectAccessible(page);
});

// ---------------------------------------------------------------------------
// The portal: customers, tasks, the schedule, the team, reports, a computer.
// ---------------------------------------------------------------------------

const SHOTS = process.env.SCREENSHOTS_DIR;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test('a lead from a phone call, worked from their customer page', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'New lead' });
  await expect(sheet).toBeVisible();
  await expectAccessible(page);
  await sheet.getByLabel('Name').fill('Avery Newlead');
  await sheet.getByLabel('Mobile').fill('910 555 4242');
  await sheet.getByLabel('Address').fill('15 Test Shore Dr, Sunset Beach, NC 28468');
  await sheet.getByLabel('How they found us').selectOption('phone_call');
  await sheet.getByLabel(/^Note/).fill('Wants a metal roof. Call after 5.');
  await sheet.getByRole('button', { name: 'Add lead' }).click();

  // Their page: the next step, the call-back task the app made, and the note.
  await expect(page.getByRole('heading', { name: 'Avery Newlead', level: 1 })).toBeVisible();
  await expect(page.locator('.toast')).toHaveText('Avery added, with a task to call them back.');
  await expect(page.locator('.next-card')).toContainText('Call Avery back');
  await expect(page.getByRole('link', { name: 'Call', exact: true })).toHaveAttribute('href', 'tel:+19105554242');
  await expect(page.locator('.timeline')).toContainText('Wants a metal roof. Call after 5.');
  await expectAccessible(page);
  await expectNoSideScroll(page);

  // Give them an owner and a tag.
  await page.getByLabel('Owner', { exact: true }).selectOption({ label: 'Justin Coffey (me)' });
  await expect(page.locator('.flash')).toHaveText('Justin has Avery now.');
  await page.getByLabel('Add a tag').fill('Hot lead');
  await page.locator('.tag-add').getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('.flash')).toHaveText('Tagged "Hot lead".');
  await expect(page.locator('.tag-edit')).toContainText('Hot lead');

  // A task of our own, then tick off the call-back.
  await page.locator('#tasks-h').locator('..').getByRole('button', { name: 'Add' }).click();
  const task = page.getByRole('dialog', { name: 'Task for Avery' });
  await task.getByLabel('What needs doing').fill('Drop off metal samples');
  await task.getByRole('button', { name: 'Tomorrow' }).click();
  await expectAccessible(page);
  await task.getByRole('button', { name: 'Add task' }).click();
  await expect(page.locator('.flash')).toHaveText('Task added.');
  await expect(page.locator('.task-list').first()).toContainText('Drop off metal samples');
  await page.getByRole('button', { name: 'Mark done: Call Avery Newlead back' }).click();
  await expect(page.locator('.flash')).toHaveText('Done: Call Avery Newlead back');
  // Ticking off the call-back counts as a call.
  await expect(page.locator('.profile-sub .stage')).toHaveText('Contacted');

  await page.getByLabel('Note', { exact: true }).fill('Talked on the phone. Coming by Thursday.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.locator('.flash')).toHaveText('Note saved.');
  await expect(page.locator('.timeline li').first()).toContainText('Talked on the phone. Coming by Thursday.');
  await shot(page, 'customer-profile');

  // Lost, then back.
  await page.getByRole('button', { name: 'Mark lost' }).click();
  await page.getByRole('dialog', { name: 'Mark lost' }).getByLabel('Not ready yet').check();
  await page.getByRole('dialog', { name: 'Mark lost' }).getByRole('button', { name: 'Mark lost' }).click();
  await expect(page.locator('.flash')).toHaveText('Avery marked lost.');
  await expect(page.locator('.profile-sub .stage')).toHaveText('Lost');
  await page.getByRole('button', { name: 'Back in the pipeline' }).click();
  await expect(page.locator('.profile-sub .stage')).toHaveText('Contacted');
  await expectAccessible(page);
});

test('customers: search, filters and the board', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Customers' }).click();
  await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
  await page.getByLabel('Search customers').fill('Avery');
  const row = page.locator('.cust-row', { hasText: 'Avery Newlead' });
  await expect(row).toBeVisible();
  await expect(row.locator('.stage')).toHaveText('Contacted');
  await expect(row.locator('.tag')).toHaveText('Hot lead');
  await expect(page.locator('.cust-row')).toHaveCount(1);
  await page.getByLabel('Search customers').fill('4242');
  await expect(page.locator('.cust-row')).toHaveCount(1);
  await page.getByLabel('Search customers').fill('');
  await page.getByRole('group', { name: 'Whose' }).getByRole('button', { name: 'Mine' }).click();
  await expect(page.locator('.cust-row', { hasText: 'Avery Newlead' })).toBeVisible();
  await expectAccessible(page);
  await expectNoSideScroll(page);
  await shot(page, 'customers');

  await page.getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'Board' }).click();
  const col = page.locator('.board-col', { has: page.getByRole('heading', { name: /^Contacted/ }) });
  await expect(col.locator('.board-card', { hasText: 'Avery Newlead' })).toBeVisible();
  await expectAccessible(page);
  await expectNoSideScroll(page);
  await shot(page, 'board');
  await page.getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'List' }).click();
});

test('tasks: mine, nobody yet, done, and undo', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: /^Tasks/ }).click();
  await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();
  const tomorrow = page.locator('.task-group', { has: page.getByRole('heading', { name: /^Tomorrow/ }) });
  await expect(tomorrow.getByRole('button', { name: 'Drop off metal samples', exact: true })).toBeVisible();
  await expect(tomorrow.getByRole('link', { name: 'Avery Newlead' })).toBeVisible();

  await page.getByRole('button', { name: 'New task' }).click();
  const sheet = page.getByRole('dialog', { name: 'New task' });
  await sheet.getByLabel('What needs doing').fill('Order ridge vent for the Hayes job');
  await sheet.getByLabel('Who does it').selectOption({ label: 'Anyone (nobody yet)' });
  await sheet.getByRole('button', { name: 'Add task' }).click();
  await expect(page.locator('.flash')).toHaveText('Task added.');

  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /^Nobody yet/ }).click();
  await expect(page).toHaveURL(/#\/tasks\/nobody$/);
  const vent = page.getByRole('button', { name: 'Mark done: Order ridge vent for the Hayes job' });
  await expect(vent).toBeVisible();
  await expectAccessible(page);
  await vent.click();
  await expect(page.locator('.flash')).toContainText('Done: Order ridge vent for the Hayes job');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.flash')).toHaveText('Back on the list: Order ridge vent for the Hayes job');
  await expect(page.getByRole('button', { name: 'Mark done: Order ridge vent for the Hayes job' })).toBeVisible();

  // Edit it: give it to me.
  await page.getByRole('button', { name: 'Order ridge vent for the Hayes job', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Task' });
  await edit.getByLabel('Who does it').selectOption({ label: 'Justin Coffey (me)' });
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.flash')).toHaveText('Task saved.');
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /^Mine/ }).click();
  await expect(page.getByRole('button', { name: 'Mark done: Order ridge vent for the Hayes job' })).toBeVisible();
  await expectNoSideScroll(page);
  await shot(page, 'tasks');

  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.task.is-done', { hasText: 'Call Avery Newlead back' })).toBeVisible();
  await expectAccessible(page);
});

test('the schedule: who does each inspection, and visit photos the customer can see', async ({ page, request }) => {
  // A visit of our own, on a day we know.
  const { slots } = (await (await request.get('/api/slots')).json()) as { slots: { id: string; startsAt: string }[] };
  const slot = slots[Math.floor(slots.length / 2)]!;
  const res = await request.post('/api/bookings', {
    data: {
      draftKey: crypto.randomUUID(),
      startedAt: Date.now() - 60_000,
      address: { text: '88 Test Marsh Ln, Shallotte, NC 28470', typed: true },
      relationship: 'owner',
      roof: { material: 'shingle', age: '10-15', reason: 'leak', notes: '' },
      slotId: slot.id,
      visit: { someoneHome: 'yes', gateCode: '', pets: '' },
      contact: { name: 'Sam Schedule', mobile: '910 555 6161', email: 'sam@example.com', smsConsent: false },
    },
  });
  expect(res.status()).toBe(201);
  const bookingId = ((await res.json()) as { booking: { id: string } }).booking.id;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(slot.startsAt));

  await signIn(page);
  await page.goto(`/app/#/schedule/${day}`);
  await expect(page.getByRole('heading', { name: 'Schedule', level: 1 })).toBeVisible();
  const item = page.locator('.sched-item', { hasText: 'Sam Schedule' });
  await expect(item).toBeVisible();
  await expect(item).toHaveClass(/unassigned/);
  await item.getByLabel('Inspector for Sam Schedule').selectOption({ label: 'Justin (me)' });
  await expect(page.locator('.flash')).toHaveText("Justin is on Sam's inspection.");
  await expect(page.locator('.sched-item', { hasText: 'Sam Schedule' })).not.toHaveClass(/unassigned/);
  await expectAccessible(page);
  await expectNoSideScroll(page);
  await shot(page, 'schedule');

  // The visit: photos from the roof, one shared with the customer.
  await page.locator('.sched-item', { hasText: 'Sam Schedule' }).getByRole('link', { name: 'Sam Schedule', exact: true }).click();
  await expect(page.getByLabel('Inspector', { exact: true })).toHaveValue(/[0-9a-f-]{36}/);
  await page.locator('#team-photos-h').locator('..').locator('input[type="file"]').setInputFiles('tests/e2e/fixtures/roof.jpg');
  await expect(page.getByRole('status')).toContainText('1 photo added.');
  const photo = page.locator('.team-photo').first();
  await photo.getByLabel('Customer sees it').check();
  await expect(page.getByRole('status')).toHaveText('They can see that photo now.');
  await photo.getByLabel('Caption for photo 1').fill('Lifted shingles by the chimney');
  await photo.getByLabel('Caption for photo 1').blur();
  await expect(page.getByRole('status')).toHaveText('Caption saved.');
  await expect(page.locator('.team-photo.is-shared img')).toHaveAttribute('alt', 'Lifted shingles by the chimney');
  await expectAccessible(page);
  await expectNoSideScroll(page);

  const sql = postgres(DB);
  const [p] = await sql`select source, shared, caption from wb.booking_photos where booking_id = ${bookingId}`;
  await sql.end();
  expect(p).toMatchObject({ source: 'team', shared: true, caption: 'Lifted shingles by the chimney' });
});

test('team, reports, and the app on a computer', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'More' }).click();
  await page.getByRole('link', { name: 'Team' }).click();
  await expect(page.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();
  await expect(page.locator('.person-card', { hasText: 'Justin Coffey' })).toBeVisible();
  await expectAccessible(page);
  await expectNoSideScroll(page);

  await page.goto('/app/#/reports');
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How far they got' })).toBeVisible();
  await expect(page.locator('.bar-row').first().locator('.bar-name')).toHaveText('Leads');
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: 'Year' }).click();
  await expect(page.getByText(/in the last 365 days/)).toBeVisible();
  await expectAccessible(page);
  await expectNoSideScroll(page);
  await shot(page, 'reports');

  // On a computer the menu goes down the side.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/app/#/customers');
  const side = page.getByRole('navigation', { name: 'Owner app', exact: true });
  await expect(side).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Owner app tabs' })).toBeHidden();
  await expect(side.getByRole('link', { name: 'Customers' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'Board' }).click();
  await expect(page.locator('.board-col').first()).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'desktop-board');
  await page.getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'List' }).click();
  await side.getByRole('link', { name: 'Schedule' }).click();
  await expect(page.getByRole('heading', { name: 'Schedule', level: 1 })).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'desktop-schedule');
});
