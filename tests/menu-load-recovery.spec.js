import { test, expect } from '@playwright/test';

const base = 'http://192.168.1.200:5555/api';
const runtime = { edition: 'community', mode: 'desktop', apiSchema: 1, features: {} };
const grant = { token: 'test-token', expiresIn: 86400, shopKey: 'test-shop',
  user: { id: 'staff' }, branches: [{ branch_id: 'branch', store_id: 'store', branch_name: 'Test shop' }] };
const menu = { type: 'success', data: { products: [{ category_name: 'Food', items: [
  { id: 'meal', name: 'Test meal', price: 100, final_price: 105, tax: 5, tax_type: 'exclusive', img: '' },
] }], table_service: true, tableorders: [{ id: 'table-9', tableorder_value: '9' }] } };

test('menu failure after successful sign-in remains visible instead of reopening server setup', async ({ page }) => {
  let failed = true;
  await page.addInitScript(base => localStorage.setItem('posnic.server', JSON.stringify({ active: base, pinned: base })), base);
  await page.route(base + '/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/accessQr')) return route.fulfill({ status: failed ? 503 : 200,
      json: failed ? { message: 'Menu temporarily unavailable' } : menu });
    return route.fulfill({ json: path.endsWith('/runtime-info') ? runtime : path.endsWith('/kioskMobileLogin') ? grant : { type: 'success', data: {} } });
  });
  await page.goto('/index.html');
  await page.locator('#username').fill('staff');
  await page.locator('#password').fill('test-password');
  await page.locator('#login-btn').click();
  await expect(page.locator('#error-popup-message')).toContainText('Menu temporarily unavailable');
  await expect(page.locator('#captain-legacy')).toBeVisible();
  await expect(page.locator('#captain-onboarding')).toBeHidden();
  await page.locator('#error-popup-close').click();
  failed = false;
  await page.locator('#login-btn').click();
  await expect(page).toHaveURL(/kot-management\.html$/);
});

test('missing table cache downloads once, offers retry on failure, and recovers tables and takeaway menu', async ({ page }) => {
  let failed = true, downloads = 0;
  await page.addInitScript(({ base, grant }) => {
    localStorage.setItem('posnic.server', JSON.stringify({ active: base, pinned: base }));
    localStorage.setItem('posnic.session', JSON.stringify(grant));
    localStorage.setItem('kiosk_selected_branch', 'store');
    localStorage.setItem('branch_id', 'branch');
  }, { base, grant });
  await page.route(base + '/**', route => {
    if (route.request().url().endsWith('/captain/v1/takeaway-number')) return route.fulfill({ json: { number: 1 } });
    if (route.request().url().endsWith('/accessQr')) {
      downloads++;
      return route.fulfill({ status: failed ? 503 : 200, json: failed ? { message: 'Unavailable' } : menu });
    }
    return route.fulfill({ json: route.request().url().endsWith('/runtime-info') ? runtime : { type: 'success', data: { tables: [] } } });
  });
  await page.goto('/discount.html');
  await expect(page.locator('.table-list')).toContainText('Could not load the menu');
  expect(downloads).toBe(1);
  failed = false;
  await page.locator('.table-list').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('input[name="table_no"][value="9"]')).toBeAttached();
  expect(downloads).toBe(2);
  await expect(page.locator('.table-list')).not.toContainText('Loading tables');
  await page.getByText('Take away', { exact: true }).click();
  await expect(page).toHaveURL(/products\.html$/);
  await expect(page.getByText('Test meal', { exact: true })).toBeVisible();
});
