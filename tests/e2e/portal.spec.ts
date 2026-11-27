// The homeowner portal on phones: where things stand and what happens next for a
// booked visit, a message to the team (the owners hear, a task appears), and photos:
// the team's shared ones show, one nobody shared doesn't.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import { dayWord, refLabel, windowLabel } from '../../src/booking/format';
import { expectAccessible, expectBigTapTargets, expectNoSideScroll, watchErrors } from './helpers';

const DB = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/wb_e2e';
const NAME = 'Robin Portal';

test.describe.configure({ mode: 'serial' });

let bookingId = '';
let token = '';
let ref = '';
let slot = { id: '', startsAt: '', endsAt: '' };

// One booking per phone project, each on its own time and number, so the two never compete.
// Other tests book at the same moment: a time someone else just took means trying the next one.
test.beforeAll(async ({ request }, testInfo) => {
  const dark = testInfo.project.name === 'phone-390-dark';
  const { slots } = (await (await request.get('/api/slots')).json()) as { slots: (typeof slot)[] };
  let res;
  for (let i = Math.floor(slots.length * (dark ? 0.8 : 0.7)), tries = 0; tries < 4; i++, tries++) {
    slot = slots[i % slots.length]!;
    res = await request.post('/api/bookings', {
      data: {
        draftKey: crypto.randomUUID(),
        startedAt: Date.now() - 60_000,
        address: { text: '505 Test Portal Way, Sunset Beach, NC 28468', typed: true },
        relationship: 'owner',
        roof: { material: 'shingle', age: '15-20', reason: 'leak', notes: '' },
        slotId: slot.id,
        visit: { someoneHome: 'no', gateCode: '', pets: '' },
        contact: { name: NAME, mobile: dark ? '910 555 9202' : '910 555 9201', email: 'robin@example.com', smsConsent: true },
      },
    });
    if (res.status() !== 409) break;
  }
  expect(res!.status(), await res!.text()).toBe(201);
  const body = (await res!.json()) as { booking: { ref: string }; token: string };
  token = body.token;
  ref = body.booking.ref;
  const sql = postgres(DB);
  [{ id: bookingId }] = await sql`select id from wb.bookings where ref = ${ref}`;
  await sql.end();
});

const onPhone = (project: string) => test.skip(project !== 'phone-320', 'runs once, on the smallest phone');

async function open(page: Page) {
  await page.goto(`/b/#${token}`);
  await expect(page.locator('.portal-grid')).toBeVisible();
}

test('a booked visit: the tracker, the next step, and who to call', async ({ page }, testInfo) => {
  onPhone(testInfo.project.name);
  const errors = watchErrors(page);
  await open(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your roof project');
  await expect(page.getByText('505 Test Portal Way, Sunset Beach, NC 28468').first()).toBeVisible();

  // Six steps in order; booked is where things are, with today's date.
  const tracker = page.getByRole('region', { name: 'Progress' });
  const steps = tracker.getByRole('listitem');
  await expect(steps).toHaveCount(6);
  for (const [i, label] of ['Booked', 'Inspected', 'Estimate ready', 'Approved', 'Job scheduled', 'Done'].entries()) {
    await expect(steps.nth(i)).toContainText(label);
  }
  const today = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(new Date());
  const now = tracker.locator('[aria-current="step"]');
  await expect(now).toHaveCount(1);
  await expect(now.locator('.track-label')).toHaveText('Booked');
  await expect(now.locator('.track-date')).toHaveText(today);
  await expect(steps.nth(1)).not.toContainText(/\d/);

  // What happens next: the visit, with change and cancel.
  const next = page.getByRole('region', { name: 'Your inspection' });
  await expect(next.locator('.price')).toHaveText(`${dayWord(slot.startsAt)}, ${windowLabel(slot.startsAt, slot.endsAt)}`);
  await expect(next.getByRole('button', { name: 'Change the time' })).toBeVisible();
  await expect(next.getByRole('button', { name: 'Cancel the inspection' })).toBeVisible();
  await next.getByText('Add it to your calendar').click();
  await expect(next.getByRole('link', { name: /Google Calendar/ })).toHaveAttribute('href', /calendar\.google\.com/);

  // Photos come after the visit; the confirmation is in the messages, once for its email and text.
  await expect(page.getByRole('region', { name: 'Photos' })).toContainText('Photos from your inspection will show here.');
  const thread = page.getByRole('region', { name: 'Messages' }).locator('.thread > li');
  await expect(thread).toHaveCount(1);
  await expect(thread.first()).toContainText("You're booked for");
  await expect(thread.first()).toContainText('Email and text');

  // Your team: call, text and email, and the visit.
  const team = page.getByRole('region', { name: 'Your team' });
  await expect(team.getByRole('link', { name: /^Call/ })).toHaveAttribute('href', 'tel:+19104441849');
  await expect(team.getByRole('link', { name: /^Text/ })).toHaveAttribute('href', 'sms:+19104441849');
  await expect(team.getByRole('link', { name: /^Email/ })).toHaveAttribute('href', /^mailto:\S+@\S+$/);
  await expect(team.locator('.summary')).toContainText(refLabel(ref));
  await expect(page.getByRole('region', { name: 'Documents' })).toContainText('No documents yet.');

  await expectAccessible(page);
  await expectNoSideScroll(page);
  await expectBigTapTargets(page);
  expect(errors).toEqual([]);
});

test('a message to the team: it shows in the thread, the owners hear, and a task appears', async ({ page }, testInfo) => {
  onPhone(testInfo.project.name);
  await open(page);
  const messages = page.getByRole('region', { name: 'Messages' });
  const box = messages.getByLabel('Send us a message');

  // Nothing typed: the reason, read out, and the box marked.
  await messages.getByRole('button', { name: 'Send message' }).click();
  await expect(messages.getByRole('alert')).toHaveText('Type your message first.');
  await expect(box).toHaveAttribute('aria-invalid', 'true');
  await expect(box).toBeFocused();

  const words = 'Is the driveway OK for the dumpster on the day of the job?';
  await box.fill(words);
  await expect(box).not.toHaveAttribute('aria-invalid', 'true');
  await messages.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('status')).toHaveText("Sent. We'll get back to you soon.");
  await expect(box).toHaveValue('');
  const last = messages.locator('.thread > li').last();
  await expect(last).toContainText(words);
  await expect(last).toContainText('From this page');
  await expectAccessible(page);
  await expectNoSideScroll(page);

  // Still there after a reload: it was saved.
  await page.reload();
  await expect(page.getByRole('region', { name: 'Messages' }).locator('.thread > li').last()).toContainText(words);

  const sql = postgres(DB);
  const [saved] = await sql`select id, channel, direction, status from wb.messages where booking_id = ${bookingId} and kind = 'portal_message'`;
  expect(saved).toMatchObject({ channel: 'portal', direction: 'in', status: 'received' });
  // The owners' alert is recorded (logged: tests have no email keys).
  const alerts = await sql`select status from wb.messages where booking_id = ${bookingId} and kind = 'owner_portal_message' and audience = 'owner'`;
  expect(alerts.length).toBeGreaterThan(0);
  expect(alerts.every((a) => a.status === 'logged')).toBe(true);
  const tasks = await sql`select title, status from wb.tasks where auto_key = ${`message:${saved!.id}`}`;
  await sql.end();
  expect(tasks).toEqual([{ title: `Reply to ${NAME}'s message`, status: 'open' }]);
});

test('photos: a team photo marked shared shows; one nobody shared does not', async ({ page }, testInfo) => {
  onPhone(testInfo.project.name);
  // Storage in tests is a local folder; the server signs links to it.
  const put = (path: string) => {
    mkdirSync(dirname(join('.local-storage', path)), { recursive: true });
    copyFileSync('tests/e2e/fixtures/roof.jpg', join('.local-storage', path));
  };
  const shared = `team/${randomUUID()}.jpg`;
  const hidden = `team/${randomUUID()}.jpg`;
  const theirs = `uploads/${randomUUID()}.jpg`;
  for (const p of [shared, hidden, theirs]) put(p);
  const sql = postgres(DB);
  const row = (path: string, source: string, isShared: boolean, caption: string | null, ago: number) =>
    sql`insert into wb.booking_photos (booking_id, draft_key, path, content_type, bytes, source, shared, caption, created_at)
        values (${bookingId}, ${randomUUID()}, ${path}, 'image/jpeg', 910, ${source}, ${isShared}, ${caption}, now() - ${`${ago} minutes`}::interval)`;
  await row(theirs, 'customer', false, null, 30);
  await row(shared, 'team', true, 'Ridge vent, north side', 10);
  await row(hidden, 'team', false, 'Not for the customer', 5);
  await sql.end();

  await open(page);
  const photos = page.getByRole('region', { name: 'Photos' });
  const ridge = photos.getByRole('img', { name: 'Ridge vent, north side' });
  await expect(ridge).toBeVisible();
  await expect.poll(() => ridge.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(photos.getByRole('img', { name: 'Not for the customer' })).toHaveCount(0);
  await expect(page.getByText('Not for the customer')).toHaveCount(0);
  // Newest first: the team's, then the one they sent us.
  await expect(photos.getByRole('img')).toHaveCount(2);
  await expect(photos.getByRole('img').nth(1)).toHaveAttribute('alt', 'A photo you sent us');
  await expect(photos.locator('figcaption').first()).toContainText('From our team');
  // Each opens full size.
  const link = photos.getByRole('link').first();
  expect(await link.getAttribute('href')).toBe(await ridge.getAttribute('src'));
  await expectAccessible(page);
  await expectNoSideScroll(page);
});

test.describe('dark mode', () => {
  test('on a phone set to dark mode the portal stays light and passes accessibility checks', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-390-dark', 'dark mode check');
    await open(page);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgb(250, 249, 246)');
    await expect(page.getByRole('region', { name: 'Progress' }).locator('[aria-current="step"]')).toContainText('Booked');
    await expectAccessible(page);
    await expectNoSideScroll(page);
  });
});
