import { test, expect } from '@playwright/test';
import { analytics } from './helpers.ts';

test('Twist & send makes a named video of the jar', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/products/omam-cookies');
  const open = page.locator('[data-twist-send-open]');
  await expect(open).toBeVisible();
  await open.click();
  const dialog = page.locator('dialog[data-twist-send]');
  await expect(dialog).toBeVisible();
  // Nothing to share or save until a video exists.
  await expect(dialog.locator('[data-send-share]')).toBeHidden();
  await expect(dialog.locator('[data-send-save]')).toBeHidden();
  await dialog.locator('[data-send-name]').fill('Ravi');
  await dialog.locator('[data-send-format][value="square"]').check({ force: true });
  await dialog.locator('[data-send-make]').click();
  const save = dialog.locator('[data-send-save]');
  await expect(save).toBeVisible({ timeout: 60_000 });
  await expect(save).toHaveAttribute('download', /^kuki-omam-cookies-for-ravi\.(mp4|webm)$/);
  const ev = (await analytics(page)).find((e) => e.name === 'kuki_twist_send');
  expect(ev?.data).toMatchObject({ flavour: 'omam-cookies', format: 'square', has_name: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
