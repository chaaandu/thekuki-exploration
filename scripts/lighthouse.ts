/**
 * Lighthouse (mobile, simulated 4G + 4× CPU slowdown) against the local emulator.
 *
 *   node scripts/lighthouse.ts [--pages=home,product] [--base=http://127.0.0.1:9292] [--out=artifacts/lighthouse]
 *
 * The emulator serves the theme without Shopify's CDN, so absolute numbers are a guide;
 * re-run on the unpublished theme preview before publishing.
 */
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const BASE = args.base ?? 'http://127.0.0.1:9292';
const OUT = args.out ?? 'artifacts/lighthouse';
const ALL: Record<string, string> = {
  home: '/',
  product: '/products/masala-cookies',
  collection: '/collections/all',
  dabba: '/pages/dabba',
  gifting: '/pages/gifting',
  about: '/pages/about',
  contact: '/pages/contact',
};
const pages = (args.pages ?? Object.keys(ALL).join(',')).split(',');
mkdirSync(OUT, { recursive: true });

const chrome = await chromeLauncher.launch({ chromePath: chromium.executablePath(), chromeFlags: ['--headless=new', '--no-first-run'] });
const rows: string[] = [];
let failed = false;
try {
  for (const name of pages) {
    const url = BASE + ALL[name];
    const result = await lighthouse(url, { port: chrome.port, output: 'html', logLevel: 'error' }, undefined);
    if (!result) continue;
    const c = result.lhr.categories;
    const score = (k: string) => Math.round((c[k]?.score ?? 0) * 100);
    const s = { perf: score('performance'), a11y: score('accessibility'), bp: score('best-practices'), seo: score('seo') };
    const lcp = result.lhr.audits['largest-contentful-paint']?.displayValue ?? '';
    const cls = result.lhr.audits['cumulative-layout-shift']?.displayValue ?? '';
    const tbt = result.lhr.audits['total-blocking-time']?.displayValue ?? '';
    writeFileSync(`${OUT}/${name}.html`, result.report as string);
    if (Object.values(s).some((v) => v < 90)) failed = true;
    rows.push(`${name.padEnd(11)} perf ${s.perf}  a11y ${s.a11y}  bp ${s.bp}  seo ${s.seo}   LCP ${lcp}  TBT ${tbt}  CLS ${cls}`);
    console.log(rows.at(-1));
    for (const [id, a] of Object.entries(result.lhr.audits)) {
      if (a.score !== null && a.score < 0.9 && a.scoreDisplayMode === 'binary') console.log(`   ✗ ${id}: ${a.title}`);
    }
  }
} finally {
  await chrome.kill();
}
writeFileSync(`${OUT}/summary.txt`, rows.join('\n') + '\n');
process.exitCode = failed ? 1 : 0;
