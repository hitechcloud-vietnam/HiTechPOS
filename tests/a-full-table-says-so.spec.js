import { test, expect } from '@playwright/test';

/*
 * A table that cannot take another order says so, before the walk.
 *
 * The shop rule is now a setting: one open order per table (the default), no
 * limit, or at most N. The server enforces it - there is more than one handset
 * and two waiters can tap Send on the same table in the same second - but a
 * rule only the server knows is one a waiter meets at the end, after choosing
 * the table, adding the dishes and pressing Place Order.
 *
 * This screen already greyed out every table that had an order on it. That was
 * right only because the rule happened to be one. The question it asks has to
 * change from "does this table have an order?" to "has this table reached its
 * limit?", and the answer needs the count, not just the name.
 *
 * Three behaviours, and the middle one is the reason this is not a one-line
 * change:
 *
 *   limit 1   a busy table is full          (what it did before)
 *   limit 0   nothing is ever full
 *   limit N   busy and full are different, so the count has to be on screen
 *             and has to keep up as orders arrive
 */

const RUNTIME_INFO = {
  edition: 'cloud', mode: 'cloud', version: '1.0.0',
  channel: null, apiSchema: 1, syncProtocol: 1, features: { account: true }
};

const SHOP_ORIGIN = 'https://smoke.posnic.io';
const API_BASE = `${SHOP_ORIGIN}/api`;

const branchData = {
  type: 'success',
  data: {
    products: [{
      category_name: 'Food',
      items: [{
        id: 'product-1', name: 'Smoke Test Meal', available_quantity: 10,
        negative_stock: false, price: 100, final_price: 100,
        discount_price: 0, tax_price: 0, img: ''
      }]
    }],
    kiosk_images: {},
    /* Three configured tables, so "full", "has room" and "empty" can all be
       on screen at once. */
    tableorders: [
      { id: 't1', tableorder_value: '1' },
      { id: 't2', tableorder_value: '2' },
      { id: 't3', tableorder_value: '3' },
    ],
    kiosk_payment: {}
  }
};

/** The floor, as the server describes it. `limit` of null omits the field, which
    is what an older server sends. */
function floor({ open = {}, limit = 1 } = {}) {
  const names = Object.keys(open);
  const data = {
    tables: names,
    has_takeaway: false,
    table_details: names.map((n) => ({ table_number: n, orders: open[n], since: null, amount: 0 })),
  };
  if (limit !== null) data.table_order_limit = limit;
  return { type: 'success', data };
}

async function shop(page, floorAnswer) {
  await page.addInitScript((url) => {
    localStorage.setItem('posnic.server', JSON.stringify({ pinned: url, active: url }));
  }, API_BASE);

  const RESPONSES = {
    '/runtime-info': RUNTIME_INFO,
    '/users/kioskMobileLogin': {
      tokenType: 'Bearer', token: 'smoke-token', expiresIn: 86400,
      shopKey: 'smoke-shop-key', user: { id: 'user-1', name: 'smoke-user' },
      branches: [
        { branch_name: 'Main Branch', store_id: 'store-1', branch_id: 'branch-1', branch_image: 'store.png' },
        { branch_name: 'Second Branch', store_id: 'store-2', branch_id: 'branch-2', branch_image: 'store.png' }
      ]
    },
    '/items/accessQr': branchData,
    '/sales/getFrequentItems': { type: 'success', data: [] },
    '/sales/getListKot': { type: 'success', data: { orders: [] } },
    '/sales/getOrderHistory': { type: 'success', data: { orders: [] } },
  };

  await page.route(`${SHOP_ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const body = path === '/sales/getTablesWithActiveOrders'
      ? floorAnswer()
      : (RESPONSES[path] || { type: 'success', data: {} });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

/** Sign in and stop on the table picker. */
async function toTablePicker(page) {
  await page.goto('/index.html');
  await page.locator('#username').fill('smoke-user');
  await page.locator('#password').fill('smoke-password');
  await page.locator('#login-btn').click();
  await expect(page.getByText('Select Branch')).toBeVisible();
  await page.getByText('Main Branch').click();
  await expect(page).toHaveURL(/kot-management\.html$/);
  await page.waitForFunction(() => typeof window.goToAddKot === 'function');
  /* Captain's floor screen calls this .floor-new; the old name was
     .kot-btn-add and is gone. */
  await page.locator('.floor-new').click();
  await expect(page).toHaveURL(/discount\.html$/);
  await expect(page.locator('#table_1')).toHaveCount(1);
}

const table = (page, n) => page.locator('#table_' + n);

test('one order per table: a busy table cannot be chosen', async ({ page }) => {
  await shop(page, () => floor({ open: { '1': 1 }, limit: 1 }));
  await toTablePicker(page);

  await expect(table(page, 1)).toBeDisabled();
  await expect(table(page, 2)).toBeEnabled();
  /* And no count, because under this rule a table is either free or full and
     a "1" beside every busy one is noise. */
  await expect(page.locator('.table-open-count')).toHaveCount(0);
});

test('no limit: nothing is ever full', async ({ page }) => {
  await shop(page, () => floor({ open: { '1': 3, '2': 1 }, limit: 0 }));
  await toTablePicker(page);

  await expect(table(page, 1)).toBeEnabled();
  await expect(table(page, 2)).toBeEnabled();
  await expect(table(page, 3)).toBeEnabled();
});

test('at most three: two orders is busy, three is full, and the screen says which', async ({ page }) => {
  /* The case the old code could not express at all. */
  await shop(page, () => floor({ open: { '1': 3, '2': 2 }, limit: 3 }));
  await toTablePicker(page);

  await expect(table(page, 1)).toBeDisabled();
  await expect(table(page, 2)).toBeEnabled();
  await expect(table(page, 3)).toBeEnabled();

  /* A waiter has to be able to see that table 2 is at two of three. */
  await expect(page.locator('label[for="table_1"] .table-open-count')).toHaveText('3');
  await expect(page.locator('label[for="table_2"] .table-open-count')).toHaveText('2');
  await expect(page.locator('label[for="table_3"] .table-open-count')).toHaveCount(0);
});

test('a server too old to send the limit behaves exactly as before', async ({ page }) => {
  /*
   * The handset and the till ship separately, so an app that has updated will
   * meet a server that has not. Without a limit the answer is one, which is
   * what this screen did for its whole life.
   */
  await shop(page, () => floor({ open: { '1': 1 }, limit: null }));
  await toTablePicker(page);

  await expect(table(page, 1)).toBeDisabled();
  await expect(table(page, 2)).toBeEnabled();
});

test('a table filling up while the screen is open greys out on its own', async ({ page }) => {
  /*
   * The screen polls and redraws only when its view of the floor changes. That
   * key was built from table NAMES, so under "at most N" a table going from
   * two orders to three changed no name at all: the badge would have frozen
   * and the table would have stayed tappable right up to the refusal.
   */
  let open = { '1': 1 };
  await shop(page, () => floor({ open, limit: 2 }));
  await toTablePicker(page);

  await expect(table(page, 1)).toBeEnabled();
  await expect(page.locator('label[for="table_1"] .table-open-count')).toHaveText('1');

  open = { '1': 2 };
  await expect(table(page, 1)).toBeDisabled({ timeout: 15000 });
  await expect(page.locator('label[for="table_1"] .table-open-count')).toHaveText('2');
});

test('a full table cannot be chosen even by restoring an earlier selection', async ({ page }) => {
  /* The redraw puts back whatever was selected. A table that filled up while
     the waiter was deciding must not come back selected. */
  let open = {};
  await shop(page, () => floor({ open, limit: 1 }));
  await toTablePicker(page);

  /* The radio itself is display:none by design; a person taps the label. */
  await page.locator('label[for="table_1"]').click();
  await expect(table(page, 1)).toBeChecked();

  open = { '1': 1 };
  await expect(table(page, 1)).toBeDisabled({ timeout: 15000 });
  await expect(table(page, 1)).not.toBeChecked();
});
