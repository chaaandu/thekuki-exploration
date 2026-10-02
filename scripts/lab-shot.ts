/**
 * Screenshot the jar studio (dev only).
 *   node scripts/lab-shot.ts "<query>" <out.png> [width] [height]
 */
import { chromium } from '@playwright/test';

const [query = '', out = 'artifacts/scratch/lab.png', w = '900', h = '900'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
const logs: string[] = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 6).join('\n')}`));
await page.goto(`http://127.0.0.1:5180/?${query}`);
await page.waitForSelector('canvas');
await page.waitForTimeout(2500);
const gpu = await page.evaluate(() => {
  const c = document.createElement('canvas').getContext('webgl2');
  const ext = c?.getExtension('WEBGL_debug_renderer_info');
  return ext ? c!.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
await page.screenshot({ path: out });
console.log(`gpu: ${gpu}`);
if (logs.length) console.log(logs.slice(0, 10).join('\n'));
await browser.close();
