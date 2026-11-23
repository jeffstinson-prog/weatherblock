import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** WCAG 2.2 AA, checked with axe. */
export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
  expect(summary).toEqual([]);
}

/** Nothing wider than the screen: no sideways scrolling on a phone. */
export async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Every button-styled control is at least 44px tall: easy to hit with a thumb. */
export async function expectBigTapTargets(page: Page) {
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.btn, button, input[type="submit"]'))
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ text: el.textContent?.trim().slice(0, 40), h: el.getBoundingClientRect().height }))
      .filter((b) => b.h < 44),
  );
  expect(small).toEqual([]);
}

// Chrome reports a skipped page-to-page fade as a page error. It skips the fade when the next
// page's stylesheet isn't in its cache yet, and a test that intercepts requests runs with the
// cache off. Nothing is broken: the next page just appears without the fade.
const SKIPPED_FADE = /Transition was aborted because of invalid state/;

/** Collect console errors and CSP violations while a test runs. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    if (!SKIPPED_FADE.test(err.message)) errors.push(err.message);
  });
  return errors;
}
