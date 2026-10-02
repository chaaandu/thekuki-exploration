import { expect, type Page, type APIRequestContext } from '@playwright/test';

export async function resetStore(request: APIRequestContext) {
  const res = await request.post('/__emulator/reset');
  expect(res.ok()).toBeTruthy();
}

export async function cartJson(page: Page): Promise<any> {
  return page.evaluate(async () => (await fetch('/cart.js', { headers: { Accept: 'application/json' } })).json());
}

/** Events published to Shopify customer events (captured by the emulator's analytics stub). */
export async function analytics(page: Page): Promise<{ name: string; data: Record<string, unknown> }[]> {
  return page.evaluate(() => (window as any).__kukiAnalytics ?? []);
}

export const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;

/** The bag control: floating bag on desktop, bottom bar on phones (same element). */
export const bagButton = (page: Page) => page.locator('[data-bag-open]');
export const bagSheet = (page: Page) => page.locator('[data-bag-sheet]');

export async function openBag(page: Page) {
  await bagButton(page).click();
  await expect(bagSheet(page)).toBeVisible();
}

export function card(page: Page, handle: string) {
  return page.locator(`[data-flavour-card][data-handle="${handle}"]`);
}

/** Add a flavour from the plain flavour list (the ≤3-tap path). */
export async function addFromList(page: Page, handle: string, sizeIndex: 1 | 2 = 1) {
  const c = card(page, handle);
  await c.scrollIntoViewIfNeeded();
  if (sizeIndex === 2) await c.locator('.size-toggle__option').nth(1).click();
  const btn = c.locator('button.btn--add');
  await btn.click();
  await expect(btn).toHaveAttribute('data-state', 'added');
}
