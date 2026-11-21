// Booking end to end on a 320px phone: the whole flow, a refresh mid-way,
// errors, two people racing for the last spot, and the manage link.
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import { expectAccessible, expectNoSideScroll, watchErrors } from './helpers';

test.describe.configure({ mode: 'serial' });

test.beforeEach(({}, testInfo) => {
  const dark = testInfo.titlePath.includes('dark mode');
  test.skip(!dark && testInfo.project.name !== 'phone-320', 'booking runs once, on the smallest phone');
});

let phone = 3000;
const nextPhone = () => `910 555 ${String(++phone).padStart(4, '0')}`;

async function pickAddress(page: Page, query: string, option: RegExp) {
  const box = page.getByRole('combobox', { name: 'Address of the home' });
  await box.fill(query);
  await page.getByRole('option', { name: option }).click();
}

async function stepHome(page: Page, query = 'Test Beach', option = /101 Test Beach/) {
  await pickAddress(page, query, option);
  await expect(page.getByText('Found it.')).toBeVisible();
  await page.getByRole('radio', { name: "It's my home", exact: true }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
}

async function stepRoof(page: Page) {
  await expect(page.getByRole('heading', { name: 'Your roof' })).toBeFocused();
  await page.getByRole('radio', { name: 'Shingles', exact: true }).check();
  await page.getByRole('radio', { name: '10 to 15 years', exact: true }).check();
  await page.getByRole('radio', { name: 'A leak', exact: true }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
}

async function stepTime(page: Page, windowIndex = 0, dayIndex = 0) {
  await expect(page.getByRole('heading', { name: 'Pick a time' })).toBeFocused();
  await page.locator('.days .day').nth(dayIndex).click();
  const windows = page.locator('input[name="slot"]');
  await expect(windows.first()).toBeVisible();
  await windows.nth(windowIndex).check();
  await page.getByRole('radio', { name: 'No', exact: true }).check();
  await page.getByLabel('Gate or lockbox code').fill('#4321');
  await page.getByRole('button', { name: 'Continue' }).click();
}

async function stepYou(page: Page, mobile = nextPhone()) {
  await expect(page.getByRole('heading', { name: 'Your details' })).toBeFocused();
  await page.getByLabel('Your name').fill('Pat Tester');
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByLabel('Email').fill('pat@example.com');
  await page.getByRole('checkbox', { name: /Text me about my inspection/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Check and book' })).toBeFocused();
}

async function bookIt(page: Page) {
  await page.getByRole('button', { name: /Book my free inspection/ }).click();
  await expect(page.getByRole('heading', { name: /You're booked/ })).toBeVisible();
}

test('books an inspection start to finish on a 320px phone', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/book/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Book a free inspection');
  await expectAccessible(page);
  await stepHome(page);
  await expectAccessible(page);
  await stepRoof(page);
  await expectAccessible(page);
  await stepTime(page);
  await expectAccessible(page);
  // The contact fields say what they're for.
  await expect(page.getByLabel('Mobile number')).toHaveAccessibleDescription(/Only used to reach you about this inspection/);
  await expect(page.getByLabel('Email')).toHaveAccessibleDescription(/confirmation and your link to change or cancel/);
  await stepYou(page);
  await expectAccessible(page);
  // Nothing is booked until the button is tapped, and the page says so.
  await expect(page.getByText("You're not booked yet.")).toBeVisible();
  // A change made from the review comes straight back to it, without walking every step again.
  await page.getByRole('button', { name: 'Change roof details' }).click();
  await expect(page.getByRole('heading', { name: 'Your roof' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Metal', exact: true }).check();
  await page.getByRole('button', { name: 'Back to review' }).click();
  await expect(page.getByRole('heading', { name: 'Check and book' })).toBeFocused();
  await expect(page.locator('.summary')).toContainText('Metal, 10 to 15 years.');
  await expect(page.getByText('101 Test Beach Dr W')).toBeVisible();
  await expect(page.getByText('Texts: yes')).toBeVisible();
  await expectNoSideScroll(page);
  await bookIt(page);
  await expect(page.getByText(/Reference [0-9A-Z]{3}-[0-9A-Z]{3}/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add to Google Calendar' })).toHaveAttribute('href', /calendar\.google\.com/);
  // The Google link carries the time and our name only: no address, no secret.
  const google = await page.getByRole('link', { name: 'Add to Google Calendar' }).getAttribute('href');
  expect(google).not.toMatch(/Test%20Beach|Test\+Beach/);
  expect(google).not.toContain('/b/#');
  await expectAccessible(page);
  await expectNoSideScroll(page);
  // The draft is gone once booked.
  const saved = await page.evaluate(() => localStorage.getItem('booking-draft-v1'));
  expect(saved).toBeNull();
  // No personal data in the address bar at any point.
  expect(page.url()).not.toMatch(/Pat|example|555/);
  // The confirmation text and email are on their way (logged, since tests have no keys),
  // the business is alerted, and the screen doesn't claim anything was sent.
  const ref = (await page.locator('.ref strong').innerText()).replace('-', '');
  const sql = postgres(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/wb_e2e');
  const sent = await sql`
    select m.audience, m.channel, m.kind, m.status from wb.messages m join wb.bookings b on b.id = m.booking_id
    where b.ref = ${ref} order by m.audience, m.channel`;
  await sql.end();
  const lines = sent.map((r) => `${r.audience}:${r.channel}:${r.kind}:${r.status}`);
  expect(lines.filter((l) => l.startsWith('customer'))).toEqual([
    'customer:email:confirmation:logged',
    'customer:sms:confirmation:logged',
  ]);
  // The business hears about it too (by email, plus a text once an owner has a mobile on file).
  expect(lines).toContain('owner:email:owner_new:logged');
  await expect(page.getByText(/We emailed|We texted/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a half-done booking survives a refresh', async ({ page }) => {
  await page.goto('/book/');
  await stepHome(page);
  await page.getByRole('radio', { name: 'Metal', exact: true }).check();
  await page.getByLabel('Anything we should know?').fill('Stain over the kitchen');
  await page.waitForTimeout(400); // saved a moment after typing
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your roof' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Metal', exact: true })).toBeChecked();
  await expect(page.getByLabel('Anything we should know?')).toHaveValue('Stain over the kitchen');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('combobox', { name: 'Address of the home' })).toHaveValue(/101 Test Beach/);
  await expect(page.getByText('We kept what you entered before.')).toBeVisible();
  await page.getByRole('button', { name: 'Start over instead' }).click();
  await expect(page.getByRole('combobox', { name: 'Address of the home' })).toHaveValue('');
});

test('every error says how to fix it, and links to the field', async ({ page }) => {
  await page.goto('/book/');
  await page.getByRole('button', { name: 'Continue' }).click();
  const summary = page.getByRole('alert');
  await expect(summary).toBeFocused();
  await expect(summary).toContainText('Enter the street address');
  await expect(summary).toContainText('Choose whose home this is');
  await summary.getByRole('link', { name: /Enter the street address/ }).click();
  await expect(page.getByRole('combobox', { name: 'Address of the home' })).toBeFocused();
  await expectAccessible(page);

  await stepHome(page);
  await stepRoof(page);
  await stepTime(page);
  await page.getByLabel('Mobile number').fill('12345');
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter your name.');
  await expect(page.getByRole('alert')).toContainText('Enter a 10 digit US mobile number, like 910 555 0123.');
  await expect(page.getByRole('alert')).toContainText('Enter an email address, like name@example.com.');
  await expect(page.getByLabel('Mobile number')).toHaveAttribute('aria-invalid', 'true');
  await page.evaluate(() => localStorage.clear());
});

test('an address outside the service area is caught on step one', async ({ page }) => {
  await page.goto('/book/');
  await pickAddress(page, 'Test Market', /505 Test Market/);
  await expect(page.getByText(/outside our area/).first()).toBeVisible();
  await page.getByRole('radio', { name: "It's my home", exact: true }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toContainText('outside our area');
  await expect(page.getByRole('heading', { name: 'Your home' })).toBeVisible();
  await page.evaluate(() => localStorage.clear());
});

test('an address that is not listed can be used as typed', async ({ page }) => {
  await page.goto('/book/');
  await page.getByRole('combobox', { name: 'Address of the home' }).fill('77 Somewhere Not Listed Ln, Supply, NC');
  await page.getByRole('button', { name: 'Use the address I typed' }).click();
  await expect(page.getByText("We'll use the address as you typed it.")).toBeVisible();
  await page.getByRole('radio', { name: 'I manage it', exact: true }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Your roof' })).toBeVisible();
  await page.evaluate(() => localStorage.clear());
});

test('adds and removes a photo', async ({ page }) => {
  await page.goto('/book/');
  await stepHome(page);
  await page.getByLabel(/^Photos/).setInputFiles('tests/e2e/fixtures/roof.jpg');
  await expect(page.getByRole('img', { name: 'Photo 1' })).toBeVisible();
  await expect(page.getByText('Photo added.')).toBeVisible();
  await page.getByRole('button', { name: 'Remove photo 1' }).click();
  await expect(page.getByRole('img', { name: 'Photo 1' })).toHaveCount(0);
  await page.evaluate(() => localStorage.clear());
});

test('two people grabbing the last spot at once: one books, the other picks another time', async ({ browser }) => {
  const size = { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true };
  const a = await (await browser.newContext(size)).newPage();
  const b = await (await browser.newContext(size)).newPage();
  for (const page of [a, b]) {
    await page.goto('/book/');
    await stepHome(page);
    await stepRoof(page);
    await stepTime(page, 0); // both want the same window
    await stepYou(page);
  }
  const wanted = await a.locator('.summary').innerText();
  expect(await b.locator('.summary').innerText()).toContain(wanted.split('\n').find((l) => l.includes(','))!);
  await Promise.all([
    a.getByRole('button', { name: /Book my free inspection/ }).click(),
    b.getByRole('button', { name: /Book my free inspection/ }).click(),
  ]);
  const won = async (p: Page) => (await p.getByRole('heading', { name: /You're booked/ }).count()) > 0;
  await expect.poll(async () => (await won(a)) || (await won(b))).toBe(true);
  const loser = (await won(a)) ? b : a;
  await expect(loser.getByRole('alert')).toContainText('That time just filled up');
  await expect(loser.getByRole('group', { name: 'Open times near the one you picked' })).toBeVisible();
  await loser.locator('input[name="alt"]').first().check();
  await bookIt(loser);
  await a.context().close();
  await b.context().close();
});

test('reschedule and cancel from the private link', async ({ page }) => {
  await page.goto('/book/');
  await stepHome(page, 'Test River', /303 Test River/);
  await stepRoof(page);
  await stepTime(page, 1, 3);
  await stepYou(page);
  await bookIt(page);
  const href = await page.getByRole('link', { name: 'change or cancel this inspection' }).getAttribute('href');
  expect(href).toMatch(/^\/b\/#[A-Za-z0-9_-]{43}$/);

  await page.goto(href!);
  await expect(page.getByText('Booked', { exact: true })).toBeVisible();
  await expectAccessible(page);
  const before = await page.locator('.summary').innerText();
  await page.getByRole('button', { name: 'Change the time' }).click();
  await expect(page.getByRole('heading', { name: 'Pick a new time' })).toBeVisible();
  await page.locator('.days .day').nth(4).click();
  await page.locator('input[name="slot"]').first().check();
  await page.getByRole('button', { name: 'Confirm the new time' }).click();
  await expect(page.getByRole('status')).toContainText('Your new time is');
  expect(await page.locator('.summary').innerText()).not.toEqual(before);

  await page.getByRole('button', { name: 'Cancel the inspection' }).click();
  await page.getByLabel(/Mind telling us why/).fill('Fixed it myself');
  await page.getByRole('button', { name: 'Yes, cancel it' }).click();
  await expect(page.getByRole('status')).toContainText('Your inspection is cancelled');
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change the time' })).toHaveCount(0);
  await expectAccessible(page);
});

test('a broken or missing link says what to do', async ({ page }) => {
  await page.goto('/b/');
  await expect(page.getByRole('alert')).toContainText('missing its code');
  await page.goto('/b/#' + 'x'.repeat(43));
  await page.reload();
  await expect(page.getByRole('alert')).toContainText("couldn't find that booking");
});

test('a referral link fills in the code', async ({ page }) => {
  const res = await page.goto('/r/smith24');
  expect(res?.url()).toContain('/book/?ref=SMITH24');
  await stepHome(page);
  await stepRoof(page);
  await stepTime(page, 2, 2);
  await expect(page.getByLabel('Referral code')).toHaveValue('SMITH24');
  await page.evaluate(() => localStorage.clear());
});

test('a time tapped on the home page is already picked in the booking form', async ({ page }) => {
  // Other tests book times while this one runs, so both pages get one fixed list of open times.
  const open = await (await page.request.get('/api/slots')).text();
  await page.route('**/api/slots', (route) => route.fulfill({ contentType: 'application/json', body: open }));
  await page.goto('/');
  const first = page.locator('[data-next-times] a[data-slot]').first();
  await expect(first).toBeVisible();
  const slot = JSON.parse((await first.getAttribute('data-slot'))!) as { id: string };
  await first.click();
  await expect(page).toHaveURL(/\/book\/$/);
  await expect(page.getByText('Your pick. You can change it in step 3.')).toBeVisible();
  await expectAccessible(page);
  await stepHome(page);
  await stepRoof(page);
  await expect(page.getByRole('heading', { name: 'Pick a time' })).toBeFocused();
  await expect(page.locator(`input[name="slot"][value="${slot.id}"]`)).toBeChecked();
  await page.evaluate(() => localStorage.clear());
});

test.describe('dark mode', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-390-dark', 'dark mode check');
  });
  test('on a phone set to dark mode the site stays light, and every booking step passes accessibility checks', async ({ page }) => {
    await page.goto('/book/');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgb(250, 249, 246)');
    await expectAccessible(page);
    await stepHome(page, 'Test Main', /404 Test Main/);
    await expectAccessible(page);
    await stepRoof(page);
    await expectAccessible(page);
    await stepTime(page, 0, 5);
    await expectAccessible(page);
    await stepYou(page);
    await expectAccessible(page);
    await page.evaluate(() => localStorage.clear());
  });
});
