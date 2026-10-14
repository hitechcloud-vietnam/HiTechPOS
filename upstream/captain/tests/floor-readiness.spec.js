import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';

test('floor shows partial then all ready, item names, and clears stale readiness', async ({ page }) => {
  await onTheMenu(page, 'nothing');
  let ready = 2, fail = false;
  await page.route('**/sales/getTablesWithActiveOrders', r => r.fulfill({ json: {
    type: 'success', data: { tables: ['4'] },
  } }));
  await page.route('**/captain/v1/kitchen-ready', r => r.fulfill(fail
    ? { status: 503, json: { message: 'offline' } }
    : { json: { tickets: [{ table: '4', items: [{ ready, served: 0 }] }],
      readiness: [{ table: '4', remaining: 5, ready,
        items: [{ name: 'Fish', quantity: ready, roundId: 'c0' }] }] } }));
  await page.goto('/kot-management.html');
  await expect(page.locator('.floor-ready')).toHaveText('Ready · 2 / 5');
  await expect(page.locator('.floor-card')).toContainText('2 × Fish');
  ready = 5;
  await page.locator('#floor-refresh').click();
  await expect(page.locator('.floor-ready')).toHaveText('Ready · 5 / 5');
  await expect(page.locator('.floor-card')).toContainText('5 × Fish');
  fail = true;
  await page.locator('#floor-refresh').click();
  await expect(page.locator('.floor-ready')).toHaveCount(0);
  await expect(page.locator('.floor-card')).not.toContainText('× Fish');
});
