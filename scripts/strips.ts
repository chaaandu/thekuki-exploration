/**
 * Frame strips of the jar choreography (open or close), seeked to exact times so every
 * frame is reproducible.
 *
 *   node scripts/strips.ts [--tier=3d|2d] [--width=1440] [--jar=2] [--kind=open|close] [--daypart=day] [--out=name]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const BASE = args.base ?? 'http://127.0.0.1:9292';
const tier = args.tier ?? '3d';
const width = Number(args.width ?? 1440);
const height = width < 768 ? 844 : 900;
const jar = Number(args.jar ?? 2);
const kind = (args.kind ?? 'open') as 'open' | 'close';
const daypart = args.daypart ?? 'day';
const path = args.path ?? '/';
const name = args.out ?? `${kind}-${tier}-${width}-${daypart}`;
const times = args.times ? args.times.split(',').map(Number) : kind === 'open' ? [0, 0.2, 0.4, 0.62, 0.74, 0.84, 0.95, 1.1, 1.35, 1.75] : [0, 0.2, 0.4, 0.55, 0.7, 0.85, 1.05];

mkdirSync('artifacts/strips', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: width < 768 ? 2 : 1 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
});
await page.goto(`${BASE}${path}?tier=${tier}&daypart=${daypart}`);
await page.waitForFunction(() => (window as any).__kukiShelves?.length > 0, null, { timeout: 15000 });
if (tier === '3d') await page.waitForSelector('.shelf[data-tier="3d"]', { timeout: 30000 }).catch(() => errors.push('3D never became ready'));
const reason = await page.evaluate(() => document.querySelector<HTMLElement>('.shelf')?.dataset.tierReason ?? '');
// Bring the jar into view (phones: scroll the row so it's centred).
await page.evaluate((i) => {
  const el = document.querySelectorAll<HTMLElement>('.shelf [data-jar]')[i];
  el?.scrollIntoView({ block: 'center', inline: 'center' });
}, jar);
await page.waitForTimeout(400);
const box = await page.evaluate((i) => {
  const el = document.querySelectorAll<HTMLElement>('.shelf [data-jar]')[i]!.querySelector('.jar-art')!.getBoundingClientRect();
  return { x: el.left, y: el.top, w: el.width, h: el.height };
}, jar);
const clip = {
  x: Math.max(0, box.x - box.w * 0.55),
  y: Math.max(0, box.y - box.h * 0.95),
  width: box.w * 2.1,
  height: box.h * 2.05,
};
clip.width = Math.min(clip.width, width - clip.x);
clip.height = Math.min(clip.height, height - clip.y);

const frames: Buffer[] = [];
for (const t of times) {
  await page.evaluate(
    ([i, k, tt]) => {
      (window as any).__kukiShelves[0].seek(i, k, tt);
    },
    [jar, kind, t] as const,
  );
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(tier === '3d' ? 120 : 30);
  frames.push(await page.screenshot({ clip }));
}
const scaled = await Promise.all(frames.map((f) => sharp(f).resize({ height: 360 }).toBuffer({ resolveWithObject: true })));
const W = scaled.reduce((s, f) => s + f.info.width + 8, 8);
let x = 8;
await sharp({ create: { width: W, height: 360 + 40, channels: 3, background: '#cfc6b8' } })
  .composite(
    scaled.flatMap((f, i) => {
      const label = Buffer.from(`<svg width="${f.info.width}" height="24"><text x="4" y="17" font-family="Menlo" font-size="14" fill="#3b1a0c">t=${times[i]!.toFixed(2)}s</text></svg>`);
      const c = [
        { input: f.data, left: x, top: 8 },
        { input: label, left: x, top: 368 },
      ];
      x += f.info.width + 8;
      return c;
    }),
  )
  .png()
  .toFile(`artifacts/strips/${name}.png`);
console.log(`artifacts/strips/${name}.png  tier=${tier} reason=${reason}`);
if (errors.length) console.log('errors:\n' + errors.slice(0, 8).join('\n'));
await browser.close();
