/**
 * Gifting studio check: upload a sample logo (fictional company), screenshot the studio at
 * the four sizes, and save the downloaded mockup PNG.
 *
 *   node scripts/gift-shots.ts [--base=http://127.0.0.1:9292] [--out=artifacts/screens/5] [--tier=2d]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const BASE = args.base ?? 'http://127.0.0.1:9292';
const OUT = args.out ?? 'artifacts/screens/5';
const TIER = args.tier ? `?tier=${args.tier}` : '';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
for (const [w, h] of [[360, 800], [390, 844], [768, 1024], [1440, 900]] as const) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 800 ? 2 : 1, acceptDownloads: true, hasTouch: w < 800 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[${w}] pageerror`, e.message));
  await page.goto(`${BASE}/pages/gifting${TIER}`, { waitUntil: 'networkidle' });
  await page.locator('[data-gifting][data-enhanced]').waitFor();
  await page.locator('[data-gift-file]').setInputFiles('dev/fixtures/files/sample-company-logo.png');
  await page.locator('[data-gift-logo-status]').filter({ hasText: /./ }).waitFor();
  await page.fill('[data-gift-field="company"]', 'Northwind Traders');
  await page.fill('[data-gift-field="city"]', 'Pune');
  await page.waitForTimeout(900);
  const tier = await page.locator('[data-gift-stage]').getAttribute('data-tier');
  await page.locator('.gift').screenshot({ path: `${OUT}/gifting-${w}x${h}.png` });
  console.log(`${w}x${h} tier=${tier}`);
  if (w === 1440) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-gift-download]')]);
    await dl.saveAs(`${OUT}/gifting-mockup${args.tier ? `-${args.tier}` : ''}.png`);
  }
  await ctx.close();
}
await browser.close();
