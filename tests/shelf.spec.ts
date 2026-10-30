import { test, expect, type Page } from '@playwright/test';
import { analytics, resetStore } from './helpers.ts';

test.beforeEach(async ({ request, context }) => {
  await resetStore(request);
  await context.clearCookies();
});

const jar = (page: Page, handle: string) => page.locator(`.shelf [data-jar][data-handle="${handle}"]`);

async function ready(page: Page, query = 'tier=2d') {
  await page.goto(`/?${query}&daypart=day`);
  await page.waitForFunction(() => (window as any).__kukiShelves?.length > 0);
}

test('tapping a jar twists it open (under 2s) and the tag turns over to sell', async ({ page }) => {
  await ready(page);
  const masala = jar(page, 'masala-cookies');
  await masala.scrollIntoViewIfNeeded();
  const started = Date.now();
  await masala.locator('[data-jar-summary]').click();
  await expect(masala.locator('[data-jar-panel]')).toBeVisible({ timeout: 2000 });
  await expect(masala).toHaveAttribute('data-state', 'open');
  expect(Date.now() - started).toBeLessThan(2500);
  await expect(masala.locator('.tag__memory')).toContainText('Evening chai');
  await expect(masala.locator('.tag__pairing')).toHaveText('Best with evening chai');
  const events = await analytics(page);
  expect(events.find((e) => e.name === 'kuki_twist')?.data).toMatchObject({ handle: 'masala-cookies', method: 'tap', source: 'shelf' });
});

test('the keyboard twists too: six quarter turns with → open it, Esc closes it', async ({ page }) => {
  await ready(page);
  const omam = jar(page, 'omam-cookies');
  await omam.scrollIntoViewIfNeeded();
  await omam.locator('[data-jar-summary]').focus();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(170);
  }
  await expect(omam).toHaveAttribute('data-state', 'open', { timeout: 2500 });
  await expect(omam.locator('details')).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(omam).toHaveAttribute('data-state', 'closed');
  await expect(omam.locator('details')).not.toHaveAttribute('open', '');
  const twist = (await analytics(page)).find((e) => e.name === 'kuki_twist');
  expect(twist?.data.method).toBe('keys');
});

test('opening another jar screws the open one shut', async ({ page }) => {
  await ready(page);
  const boost = jar(page, 'boost-cookies');
  const rose = jar(page, 'rose-gulkand');
  await boost.locator('[data-jar-summary]').click();
  await expect(boost).toHaveAttribute('data-state', 'open', { timeout: 2500 });
  await rose.locator('[data-jar-summary]').click();
  await expect(rose).toHaveAttribute('data-state', 'open', { timeout: 2500 });
  await expect(boost).toHaveAttribute('data-state', 'closed');
});

test('buying from the tag: size switch, add, then the lid screws back on', async ({ page }) => {
  await ready(page);
  const blueberry = jar(page, 'blueberry-cookies');
  await blueberry.locator('[data-jar-summary]').click();
  const panel = blueberry.locator('[data-jar-panel]');
  await expect(panel).toBeVisible({ timeout: 2500 });
  await panel.locator('.size-toggle__option').nth(1).click();
  await expect(panel.locator('button.btn--add')).toContainText('Add 250g · ₹449');
  await panel.locator('button.btn--add').click();
  await expect(panel.locator('button.btn--add')).toHaveAttribute('data-state', 'added');
  await expect(page.locator('[data-bag-open]')).toHaveAccessibleName(/1 item,\s*₹449/);
  await expect(blueberry).toHaveAttribute('data-state', 'closed', { timeout: 3000 });
  const names = (await analytics(page)).map((e) => e.name);
  expect(names).toEqual(expect.arrayContaining(['kuki_twist', 'kuki_size_switch', 'kuki_add_to_bag']));
});

test('with reduced motion the jar simply opens (no twist, no aroma)', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('/?daypart=day');
  await page.waitForFunction(() => (window as any).__kukiShelves?.length > 0);
  const masala = jar(page, 'masala-cookies');
  await masala.locator('[data-jar-summary]').click();
  await expect(masala).toHaveAttribute('data-state', 'open', { timeout: 300 });
  await expect(page.locator('.shelf')).toHaveAttribute('data-tier', '2d');
  expect(await page.locator('.jar__particle').count()).toBe(0);
  await context.close();
});

test('product pages twist their jar open on arrival', async ({ page }) => {
  await page.goto('/products/rose-gulkand?tier=2d&daypart=day');
  const j = page.locator('.pdp [data-jar]');
  await expect(j).toHaveAttribute('data-state', 'open', { timeout: 4000 });
  const twist = (await analytics(page)).find((e) => e.name === 'kuki_twist');
  expect(twist?.data).toMatchObject({ handle: 'rose-gulkand', method: 'auto', source: 'pdp' });
});

test('3D shelf: loads after first paint, takes over, and still opens jars', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'GPU 3D checked on desktop');
  await page.goto('/?tier=3d&daypart=day');
  await expect(page.locator('.shelf')).toHaveAttribute('data-tier', '3d', { timeout: 30000 });
  await expect(page.locator('.shelf__canvas')).toHaveCount(1);
  const masala = jar(page, 'masala-cookies');
  await masala.locator('[data-jar-summary]').click();
  await expect(masala).toHaveAttribute('data-state', 'open', { timeout: 2500 });
});

test('dragging in a circle on the lid unscrews it (1.5 turns pops it open)', async ({ page }) => {
  await ready(page);
  const boost = jar(page, 'boost-cookies');
  await boost.scrollIntoViewIfNeeded();
  const box = (await boost.locator('.jar-art').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * (23 / 190);
  const r = box.width * 0.3;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  // 1.7 turns, in small steps, like a finger going round the lid.
  for (let i = 1; i <= 120; i++) {
    const a = (i / 120) * Math.PI * 2 * 1.7;
    await page.mouse.move(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  await page.mouse.up();
  await expect(boost).toHaveAttribute('data-state', 'open', { timeout: 2500 });
  const twist = (await analytics(page)).find((e) => e.name === 'kuki_twist');
  expect(twist?.data.method).toBe('drag');
});

test('the controls pill: sound, reduce motion and just-the-shelf (Esc brings everything back)', async ({ page }) => {
  await ready(page);
  const pill = page.locator('[data-shelf-controls]');
  const sound = pill.locator('[data-pref="sound"]');
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-sound', 'on');
  await pill.locator('[data-pref="motion"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await pill.locator('[data-pref="justShelf"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-just-shelf', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).not.toHaveAttribute('data-just-shelf', 'true');
  // Preferences survive a reload.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
});
