import { test, expect } from '@playwright/test';
import { resetStore } from './helpers.ts';

// Playwright's stability checks never settle after a CSS animation when page JS is off;
// reduced motion removes the animation (the no-JS flow itself is identical).
test.use({ javaScriptEnabled: false, reducedMotion: 'reduce' });

test.beforeEach(async ({ request, context }) => {
  await resetStore(request);
  await context.clearCookies();
});

test('with JavaScript off you can still add, change quantity, write a note and check out', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('[data-flavour-card][data-handle="blueberry-cookies"]');
  await card.locator('.size-toggle__option').nth(1).click();
  await card.locator('button.btn--add').click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.locator('main .bag-line__title')).toHaveText('Blueberry');
  await expect(page.locator('main .bag-line__meta')).toContainText('250g');

  await page.locator('main .bag-line__input').fill('2');
  await page.getByRole('button', { name: 'Update bag' }).click();
  await expect(page.locator('main .bag-totals__value')).toHaveText('₹898');
  await expect(page.locator('main .meter__seal')).toBeVisible();

  await page.locator('#cart-note').fill('Happy birthday, Meera');
  await page.getByRole('button', { name: /Check out/ }).click();
  await expect(page).toHaveURL(/\/checkout/);
  await expect(page.getByText('Happy birthday, Meera')).toBeVisible();
});

test('a jar on the shelf opens and sells with JavaScript off (native details)', async ({ page }) => {
  await page.goto('/');
  const jar = page.locator('.shelf [data-jar][data-handle="masala-cookies"]');
  await jar.locator('summary').click();
  const panel = jar.locator('[data-jar-panel]');
  await expect(panel).toBeVisible();
  await panel.locator('button.btn--add').click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.locator('main .bag-line__title')).toHaveText('Masala');
});
