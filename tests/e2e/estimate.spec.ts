// The estimate page on phones: enter an address, see the roof from above, say
// how to reach you, and the request goes to the owners. The page never shows a
// price or the roof's size. "Pick a time now" opens the booking form filled in.
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import { expectAccessible, expectBigTapTargets, expectNoSideScroll, watchErrors } from './helpers';

const DB = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/wb_e2e';

// The satellite picture comes from Google. Tests never call outside services, so a plain image stands in.
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name === 'desktop', 'phones only');
});

// Each test, on each phone, uses its own number: a booking is tied to a request by the number,
// and one number can only ask a few times a day.
const mobile = (testInfo: { project: { name: string } }, test: number) =>
  `910 555 ${testInfo.project.name === 'phone-320' ? '41' : '42'}${String(test).padStart(2, '0')}`;

async function pick(page: Page, query: string, option: RegExp) {
  await page.getByRole('combobox', { name: 'Address of the home' }).fill(query);
  await page.getByRole('option', { name: option }).click();
}

const noPriceOrSize = /\$\s?\d|\bsquares?\b|\bpitch\b|ballpark|per square/i;

test('ask for an estimate, then pick a time with everything already filled in', async ({ page }, testInfo) => {
  const errors = watchErrors(page);
  const number = mobile(testInfo, 1);
  await page.route('**/api/estimate', (route) => route.fulfill({ json: { outOfArea: false, picture: PIXEL } }));
  await page.goto('/estimate/');
  await expect(page.getByRole('heading', { name: 'Free roof estimate', level: 1 })).toBeVisible();
  await expect(page.getByText('one of us calls you within one business hour to set up your free estimate')).toBeVisible();
  // The contact fields wait for an address.
  await expect(page.getByLabel('Your name')).toHaveCount(0);
  await expectAccessible(page);

  await pick(page, 'Test Beach', /101 Test Beach/);
  await expect(page.getByText('Found it.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Satellite view of 101 Test Beach Dr W, Ocean Isle Beach, NC 28469' })).toBeVisible();
  await expect(page.getByText('Is this your house?')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How can we reach you?' })).toBeVisible();
  expect(await page.locator('main').innerText()).not.toMatch(noPriceOrSize);
  await expectAccessible(page);
  await expectNoSideScroll(page);
  await expectBigTapTargets(page);

  // Missing details say how to fix them.
  await page.getByRole('button', { name: 'Get my free estimate' }).click();
  await expect(page.getByRole('alert')).toContainText('2 things to fix');
  await expect(page.getByRole('alert').getByRole('link', { name: 'Enter your name.' })).toBeVisible();
  await page.getByLabel('Your name').fill('Pat Tester');
  await page.getByLabel('Mobile number').fill(number);
  await page.getByLabel('Email').fill('pat@example.com');

  const sent = page.waitForResponse((r) => r.url().endsWith('/api/estimate-requests'));
  await page.getByRole('button', { name: 'Get my free estimate' }).click();
  const reply = (await (await sent).json()) as Record<string, unknown>;
  // What comes back to the browser: a reference and their own details. No price, no size.
  expect(Object.keys(reply).sort()).toEqual(['ballpark', 'firstName', 'mobile', 'ref']);
  expect(reply.ballpark).toBeNull();

  await expect(page.getByRole('heading', { name: 'Thanks, Pat. Your request is in.' })).toBeVisible();
  await expect(page.getByText(`One of us will call you within one business hour at (910) 555-${number.slice(-4)}.`)).toBeVisible();
  await expect(page.getByText("a few details a photo from above can't show")).toBeVisible();
  expect(await page.locator('main').innerText()).not.toMatch(noPriceOrSize);
  await expectAccessible(page);
  await expectNoSideScroll(page);

  // The owners were told, with the roof and a ballpark the customer never sees.
  const sql = postgres(DB);
  const [request] = await sql`select id, status, roof, lead_source from wb.estimate_requests where ref = ${String(reply.ref)}`;
  expect(request).toMatchObject({ status: 'new' });
  expect(request!.roof).toMatchObject({ source: 'google', ballpark: [10100, 11700] });
  const alerts = await sql`select channel, body from wb.messages where request_id = ${request!.id} and audience = 'owner'`;
  expect(alerts.length).toBeGreaterThan(0);
  expect(alerts.map((a) => a.body).join(' ')).toContain('Ballpark $10,100 to $11,700.');

  // Straight to booking: the address and their details are already in.
  await page.getByRole('button', { name: 'Pick a time now' }).click();
  await expect(page).toHaveURL(/\/estimate\/book\/$/);
  await expect(page.getByRole('heading', { name: 'Book your free estimate', level: 1 })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Address of the home' })).toHaveValue('101 Test Beach Dr W, Ocean Isle Beach, NC 28469');
  await expect(page.getByText('Found it.')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('radio', { name: "It's my home", exact: true }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('group', { name: "What's going on with the roof?" })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Thinking about a new roof', exact: true })).toBeChecked();
  await expect(page.getByLabel('Anything we should know?')).toHaveValue('');
  await page.getByRole('radio', { name: 'Shingles', exact: true }).check();
  await page.getByRole('radio', { name: '15 to 20 years', exact: true }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Pick a time' })).toBeVisible();
  // A middle day, away from the windows the other tests book. Each phone takes its own day.
  await page.getByRole('button', { name: 'Show more days' }).click();
  await page.locator('.days .day').nth(testInfo.project.name === 'phone-320' ? 7 : 10).click();
  await page.locator('input[name="slot"]').last().check();
  await page.getByRole('radio', { name: 'No', exact: true }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Your name')).toHaveValue('Pat Tester');
  await expect(page.getByLabel('Mobile number')).toHaveValue(number);
  await expect(page.getByLabel('Email')).toHaveValue('pat@example.com');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Check and book' })).toBeVisible();
  await page.getByRole('button', { name: 'Book my free estimate' }).click();
  await expect(page.getByRole('heading', { name: "You're booked, Pat." })).toBeVisible();
  await expect(page.getByText('Your estimate starts with a roof inspection')).toBeVisible();
  await expectAccessible(page);

  // The request and the booking are one story now.
  const [after] = await sql`select r.status, b.roof, b.lead_source from wb.estimate_requests r join wb.bookings b on b.id = r.booking_id where r.id = ${request!.id}`;
  await sql.end();
  expect(after).toMatchObject({ status: 'booked' });
  expect(after!.roof).toMatchObject({ source: 'google' });
  expect(errors).toEqual([]);
  await page.evaluate(() => localStorage.clear());
});

test('nothing about price or size ever reaches the browser', async ({ page, request }) => {
  // The page itself, as sent.
  const html = await (await request.get('/estimate/')).text();
  expect(html).not.toMatch(/pricePerSquare|per square|\$\s?\d/);
  expect(html).toContain('Get my free estimate');

  // The picture lookup answers with a picture and nothing else.
  const place = ((await (await request.post('/api/places/details', { data: { placeId: 'test-oib-1', sessionToken: 's' } })).json()) as { place: object }).place;
  const look = (await (await request.post('/api/estimate', { data: { place } })).json()) as Record<string, unknown>;
  expect(Object.keys(look).sort()).toEqual(['outOfArea', 'picture']);

  // And no script the page loads carries the price table.
  const scripts: string[] = [];
  page.on('response', (r) => {
    if (r.url().endsWith('.js')) scripts.push(r.url());
  });
  await page.goto('/estimate/');
  await page.waitForLoadState('networkidle');
  expect(scripts.length).toBeGreaterThan(0);
  for (const url of scripts) {
    const js = await (await request.get(url)).text();
    expect(js, url).not.toMatch(/pricePerSquare|largeRoof|measuredRange|slopeFactor/);
  }
});

test('an address outside the area stops there; one typed by hand still gets a call', async ({ page }, testInfo) => {
  await page.goto('/estimate/');
  await pick(page, 'Test Market', /505 Test Market/);
  await expect(page.getByText(/That address is outside our area\. We serve Ocean Isle Beach and Brunswick County\./)).toBeVisible();
  await expect(page.getByLabel('Your name')).toHaveCount(0);

  await page.getByRole('combobox', { name: 'Address of the home' }).fill('12 Nowhere Lane, Supply, NC 28462');
  await page.getByRole('button', { name: 'Use the address I typed' }).click();
  await expect(page.getByText("We'll use the address as you typed it.")).toBeVisible();
  await page.getByLabel('Your name').fill('Sam Typed');
  await page.getByLabel('Mobile number').fill('555-0142');
  await page.getByRole('button', { name: 'Get my free estimate' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter a 10 digit US mobile number');
  await expectAccessible(page);
  await page.getByLabel('Mobile number').fill(mobile(testInfo, 3));
  await page.getByRole('button', { name: 'Get my free estimate' }).click();
  await expect(page.getByRole('heading', { name: 'Thanks, Sam. Your request is in.' })).toBeVisible();
  await expectNoSideScroll(page);
});

test("the link in the customer's email opens the booking form filled in", async ({ page, request }, testInfo) => {
  const number = mobile(testInfo, 4);
  const place = ((await (await request.post('/api/places/details', { data: { placeId: 'test-oib-2', sessionToken: 's' } })).json()) as { place: object }).place;
  const res = await request.post('/api/estimate-requests', {
    data: { key: crypto.randomUUID(), startedAt: Date.now() - 60_000, address: place, contact: { name: 'Lee Linked', mobile: number, email: 'lee@example.com' } },
  });
  expect(res.status(), await res.text()).toBe(201);
  const { ref } = (await res.json()) as { ref: string };
  const sql = postgres(DB);
  const [copy] = await sql`select m.body from wb.messages m join wb.estimate_requests r on r.id = m.request_id where r.ref = ${ref} and m.audience = 'customer'`;
  await sql.end();
  const token = /#r=([A-Za-z0-9_-]{43})/.exec(copy!.body as string)![1]!;

  await page.goto(`/estimate/book/#r=${token}`);
  await expect(page.getByRole('combobox', { name: 'Address of the home' })).toHaveValue('202 Test Causeway Rd, Ocean Isle Beach, NC 28469');
  await expect(page.getByText('Found it.')).toBeVisible();
  // The code leaves the address bar once it's been used.
  await expect(page).toHaveURL(/\/estimate\/book\/$/);
  await page.getByRole('radio', { name: "It's my home", exact: true }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: 'Shingles', exact: true }).check();
  await page.getByRole('radio', { name: 'Not sure', exact: true }).last().check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="slot"]').first().check();
  await page.getByRole('radio', { name: 'No', exact: true }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Your name')).toHaveValue('Lee Linked');
  await expect(page.getByLabel('Mobile number')).toHaveValue(`(910) 555-${number.slice(-4)}`);
  await expect(page.getByLabel('Email')).toHaveValue('lee@example.com');
  await page.evaluate(() => localStorage.clear());

  // An old or mistyped link says so, and the form still works.
  await page.goto(`/estimate/book/#r=${'x'.repeat(43)}`);
  await page.reload(); // the same page with a new code: load it afresh, as opening a link does
  await expect(page.getByText('That link is old or already used. You can still book below.')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Address of the home' })).toHaveValue('');
  await expectAccessible(page);
});
