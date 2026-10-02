import { test, expect } from '@playwright/test';

// Every URL the live site has today keeps working.
const LIVE_URLS = [
  '/',
  '/collections/all',
  '/collections/frontpage',
  '/pages/contact',
  '/blogs/news',
  '/policies/privacy-policy',
  '/cart',
  '/search?q=masala',
  '/products/blueberry-cookies',
  '/products/boost-cookies',
  '/products/masala-cookies',
  '/products/nutella-cookies',
  '/products/omam-cookies',
  '/products/rose-gulkand',
];

for (const url of LIVE_URLS) {
  test(`live URL still works: ${url}`, async ({ page }) => {
    const res = await page.goto(url);
    expect(res?.status()).toBe(200);
    await expect(page.locator('main')).toBeVisible();
    expect(await page.locator('.liquid-error, [data-liquid-error]').count()).toBe(0);
  });
}

test('the old /#about and /#gifting menu links still land on something', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#about')).toHaveCount(1);
  await expect(page.locator('#gifting')).toHaveCount(1);
});

test('404 is an empty jar', async ({ page }) => {
  const res = await page.goto('/this-jar-does-not-exist');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("This jar's empty.");
});

test('every product page has Product JSON-LD with live prices and no invented ratings', async ({ page }) => {
  await page.goto('/products/masala-cookies');
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const graph = blocks.map((b) => JSON.parse(b)).flatMap((b) => b['@graph'] ?? [b]);
  const product = graph.find((n) => n['@type'] === 'Product');
  expect(product.name).toBe('Masala cookies');
  expect(product.offers.map((o: any) => o.price)).toEqual([199, 449]);
  expect(product.aggregateRating).toBeUndefined();
  expect(product.review).toBeUndefined();
});
