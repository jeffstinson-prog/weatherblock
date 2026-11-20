// The instant estimate on phones: an address in, the house's outline, a ballpark,
// a fallback by house size, and the hand-off to booking.
import { expect, test } from '@playwright/test';
import { expectAccessible, expectNoSideScroll } from './helpers';

// Aerial photos come from the USGS. Tests never call outside services, so a plain image stands in.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop', 'phones only');
  await page.route('https://imagery.nationalmap.gov/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
});

test('measures the house from above and gives a ballpark, then hands off to booking', async ({ page }) => {
  await page.goto('/estimate/');
  await expect(page.getByRole('heading', { name: 'Instant roof estimate', level: 1 })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Get my estimate' }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter the street address, town and ZIP code.');

  await page.getByLabel('Your address').fill('101 Test Beach Dr W, Ocean Isle Beach, NC 28469');
  await page.getByRole('button', { name: 'Get my estimate' }).click();
  await expect(page.getByRole('heading', { name: '101 Test Beach Dr W, Ocean Isle Beach, NC 28469' })).toBeVisible();
  await expect(page.getByText('Is this your house?')).toBeVisible();
  await expect(page.getByRole('img', { name: /Aerial photo of the house we measured/ })).toBeVisible();
  const result = page.locator('.estimate-card', { hasText: 'Ballpark for a new roof' });
  await expect(result.locator('.price')).toHaveText('$9,000 to $10,800');
  await expect(result).toContainText('about 1,830 square feet');
  await expect(result).toContainText('20 to 24 squares');
  await expect(result).toContainText('A rough guide, not a quote.');
  await expectAccessible(page);
  await expectNoSideScroll(page);

  // The outline can be wrong, or missing: the house's size works too.
  await page.getByRole('button', { name: "Enter my house's size instead" }).click();
  await page.getByLabel('Heated square feet').fill('1,800');
  await page.getByLabel('Stories').selectOption('2');
  await page.getByRole('button', { name: 'Show the ballpark' }).click();
  await expect(result.locator('.price')).toHaveText('$5,100 to $6,100');
  await expectAccessible(page);

  await result.getByRole('button', { name: /Book a free inspection/ }).click();
  await expect(page).toHaveURL(/\/book\/$/);
  await expect(page.getByRole('combobox', { name: 'Address of the home' })).toHaveValue('101 Test Beach Dr W, Ocean Isle Beach, NC 28469');
  await page.evaluate(() => localStorage.clear());
});

test("an address we can't find, or a house outside the map data, falls back to the house's size", async ({ page }) => {
  await page.goto('/estimate/');
  await page.getByLabel('Your address').fill('12 Nowhere Lane, Nowhere, NC 00000');
  await page.getByRole('button', { name: 'Get my estimate' }).click();
  await expect(page.getByRole('alert')).toContainText("We couldn't find that address.");
  await expect(page.getByRole('heading', { name: "Use your house's size" })).toBeVisible();

  await page.getByLabel('Your address').fill('1 Test Far Rd, Raleigh, NC 27601');
  await page.getByRole('button', { name: 'Get my estimate' }).click();
  await expect(page.getByRole('button', { name: 'Get my estimate' })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: "Use your house's size" })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ballpark for a new roof' })).toHaveCount(0);
  await page.getByLabel('Heated square feet').fill('90');
  await page.getByRole('button', { name: 'Show the ballpark' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter the heated square feet');
  await expectAccessible(page);
  await expectNoSideScroll(page);
});
