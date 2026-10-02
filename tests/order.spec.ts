import { test, expect } from '@playwright/test';
import { addFromList, analytics, bagButton, bagSheet, cartJson, openBag, resetStore } from './helpers.ts';

test.beforeEach(async ({ request, context }) => {
  await resetStore(request);
  await context.clearCookies();
});

test('a flavour reaches the bag in three taps, then checkout gets the right lines and the gift note', async ({ page }) => {
  await page.goto('/');
  // Tap 1: add Masala 100g straight from the flavour list.
  await addFromList(page, 'masala-cookies');
  await expect(bagButton(page)).toHaveAttribute('aria-label', /1 item/);
  await expect(page.locator('#kuki-announcer')).toContainText('Masala 100g added');

  // Tap 2: open the bag.
  await openBag(page);
  const sheet = bagSheet(page);
  await expect(sheet.locator('.bag-line')).toHaveCount(1);
  await expect(sheet.locator('.bag-line__title')).toHaveText('Masala');
  await expect(sheet.locator('.meter__text')).toContainText('₹400 away from free delivery');

  // The gift note is saved as the cart note.
  await sheet.locator('[data-bag-note]').fill('For Amma, with love');
  await expect(sheet.locator('[data-note-status]')).toHaveAttribute('data-state', 'saved');
  expect((await cartJson(page)).note).toBe('For Amma, with love');

  // Tap 3: check out. Shopify (here: the emulator's mock checkout) gets the lines + note.
  await sheet.locator('[data-bag-checkout-btn]').click();
  await expect(page).toHaveURL(/\/checkout/);
  await expect(page.getByText('Masala cookies')).toBeVisible();
  await expect(page.getByText('For Amma, with love')).toBeVisible();
  await page.getByRole('button', { name: 'Place test order' }).click();
  await expect(page.getByText(/Test order KUKI-DEV-\d+ placed/)).toBeVisible();
});

test('the one-tap suggestion crosses free delivery and the bag gets its stamp', async ({ page }) => {
  await page.goto('/');
  await addFromList(page, 'boost-cookies');
  await openBag(page);
  const sheet = bagSheet(page);

  // ₹199 in the bag, ₹400 to go: only a 250g (₹449) of a flavour not in the bag crosses.
  const suggest = sheet.locator('[data-bag-suggest] button');
  await expect(suggest).toContainText('250g');
  await expect(suggest).not.toContainText('Boost');
  await suggest.click();

  await expect(sheet.locator('.bag-line')).toHaveCount(2);
  await expect(sheet.locator('.meter__seal')).toBeVisible();
  await expect(sheet.locator('[data-bag-suggest]')).toHaveCount(0);
  await expect(page.locator('.bag__seal')).toHaveCount(1);
  const events = await analytics(page);
  expect(events.map((e) => e.name)).toContain('kuki_free_delivery_reached');
  expect(events.filter((e) => e.name === 'kuki_add_to_bag').map((e) => e.data.source)).toEqual(['counter', 'meter']);
});

test('three 100g packs are ₹597: the meter says ₹2 to go and offers a fourth flavour', async ({ page }) => {
  await page.goto('/');
  for (const handle of ['masala-cookies', 'omam-cookies', 'rose-gulkand']) await addFromList(page, handle);
  await openBag(page);
  const sheet = bagSheet(page);
  await expect(sheet.locator('.meter__text')).toContainText('₹2 away from free delivery');
  const suggest = sheet.locator('[data-bag-suggest] button');
  await expect(suggest).toContainText('100g');
  await expect(suggest).toContainText('₹199');
});

test('quantity steppers and remove update the bag in place, keeping focus', async ({ page }) => {
  await page.goto('/');
  await addFromList(page, 'nutella-cookies');
  await openBag(page);
  const sheet = bagSheet(page);
  const plus = sheet.getByRole('button', { name: /One more Nutella Chunk 100g/ });
  await plus.click();
  await expect(sheet.locator('.stepper__value')).toHaveText('2');
  await expect(sheet.locator('.bag-totals__value')).toHaveText('₹398');
  await expect(sheet.getByRole('button', { name: /One more Nutella Chunk 100g/ })).toBeFocused();
  await sheet.getByRole('button', { name: /Remove/ }).click();
  await expect(sheet.locator('.bag-empty')).toBeVisible();
  expect((await cartJson(page)).item_count).toBe(0);
});

test('the size toggle changes the button and what goes in the bag', async ({ page }) => {
  await page.goto('/products/omam-cookies');
  const buy = page.locator('.pdp__buy');
  await buy.locator('.size-toggle__option').nth(1).click();
  await expect(buy.locator('button.btn--add')).toContainText('Add 250g · ₹449');
  await buy.locator('button.btn--add').click();
  await expect(buy.locator('button.btn--add')).toHaveAttribute('data-state', 'added');
  const cart = await cartJson(page);
  expect(cart.items[0].variant_title).toBe('250g');
  const names = (await analytics(page)).map((e) => e.name);
  expect(names).toContain('kuki_size_switch');
  expect(names).toContain('kuki_add_to_bag');
});
