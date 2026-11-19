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
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
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

test('availability: a day off, and a bad window is refused with a reason', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Availability' }).click();
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
