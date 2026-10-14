import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';

for (const width of [320, 768, 1024]) test(`compact tables remain reachable at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await onTheMenu(page, 'nothing');
  const tables = Array.from({ length: 40 }, (_, i) => ({ id: String(i + 1), tableorder_value: String(i + 1), status: 'available' }));
  await page.evaluate(rows => localStorage.setItem('kiosk_tableorders', JSON.stringify(rows)), tables);
  await page.route('**/captain/v1/tables', r => r.fulfill({ json: { tables } }));
  await page.route('**/sales/getTablesWithActiveOrders', r => r.fulfill({ json: { type: 'success', data: { tables: tables.slice(0,24).map(t=>t.tableorder_value), table_details: tables.slice(0,24).map(t=>({table_number:t.tableorder_value,orders:1,total:250})) } } }));
  await page.goto('/discount.html');
  const tile = page.locator('.table-label').first();
  await expect(tile).toBeVisible();
  const box = await tile.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeLessThanOrEqual(68);
  const last = page.locator('.table-label').filter({ has: page.locator('.entry-table-name', {hasText:/40$/}) });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/kot-management.html');
  await expect(page.locator('.floor-card')).toHaveCount(24);
  const metrics = await page.locator('.floor-grid').evaluate(el => ({ columns: getComputedStyle(el).gridTemplateColumns.split(' ').length, height: el.firstElementChild.getBoundingClientRect().height }));
  expect(metrics.columns).toBeGreaterThanOrEqual(width === 320 ? 2 : width === 768 ? 4 : 5);
  expect(metrics.height).toBeLessThanOrEqual(160);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-artifacts/compact-floor-${width}.png`, fullPage: true });
});
