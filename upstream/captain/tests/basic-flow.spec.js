import { test, expect } from '@playwright/test';

/*
 * The whole flow, against a shop's cloud address.
 *
 * The app no longer has a built-in address: it is told a shop code or finds a
 * server on the Wi-Fi (see server-resolution.spec.js). So this seeds the pin
 * the way a configured handset would have it, and routes that host.
 */
const SHOP_ORIGIN = 'https://smoke.posnic.io';
const API_BASE = `${SHOP_ORIGIN}/api`;

/* What a Posnic server says about itself. Discovery accepts nothing else, so
   every routed host in these tests has to answer it. */
export const RUNTIME_INFO = {
  edition: 'cloud',
  mode: 'cloud',
  version: '1.0.0',
  channel: null,
  apiSchema: 1,
  syncProtocol: 1,
  features: { account: true, idempotentOrders: true }
};

const branchData = {
  type: 'success',
  data: {
    products: [{
      category_name: 'Food',
      items: [{
        id: 'product-1',
        name: 'Smoke Test Meal',
        available_quantity: 10,
        negative_stock: false,
        price: 100,
        final_price: 100,
        discount_price: 0,
        tax_price: 0,
        img: ''
      }]
    }],
    kiosk_images: {},
    tableorders: [],
    kiosk_payment: {}
  }
};

const RESPONSES = {
  '/runtime-info': RUNTIME_INFO,
  '/users/kioskMobileLogin': {
    tokenType: 'Bearer',
    token: 'smoke-token',
    expiresIn: 86400,
    shopKey: 'smoke-shop-key',
    user: { id: 'user-1', name: 'smoke-user' },
    branches: [
      { branch_name: 'Main Branch', store_id: 'store-1', branch_id: 'branch-1', branch_image: 'store.png' },
      { branch_name: 'Second Branch', store_id: 'store-2', branch_id: 'branch-2', branch_image: 'store.png' }
    ]
  },
  '/items/accessQr': branchData,
  '/sales/getTablesWithActiveOrders': { type: 'success', data: { tables: [] } },
  '/sales/getFrequentItems': { type: 'success', data: [] },
  '/sales/getListKot': { type: 'success', data: { orders: [] } },
  '/sales/qrOrder': {
    type: 'success',
    data: {
      tokenId: 'A101',
      orderId: 'SMOKE-ORDER-1',
      table_number: 'T1',
      branch_name: 'Main Branch',
      items: [{
        item_name: 'Smoke Test Meal',
        item_quantity: 1,
        item_base_price: 100,
        item_tax: 0,
        item_discount: 0,
        item_total: 100
      }],
      subtotal: 100,
      discount: 0,
      tax: 0,
      total: 100
    }
  },
  '/sales/getOrderHistory': { type: 'success', data: { orders: [] } }
};

for (const native of [false, true]) test(`login to order history basic flow (native=${native})`, async ({ page }) => {
  const apiCalls = [];
  const authHeaders = [];

  if (native) await page.addInitScript(() => {
    const status = () => {
      const session = JSON.parse(sessionStorage.getItem('test-secure-session') || '{}');
      return { session, pinSet: false, locked: false,
        profile: session.user ? { user: session.user, shopKey: session.shopKey, base: session.base } : null };
    };
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: { SecureSession: {
        status: async () => status(),
        save: async ({ session }) => { sessionStorage.setItem('test-secure-session', JSON.stringify(session)); return status(); },
        clear: async () => { sessionStorage.removeItem('test-secure-session'); return status(); },
        lock: async () => {},
      } },
    };
  });

  await page.addInitScript((url) => {
    localStorage.setItem('posnic.server', JSON.stringify({ pinned: url, active: url }));
  }, API_BASE);

  await page.route(`${SHOP_ORIGIN}/**`, async route => {
    /* Every call goes through the /api prefix now, which is what a cloud shop
       needs: the bare root also serves the shop's own web pages. */
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    apiCalls.push(path);
    const auth = route.request().headers()['authorization'];
    if (auth) authHeaders.push(path);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(RESPONSES[path] || { type: 'success', data: {} })
    });
  });

  await page.goto('/index.html');
  await page.locator('#username').fill('smoke-user');
  await page.locator('#password').fill('smoke-password');
  await page.locator('#login-btn').click();

  await expect(page.getByText('Select Branch')).toBeVisible();
  await page.getByText('Main Branch').click();
  await expect(page).toHaveURL(/kot-management\.html$/);

  await page.waitForFunction(() => typeof window.goToAddKot === 'function');
  await page.locator('.floor-new').click();
  await expect(page).toHaveURL(/discount\.html$/);
  await expect(page.locator('#manual_table_input')).toBeVisible();
  await page.locator('#manual_table_input').fill('T1');
  await page.getByRole('button', { name: /Next/ }).click();

  await expect(page).toHaveURL(/products\.html$/);
  await expect(page.getByText('Smoke Test Meal')).toBeVisible();
  await page.locator('.btn-add[data-id="product-1"]').click();
  await expect(page.locator('#cart-qty')).toHaveText('1');
  await page.locator('#next-btn').click();

  await expect(page).toHaveURL(/cart\.html$/);
  await expect(page.getByText('Smoke Test Meal')).toBeVisible();
  await page.locator('#next-btn').click();

  await expect(page).toHaveURL(/kot-management\.html$/);
  await expect.poll(() => apiCalls.filter(path => path === '/sales/qrOrder').length).toBe(1);
  await expect.poll(() => page.evaluate(() => window.OrderQueue?.count())).toBe(0);

  await page.goto('/order-history.html');
  await expect(page.getByRole('heading', { name: 'All Orders', exact: true })).toBeVisible();
  await page.locator('.mobile-header').getByRole('button', { name: 'Tables', exact: true }).click();
  await expect(page.locator('.table-card.all-tables')).toContainText('0 orders');

  expect(apiCalls).toEqual(expect.arrayContaining([
    '/users/kioskMobileLogin',
    '/items/accessQr',
    '/sales/qrOrder',
    '/sales/getOrderHistory'
  ]));

  /*
   * The reason the app used to load nothing past the branch list: these routes
   * refuse an anonymous caller, and the sign-in handed back no credential to
   * present. The token from kioskMobileLogin must reach every one of them.
   */
  expect(authHeaders).toEqual(expect.arrayContaining([
    '/items/accessQr',
    '/sales/qrOrder',
    '/sales/getOrderHistory'
  ]));
});

test('a branch list still responds after a tap that misses a card', async ({ page }) => {
  /*
   * The container listener was registered with { once: true }, so the FIRST
   * click it saw removed it - including a click on the gap between two cards,
   * which returned early and selected nothing. From then on the list was dead
   * and the only way out was to restart the app.
   */
  await page.addInitScript((url) => {
    localStorage.setItem('posnic.server', JSON.stringify({ pinned: url, active: url }));
  }, API_BASE);

  await page.route(`${SHOP_ORIGIN}/**`, async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(RESPONSES[path] || { type: 'success', data: {} })
    });
  });

  await page.goto('/index.html');
  await page.locator('#username').fill('smoke-user');
  await page.locator('#password').fill('smoke-password');
  await page.locator('#login-btn').click();
  await expect(page.getByText('Select Branch')).toBeVisible();

  // A tap on the container, between the cards.
  await page.locator('#branch-list-container').click({ position: { x: 2, y: 2 } });

  // The list must still work.
  await page.getByText('Second Branch').click();
  await expect(page).toHaveURL(/kot-management\.html$/);
});
