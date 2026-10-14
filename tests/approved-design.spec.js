import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';

test('route signals show measured reachability and open the shared address editor', async ({ page }) => {
  await onTheMenu(page, 'nothing');
  await page.goto('/kot-management.html');
  await page.waitForFunction(() => !!window.POSNIC);
  await page.evaluate(() => {

    POSNIC.server.remember({lan:'http://192.168.0.12:5555/api'});
    window.dispatchEvent(new CustomEvent('posnic:offline'));
  });
  await expect(page.locator('[data-route-signal=local]')).toHaveAttribute('data-reachable','false');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('posnic:online')));
  await expect(page.locator('[data-route-signal=remote]')).toHaveClass(/is-reachable/);
  await expect(page.locator('[data-route-signal=local]')).not.toHaveClass(/is-reachable/);
  await page.locator('[data-route-signal=remote]').click();
  await expect(page.locator('#connection-addresses')).toBeVisible();
  await expect(page.locator('#connection-cloud')).toHaveValue(/smoke.posnic.io/);
  await page.reload();
  await expect(page.locator('#connection-addresses')).toBeVisible();
  await expect(page).toHaveURL(/index.html/);
  await page.locator('#connection-back').click();
  await page.locator('#connection-back').click();
  await expect(page).toHaveURL(/kot-management/);
});

for (const width of [320,768,1024]) test(`approved floor navigation fits ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:900});
  await onTheMenu(page,'nothing');
  await page.goto('/kot-management.html');
  await expect(page.locator('.captain-navigation')).toBeVisible();
  await expect(page.locator('.connection-signals')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const nav = await page.locator('.captain-navigation').boundingBox();
  const action = await page.locator('.floor-new').boundingBox();
  expect(action.y + action.height).toBeLessThan(nav.y);
  await page.screenshot({path:`test-artifacts/approved-floor-${width}.png`,fullPage:true});
});
