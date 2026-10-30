/**
 * Twist & send check: open the dialog on a product page, type a name, screenshot it at the
 * four sizes, then make the video (story + square) and save them.
 *
 *   node scripts/send-shots.ts [--handle=masala-cookies] [--out=artifacts/screens/6] [--sound]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const BASE = args.base ?? 'http://127.0.0.1:9292';
const OUT = args.out ?? 'artifacts/screens/6';
const HANDLE = args.handle ?? 'masala-cookies';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
for (const [w, h] of [[360, 800], [390, 844], [768, 1024], [1440, 900]] as const) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 800 ? 2 : 1, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[${w}] pageerror`, e.message));
  page.on('console', (m) => m.type() === 'warning' && console.log(`[${w}]`, m.text()));
  if (args.sound) await page.addInitScript(() => localStorage.setItem('kuki:prefs', JSON.stringify({ sound: true })));
  await page.goto(`${BASE}/products/${HANDLE}`, { waitUntil: 'networkidle' });
  const open = page.locator('[data-twist-send-open]');
  await open.waitFor();
  await open.click();
  await page.fill('[data-send-name]', 'Amma');
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${OUT}/send-${w}x${h}.png` });
  if (w === 1440) {
    for (const fmt of ['story', 'square']) {
      await page.locator(`[data-send-format][value="${fmt}"]`).check({ force: true });
      const t0 = Date.now();
      await page.click('[data-send-make]');
      const save = page.locator('[data-send-save]');
      await save.waitFor({ state: 'visible', timeout: 120_000 });
      const [dl] = await Promise.all([page.waitForEvent('download'), save.click()]);
      const name = dl.suggestedFilename();
      await dl.saveAs(`${OUT}/${fmt}-${name}`);
      console.log(`${fmt}: ${name} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
  }
  await ctx.close();
}
await browser.close();
