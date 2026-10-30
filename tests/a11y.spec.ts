import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PAGES = ['/', '/products/masala-cookies', '/collections/all', '/pages/dabba', '/pages/gifting', '/pages/about', '/pages/contact', '/pages/small-batch', '/cart', '/this-jar-does-not-exist'];

for (const path of PAGES) {
  test(`axe (WCAG 2.1 AA): ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 4).join(' | ')}`);
    expect(summary, summary.join('\n')).toEqual([]);
  });
}

test('the bag dialog passes axe when open', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-bag-open]').click();
  await expect(page.locator('[data-bag-sheet]')).toBeVisible();
  const results = await new AxeBuilder({ page }).include('[data-bag-sheet]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});
