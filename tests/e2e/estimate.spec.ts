// The instant estimate on phones: pick an address, Google's measured roof (or,
// without Google data, the house's outline), a ballpark, a fallback by house
// size, and the hand-off to booking with the address already chosen.
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, expectNoSideScroll } from './helpers';

// Aerial photos come from the USGS. Tests never call outside services, so a plain image stands in.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop', 'phones only');
  await page.route('https://imagery.nationalmap.gov/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
});

async function pick(page: Page, query: string, option: RegExp) {
  await page.getByRole('combobox', { name: 'Address of the home' }).fill(query);
  await page.getByRole('option', { name: option }).click();
}

test("measures the roof with Google's data, then books with the address already chosen", async ({ page }) => {
  await page.goto('/estimate/');
  await expect(page.getByRole('heading', { name: 'Instant roof estimate', level: 1 })).toBeVisible();
  await expectAccessible(page);

  await pick(page, 'Test Beach', /101 Test Beach/);
  await expect(page.getByRole('heading', { name: '101 Test Beach Dr W, Ocean Isle Beach, NC 28469' })).toBeVisible();
  const result = page.locator('.estimate-card', { hasText: 'Ballpark for a new roof' });
  await expect(result.locator('.price')).toHaveText('$10,100 to $11,700');
  await expect(result).toContainText('Your roof: about 2,250 square feet, or 22.5 squares.');
  await expect(result).toContainText('Average pitch: about 6/12.');
  await expect(page.getByText(/Measured from aerial imagery taken March 2025, with Google Maps/)).toBeVisible();
  await expectAccessible(page);
  await expectNoSideScroll(page);

  await result.getByRole('button', { name: /Book a free inspection/ }).click();
  await expect(page).toHaveURL(/\/book\/$/);
  await expect(page.getByRole('combobox', { name: 'Address of the home' })).toHaveValue('101 Test Beach Dr W, Ocean Isle Beach, NC 28469');
  await expect(page.getByText('Found it.')).toBeVisible();
  await page.getByRole('radio', { name: "It's my home", exact: true }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Your roof' })).toBeVisible();
  await expect(page.getByLabel('Anything we should know?')).toHaveValue(/From the instant estimate: about 22.5 to 26 squares, \$10,100 to \$11,700\./);
  await page.evaluate(() => localStorage.clear());
});

test("without Google data the house's outline stands in, and the house's size always works", async ({ page }) => {
  await page.goto('/estimate/');
  await pick(page, 'Test Main', /404 Test Main/);
  await expect(page.getByText('Is this your house?')).toBeVisible();
  await expect(page.getByRole('img', { name: /Aerial photo of the house we measured/ })).toBeVisible();
  const result = page.locator('.estimate-card', { hasText: 'Ballpark for a new roof' });
  await expect(result.locator('.price')).toHaveText('$9,400 to $11,200');
  await expect(result).toContainText('Your house seen from above: about 1,910 square feet.');
  await expectAccessible(page);
  await expectNoSideScroll(page);

  await page.getByRole('button', { name: "Enter my house's size instead" }).click();
  await page.getByLabel('Heated square feet').fill('1,800');
  await page.getByLabel('Stories').selectOption('2');
  await page.getByRole('button', { name: 'Show the ballpark' }).click();
  await expect(result.locator('.price')).toHaveText('$5,100 to $6,100');
  await expectAccessible(page);
});

test('an address outside the area, or one typed by hand, says what to do', async ({ page }) => {
  await page.goto('/estimate/');
  await pick(page, 'Test Market', /505 Test Market/);
  await expect(page.getByText('That address is outside our area.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ballpark for a new roof' })).toHaveCount(0);

  await page.getByRole('combobox', { name: 'Address of the home' }).fill('12 Nowhere Lane, Supply, NC 28462');
  await page.getByRole('button', { name: 'Use the address I typed' }).click();
  await expect(page.getByRole('alert')).toContainText('We need the address from the list to measure the roof.');
  await expect(page.getByRole('heading', { name: "Use your house's size" })).toBeVisible();
  await page.getByLabel('Heated square feet').fill('90');
  await page.getByRole('button', { name: 'Show the ballpark' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter the heated square feet');
  await expectAccessible(page);
  await expectNoSideScroll(page);
});
