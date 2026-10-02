/**
 * Screenshots at the four CLAUDE.md sizes, plus one contact sheet per page.
 *
 *   node scripts/shots.ts --phase=1 [--pages=home,product] [--full] [--daypart=chai] [--base=http://127.0.0.1:9292]
 *
 * Output: artifacts/screens/<phase>/<page>-<w>x<h>.png and <page>-sheet.png
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
) as Record<string, string>;

const BASE = args.base ?? 'http://127.0.0.1:9292';
const PHASE = args.phase ?? 'scratch';
const FULL = args.full === 'true';
const DAYPART = args.daypart;
const SIZES: [number, number][] = [
  [360, 800],
  [390, 844],
  [768, 1024],
  [1440, 900],
];
const ALL: Record<string, string> = {
  home: '/',
  product: '/products/masala-cookies',
  collection: '/collections/all',
  contact: '/pages/contact',
  about: '/pages/about',
  'small-batch': '/pages/small-batch',
  cart: '/cart',
  '404': '/this-jar-does-not-exist',
  dabba: '/pages/dabba',
  gifting: '/pages/gifting',
};
const pages = (args.pages ? args.pages.split(',') : Object.keys(ALL)).filter((p) => ALL[p]);
const OUT = `artifacts/screens/${PHASE}`;
mkdirSync(OUT, { recursive: true });

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(250);
}

const browser = await chromium.launch();
for (const name of pages) {
  const files: string[] = [];
  for (const [w, h] of SIZES) {
    const context = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: w < 768 ? 2 : 1,
      isMobile: w < 768,
      hasTouch: w < 1024,
      timezoneId: 'Asia/Kolkata',
      locale: 'en-IN',
    });
    const page = await context.newPage();
    const url = new URL(ALL[name]!, BASE);
    if (DAYPART) url.searchParams.set('daypart', DAYPART);
    await page.goto(url.toString());
    await settle(page);
    const file = `${OUT}/${name}-${w}x${h}${FULL ? '-full' : ''}.png`;
    await page.screenshot({ path: file, fullPage: FULL });
    files.push(file);
    await context.close();
  }
  // Contact sheet: the four sizes side by side at the same height.
  const H = FULL ? 1800 : 900;
  const resized = await Promise.all(files.map((f) => sharp(f).resize({ height: H, fit: 'inside' }).png().toBuffer({ resolveWithObject: true })));
  const gap = 24;
  const width = resized.reduce((s, r) => s + r.info.width, 0) + gap * (resized.length + 1);
  let x = gap;
  const composites = resized.map((r) => {
    const c = { input: r.data, left: x, top: gap };
    x += r.info.width + gap;
    return c;
  });
  await sharp({ create: { width, height: H + gap * 2, channels: 3, background: '#d9d2c5' } })
    .composite(composites)
    .png()
    .toFile(`${OUT}/${name}-sheet${FULL ? '-full' : ''}.png`);
  console.log(`✓ ${name}`);
}
await browser.close();
