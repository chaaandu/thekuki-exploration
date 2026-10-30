import { test, expect } from '@playwright/test';
import { analytics, cartJson, resetStore } from './helpers.ts';

test.beforeEach(async ({ request, context }) => {
  await resetStore(request);
  await context.clearCookies();
});

test('fill a dabba of 3: every line carries the same gift box property', async ({ page }) => {
  await page.goto('/pages/dabba');
  const root = page.locator('[data-dabba][data-enhanced]');
  await expect(root).toBeVisible();
  const add = root.locator('[data-dabba-add]');
  await expect(add).toBeDisabled();
  for (const name of ['Masala', 'Omam', 'Boost']) {
    await root.locator('[data-dabba-flavour]', { hasText: name }).click();
  }
  await expect(root.locator('[data-dabba-status]')).toContainText('3 of 3 in · ₹597');
  await expect(add).toBeEnabled();
  await add.click();
  await expect(add).toHaveAttribute('data-state', 'added');
  const cart = await cartJson(page);
  expect(cart.item_count).toBe(3);
  const labels = new Set(cart.items.map((i: any) => i.properties?.['Gift box']));
  expect(labels.size).toBe(1);
  expect([...labels][0]).toMatch(/^Kuki dabba of 3 · #[A-Z0-9]{4}$/);
  expect((await analytics(page)).some((e) => e.name === 'kuki_dabba_built')).toBeTruthy();
});

test('gifting: logo goes on the box, mockup downloads, WhatsApp opens with the enquiry', async ({ page, context }) => {
  await page.goto('/pages/gifting?tier=2d');
  const root = page.locator('[data-gifting][data-enhanced]');
  await expect(root).toBeVisible();
  await root.locator('[data-gift-file]').setInputFiles('dev/fixtures/files/sample-company-logo.png');
  await expect(root.locator('[data-gift-logo-status]')).toContainText('Logo on the box');
  await root.locator('[data-gift-field="company"]').fill('Northwind Traders');
  await root.locator('[data-gift-field="quantity"]').fill('40');
  await root.locator('[data-gift-field="city"]').fill('Pune');

  const [download] = await Promise.all([page.waitForEvent('download'), root.locator('[data-gift-download]').click()]);
  expect(download.suggestedFilename()).toBe('kuki-gift-box-northwind-traders.png');

  // Don't actually leave for wa.me: catch the popup's URL.
  await context.route('https://wa.me/**', (route) => route.fulfill({ body: 'ok' }));
  const [popup] = await Promise.all([page.waitForEvent('popup'), root.locator('[data-gift-send]').click()]);
  const url = new URL(popup.url());
  expect(url.pathname).toBe('/919823012354');
  const text = url.searchParams.get('text') ?? '';
  expect(text).toContain('Company: Northwind Traders');
  expect(text).toContain('Boxes: 40');
  expect(text).toContain('City: Pune');
  expect(text).toContain('Flavours: All six flavours');
  await expect(root.locator('[data-gift-reminder]')).toBeVisible();
  const ev = (await analytics(page)).find((e) => e.name === 'kuki_gifting_enquiry');
  expect(ev?.data).toMatchObject({ quantity: 40, city: 'Pune', has_logo: true });
});

test('gifting needs a company and quantity before sending', async ({ page }) => {
  await page.goto('/pages/gifting?tier=2d');
  const root = page.locator('[data-gifting][data-enhanced]');
  await root.locator('[data-gift-send]').click();
  const valid = await root.locator('[data-gift-field="company"]').evaluate((el: HTMLInputElement) => el.validity.valid);
  expect(valid).toBe(false);
  expect((await analytics(page)).some((e) => e.name === 'kuki_gifting_enquiry')).toBeFalsy();
});
