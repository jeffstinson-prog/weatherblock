// The assistant page on a phone, with the test stand-in for the model
// (tests never call Claude; the live checks are in tests/assistant-live).
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { expectAccessible, expectNoSideScroll } from './helpers';

const DB = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/wb_e2e';

test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone-320', 'runs once, on the smallest phone');
});

test('answers from the help center, says it is automated, links the answer', async ({ page }) => {
  await page.goto('/ask/');
  await expect(page.getByText('This is an automated assistant, not a person.')).toBeVisible();
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByRole('alert')).toHaveText('Type a question first.');
  await page.getByLabel('Your question').fill('How much does an inspection cost?');
  await page.getByRole('button', { name: 'Ask' }).click();
  const reply = page.locator('.chat li.assistant').last();
  await expect(reply).toContainText('free');
  await expect(reply.getByRole('link', { name: 'What does a roof inspection cost?' })).toHaveAttribute('href', '/help/cost/');
  await expectAccessible(page);
  await expectNoSideScroll(page);
});

test('a reply that breaks a rule is never shown', async ({ page }) => {
  await page.goto('/ask/');
  await page.getByLabel('Your question').fill('TEST_BREAK_RULE will my insurance pay?');
  await page.getByRole('button', { name: 'Ask' }).click();
  const reply = page.locator('.chat li.assistant').last();
  await expect(reply).toContainText("I can't give you a reliable answer");
  await expect(reply).not.toContainText('insurance will pay');
  await expect(reply).not.toContainText('deductible');
  await expect(reply.getByRole('link', { name: /Call/ })).toHaveAttribute('href', 'tel:+19104441849');
  // The owners see it in the app's question list, marked as stopped.
  const sql = postgres(DB);
  const [row] = await sql`select answered, blocked_rule from wb.assistant_questions where question like 'TEST_BREAK_RULE%' order by asked_at desc limit 1`;
  await sql.end();
  expect(row!.answered).toBe(false);
  expect(['insurance', 'deductible']).toContain(row!.blocked_rule);
});

test('starts a booking with what it learned', async ({ page }) => {
  await page.goto('/ask/');
  await page.getByLabel('Your question').fill('My roof is leaking over the kitchen. What do I do?');
  await page.getByRole('button', { name: 'Ask' }).click();
  const reply = page.locator('.chat li.assistant').last();
  await expect(reply).toContainText('Call us at (910) 444-1849');
  await reply.getByRole('button', { name: 'Book a free inspection' }).click();
  await expect(page).toHaveURL(/\/book\/$/);
  await page.getByRole('combobox', { name: 'Address of the home' }).fill('Test Main');
  await page.getByRole('option', { name: /404 Test Main/ }).click();
  await page.getByRole('radio', { name: "It's my home", exact: true }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('radio', { name: 'A leak', exact: true })).toBeChecked();
  await expect(page.getByLabel('Anything we should know?')).toHaveValue(/leaking over the kitchen/);
  await page.evaluate(() => localStorage.clear());
});
