// After the inspection, on phones: the owner sends an estimate, the customer
// says yes on their private link, the owner puts the job on a crew's day, the
// weather moves it, and the customer sees each step.
import { expect, test, type Page } from '@playwright/test';
import { SignJWT } from 'jose';
import postgres from 'postgres';
import { expectAccessible, expectNoSideScroll } from './helpers';

const DB = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/wb_e2e';
const SECRET = process.env.SUPABASE_JWT_SECRET ?? 'e2e-only-jwt-secret-0123456789abcdef';
const OWNER = '6f1c2d4e-0000-4000-8000-00000000a002';
const EMAIL = 'jt@example.com';

test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone-320', 'runs once, on the smallest phone');
});

let bookingId = '';
let token = '';

test.beforeAll(async ({ request }, testInfo) => {
  if (testInfo.project.name !== 'phone-320') return;
  const sql = postgres(DB);
  await sql`insert into auth.users (id, email) values (${OWNER}, ${EMAIL}) on conflict (id) do nothing`;
  await sql`insert into wb.owners (user_id, name, email) values (${OWNER}, 'JT Stinson', ${EMAIL}) on conflict (user_id) do nothing`;
  // The middle of the open days, so the booking and owner tests never compete for it.
  const { slots } = (await (await request.get('/api/slots')).json()) as { slots: { id: string; startsAt: string }[] };
  const slot = slots[Math.floor(slots.length / 2)]!;
  const res = await request.post('/api/bookings', {
    data: {
      draftKey: crypto.randomUUID(),
      startedAt: Date.now() - 60_000,
      address: { text: '303 Test River Rd, Calabash, NC 28467', typed: true },
      relationship: 'owner',
      roof: { material: 'shingle', age: '20+', reason: 'replace', notes: '' },
      slotId: slot.id,
      visit: { someoneHome: 'no', gateCode: '', pets: '' },
      contact: { name: 'Casey Homeowner', mobile: '910 555 8181', email: 'casey@example.com', smsConsent: true },
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { booking: { ref: string }; token: string };
  token = body.token;
  [{ id: bookingId }] = await sql`select id from wb.bookings where ref = ${body.booking.ref}`;
  await sql.end();
});

async function signIn(page: Page) {
  const now = Math.floor(Date.now() / 1000);
  const access = await new SignJWT({ role: 'authenticated', email: EMAIL, aud: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(OWNER)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(new TextEncoder().encode(SECRET));
  const user = { id: OWNER, aud: 'authenticated', role: 'authenticated', email: EMAIL, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  const session = { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'refresh-token', user };
  await page.route('https://test-project.supabase.co/auth/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/otp')) return route.fulfill({ status: 200, json: {} });
    if (path.endsWith('/verify') || path.endsWith('/token')) return route.fulfill({ status: 200, json: session });
    if (path.endsWith('/user')) return route.fulfill({ status: 200, json: user });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/app/');
  await page.getByLabel('Your email').fill(EMAIL);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.home-hello h1')).toHaveText(/^Good (morning|afternoon|evening)/);
}

const localDate = (offsetDays: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() + offsetDays * 86_400_000));

test('the owner finishes the visit and sends the estimate', async ({ page }) => {
  await signIn(page);
  await page.goto(`/app/#/booking/${bookingId}`);
  await expect(page.getByRole('heading', { name: '303 Test River Rd, Calabash, NC 28467' })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Marked done.');

  // The estimate form appears once the visit is done.
  await page.getByLabel('Price').fill('12,5x0');
  await page.getByRole('button', { name: 'Send estimate' }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter the price in dollars, like 12500.');
  await page.getByLabel('Price').fill('12,500');
  await page.getByLabel("What's included").fill('Tear off one layer, new architectural shingles, new drip edge and pipe boots.\n\nDumpster and cleanup included.');
  // The roof's size and pitch go on the estimate too.
  await page.getByLabel('Size, square feet').fill('23');
  await page.getByRole('button', { name: 'Send estimate' }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter the roof size in square feet, like 2400. Or leave it blank.');
  await page.getByLabel('Size, square feet').fill('2,300');
  await page.getByLabel('Pitch, rise per 12').fill('6');
  await page.getByRole('button', { name: 'Send estimate' }).click();
  await expect(page.getByRole('status')).toHaveText('Sent to Casey.');
  await expect(page.getByText('Waiting on them')).toBeVisible();
  await expect(page.getByText('Not opened yet.')).toBeVisible();
  await expectAccessible(page);
  await expectNoSideScroll(page);

  await page.getByRole('link', { name: 'More' }).click();
  await page.getByRole('link', { name: 'Estimates' }).click();
  await expect(page.getByRole('heading', { name: 'Estimates', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Waiting on the customer (1)' })).toBeVisible();
  await expect(page.locator('.up-list').getByText(/Casey Homeowner, 303 Test River Rd.*\$12,500/)).toBeVisible();
  await expectAccessible(page);
  await expectNoSideScroll(page);
});

test('the customer reads it on their private link and says yes', async ({ page }) => {
  await page.goto(`/b/#${token}`);
  const card = page.locator('.estimate-card', { hasText: 'Your estimate' });
  await expect(card.getByText('$12,500')).toBeVisible();
  await expect(card.getByText('Dumpster and cleanup included.')).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Your roof' })).toBeVisible();
  await expect(card.getByText('2,300 square feet (23 squares)')).toBeVisible();
  await expect(card.getByText('6/12')).toBeVisible();
  await expectAccessible(page);
  await expectNoSideScroll(page);
  await card.getByRole('button', { name: "Yes, let's do it" }).click();
  await expect(card.getByText('Go ahead with this estimate?')).toBeVisible();
  await card.getByRole('button', { name: 'Yes, go ahead' }).click();
  await expect(page.getByRole('status')).toHaveText("Thank you! We'll pick a day for the job and let you know.");
  await expect(page.getByRole('heading', { name: 'Your roof job' })).toBeVisible();
  await expect(page.getByText("We'll pick a day for the job and let you know.").last()).toBeVisible();
  await expectAccessible(page);

  // The owners heard about it.
  const sql = postgres(DB);
  const alerts = await sql`select channel from wb.messages where booking_id = ${bookingId} and kind = 'owner_accepted'`;
  await sql.end();
  expect(alerts.length).toBeGreaterThan(0);
});

test('the owner schedules the job, weather moves the day, and the customer sees it', async ({ page }) => {
  const first = localDate(6);
  const second = localDate(8);
  await signIn(page);
  await page.goto(`/app/#/booking/${bookingId}`);
  await expect(page.getByText('Casey said yes')).toBeVisible();
  await page.getByRole('radio', { name: 'Crew 2' }).check();
  await page.getByLabel('Day', { exact: true }).fill(first);
  await page.getByRole('button', { name: 'Schedule the job' }).click();
  await expect(page.getByRole('status')).toHaveText('Scheduled. The customer was told.');
  await expectAccessible(page);

  await page.getByRole('link', { name: 'More' }).click();
  await page.getByRole('link', { name: 'Roof jobs' }).click();
  await expect(page.getByRole('heading', { name: 'Jobs', level: 1 })).toBeVisible();
  const day = page.locator('.up-day', { hasText: 'Casey Homeowner' });
  await expect(day.getByText('Crew 2')).toBeVisible();
  await expectAccessible(page);
  await expectNoSideScroll(page);
  await day.getByRole('button', { name: 'Move this day' }).click();
  await day.getByLabel('Move every job on this day to').fill(second);
  await day.getByRole('button', { name: 'Move and tell the customer' }).click();
  await expect(page.getByRole('status')).toContainText('Moved one job to');

  const sql = postgres(DB);
  const moved = await sql`select channel, body from wb.messages where booking_id = ${bookingId} and kind = 'job_moved' order by channel`;
  await sql.end();
  expect(moved.map((m) => m.channel)).toEqual(['email', 'sms']);
  expect(moved.find((m) => m.channel === 'sms')!.body).toContain('because of the weather');

  await page.goto(`/b/#${token}`);
  const job = page.locator('.estimate-card', { hasText: 'Your roof job' });
  await expect(job.locator('.price')).toHaveText(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${second}T12:00:00Z`)),
  );
  await expectAccessible(page);
});

test('crews can be renamed', async ({ page }) => {
  await signIn(page);
  await page.goto('/app/#/crews');
  await expect(page.getByRole('heading', { name: 'Crews', level: 1 })).toBeVisible();
  await page.getByLabel('Name').first().fill("Justin's crew");
  await page.getByRole('button', { name: 'Save crews' }).click();
  await expect(page.getByRole('status')).toHaveText('Crews saved.');
  await expect(page.getByRole('group', { name: "Justin's crew" })).toBeVisible();
  await expectAccessible(page);
  await expectNoSideScroll(page);
});
