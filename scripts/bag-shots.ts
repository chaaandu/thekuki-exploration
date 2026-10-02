/** Screenshots of the paper bag in its states (dev). node scripts/bag-shots.ts */
import { chromium } from '@playwright/test';
const BASE = 'http://127.0.0.1:9292';
const browser = await chromium.launch();
for (const [w, h, label] of [[390, 844, 'phone'], [1440, 900, 'desktop']] as const) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 768 ? 2 : 1, timezoneId: 'Asia/Kolkata' });
  const page = await ctx.newPage();
  await page.request.post(`${BASE}/__emulator/reset`);
  await page.goto(`${BASE}/?daypart=day`);
  for (const handle of ['masala-cookies', 'omam-cookies']) {
    const btn = page.locator(`[data-flavour-card][data-handle="${handle}"] button.btn--add`);
    await btn.click();
    await page.waitForTimeout(900);
  }
  await page.screenshot({ path: `artifacts/screens/p2/bag-closed-${label}.png` });
  await page.locator('[data-bag-open]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-bag-note]').fill('For Amma, with love');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `artifacts/screens/p2/bag-open-${label}.png` });
  await page.locator('[data-bag-suggest] button').click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `artifacts/screens/p2/bag-free-${label}.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `artifacts/screens/p2/bag-sealed-${label}.png` });
  await ctx.close();
}
await browser.close();
console.log('done');
