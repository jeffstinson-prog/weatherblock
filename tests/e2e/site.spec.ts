import { expect, test } from '@playwright/test';
import { expectAccessible, expectBigTapTargets, expectNoSideScroll, watchErrors } from './helpers';

const pages = [
  '/',
  '/book/',
  '/services/',
  '/services/roof-replacement/',
  '/services/roof-repairs/',
  '/services/storm-damage/',
  '/services/drone-inspections/',
  '/help/',
  '/help/cost/',
  '/help/insurance-pay/',
  '/financing/',
  '/estimate/',
  '/estimate/book/',
  '/service-area/',
  '/about/',
  '/contact/',
  '/privacy/',
  '/terms/',
  '/text-messages/',
  '/accessibility/',
];

for (const path of pages) {
  test(`${path} works on a phone and passes accessibility checks`, async ({ page }) => {
    const errors = watchErrors(page);
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toBeVisible();
    await expectNoSideScroll(page);
    await expectBigTapTargets(page);
    await expectAccessible(page);
    expect(errors).toEqual([]);
  });
}

test('menu opens and every link in it works', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone menu only');
  await page.goto('/');
  await page.getByText('Menu', { exact: true }).click();
  const links = page.locator('details.menu nav a');
  await expect(links.first()).toBeVisible();
  const hrefs = await links.evaluateAll((els) => els.map((a) => (a as HTMLAnchorElement).getAttribute('href')));
  for (const href of hrefs) {
    const res = await page.request.get(href!);
    expect(res.status(), href!).toBe(200);
  }
});

test('no broken internal links anywhere', async ({ page }) => {
  const seen = new Set<string>();
  const queue = ['/'];
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const res = await page.request.get(path);
    expect(res.status(), path).toBe(200);
    if (!(res.headers()['content-type'] ?? '').includes('text/html')) continue;
    const html = await res.text();
    for (const m of html.matchAll(/href="(\/[^"#?]*)"/g)) {
      const href = m[1]!;
      if (href.startsWith('/_astro/') || /\.(png|xml|txt|ico)$/.test(href)) continue;
      if (!seen.has(href)) queue.push(href);
    }
  }
  expect(seen.size).toBeGreaterThan(15);
});

test('help search finds answers as you type', async ({ page }) => {
  await page.goto('/help/');
  await page.getByLabel('Search the answers').fill('insurance');
  const results = page.locator('#help-results a');
  await expect(results.first()).toBeVisible();
  await expect(page.locator('#help-status')).toContainText('found');
  await page.getByLabel('Search the answers').fill('zzzzqqq');
  await expect(page.locator('#help-status')).toContainText('No answer matches');
});

test('call and text buttons dial the business number', async ({ page }) => {
  await page.goto('/contact/');
  await expect(page.getByRole('link', { name: /^Call/ }).first()).toHaveAttribute('href', 'tel:+19102095275');
  await expect(page.getByRole('link', { name: /^Text/ }).first()).toHaveAttribute('href', 'sms:+19102095275');
});

test('search engines are kept out until launch', async ({ page }) => {
  const robots = await (await page.request.get('/robots.txt')).text();
  expect(robots).toContain('Disallow: /');
  await page.goto('/');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test('footer shows the legal name and the year', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('footer')).toContainText(`© ${new Date().getFullYear()} WeatherBlock Roofing Incorporated`);
});

test('home page has RoofingContractor structured data', async ({ page }) => {
  await page.goto('/');
  const json = await page.locator('script[type="application/ld+json"]').first().textContent();
  const data = JSON.parse(json!);
  expect(data['@type']).toBe('RoofingContractor');
  expect(data.telephone).toBe('+19102095275');
  expect(data.aggregateRating).toBeUndefined();
});

test('the site stays light when the phone is set to dark mode', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto('/');
  const colors = await page.evaluate(() => ({
    page: getComputedStyle(document.documentElement).backgroundColor,
    text: getComputedStyle(document.body).color,
  }));
  expect(colors).toEqual({ page: 'rgb(250, 249, 246)', text: 'rgb(11, 37, 48)' });
  await context.close();
});

test('reduced motion is respected', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/');
  const duration = await page.evaluate(() => getComputedStyle(document.querySelector('.btn')!).transitionDuration);
  expect(['0s', '1e-05s', '0.00001s']).toContain(duration);
  await context.close();
});
