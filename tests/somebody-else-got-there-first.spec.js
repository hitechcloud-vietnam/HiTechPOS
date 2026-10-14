import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';

/*
 * TWO PHONES, ONE ORDER, AND A DISH THAT VANISHES.
 *
 * A save sends the WHOLE order and the till keeps only what arrives. That is
 * how a cancelled dish gets cancelled, and it is right.
 *
 * It is also how a floor with several handsets loses food. Another waiter adds
 * a biryani while this screen is open; this screen saves a list that never had
 * it; the till removes a dish the kitchen has already cooked. The bill goes
 * out short and nobody is told.
 *
 * So the save says which version of the order it was looking at, and the till
 * refuses one written against an older version. What these hold is that the
 * phone SAYS it, and that being refused reads as "somebody else got there
 * first" rather than as an error the waiter caused.
 */

const ORDER = {
  _id: 'ord-1',
  order_number: 'K1',
  status: 'pending',
  dine_type: 'Dine-in',
  table_number: '4',
  table_id: 'tbl-four',
  person_count: 2,
  total_amount: 220,
  created_date: '2026-09-16T18:58:00.000Z',
  updated_date: '2026-09-16T19:00:00.000Z',
  items: [
    { product_id: 'p-cb', item_id: 'p-cb', name: 'Chicken Biryani', quantity: 1, price: 220 },
  ],
};

const TABLES = [
  { tableorder_value: 4, _id: { $oid: 'tbl-four' } },
  { tableorder_value: 12, _id: { $oid: 'tbl-twelve' } },
];

/** The order list, with one order on table 4. */
async function onTheOrderList(page, order = ORDER) {
  await onTheMenu(page, 'nothing');

  await page.route('**/sales/getOrderHistory', (route) =>
    route.fulfill({ json: { type: 'success', data: { orders: [order] } } })
  );
  await page.route('**/captain/v1/tables', route =>
    route.fulfill({json:{tables:TABLES}})
  );

  await page.goto('/order-history.html');
  await page.waitForFunction(() => typeof moveOrder === 'function');
  await page.evaluate((tables) => {
    localStorage.setItem('kiosk_tableorders', JSON.stringify(tables));
  }, TABLES);
  await page.evaluate(() => loadOrderHistory());
}

/** Catch what the next save sends, and answer however the test wants. */
function watchTheSave(page, answer) {
  const sent = [];
  page.route('**/sales/updateOrder', (route) => {
    sent.push(route.request().postDataJSON());
    route.fulfill(answer);
  });
  return sent;
}

const ACCEPTED = { json: { type: 'success', message: 'Order updated' } };
const REFUSED = { status: 409, json: { type: 'error', message: 'order_changed' } };

test('a move says which version of the order it was looking at', async ({ page }) => {
  await onTheOrderList(page);
  const sent = watchTheSave(page, ACCEPTED);

  await page.evaluate(() => moveOrder('ord-1'));
  await page.locator('.move-table[data-value="12"]').click();
  await page.locator('#move-table-go').click();

  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].seen_at).toBe('2026-09-16T19:00:00.000Z');
});

test('an order nobody has edited falls back to when it was opened', async ({ page }) => {
  /* A first edit has to be guarded too. Sending nothing would wave it
     through, which is the one case a busy table is most likely to hit. */
  const fresh = { ...ORDER, updated_date: undefined };
  await onTheOrderList(page, fresh);
  const sent = watchTheSave(page, ACCEPTED);

  await page.evaluate(() => moveOrder('ord-1'));
  await page.locator('.move-table[data-value="12"]').click();
  await page.locator('#move-table-go').click();

  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].seen_at).toBe('2026-09-16T18:58:00.000Z');
});

test('being refused reads as somebody else got there first', async ({ page }) => {
  /*
   * Not "could not move the order", which sounds like the phone failed and
   * invites a second tap. The waiter did nothing wrong and lost nothing: what
   * they typed was never sent.
   */
  await onTheOrderList(page);
  watchTheSave(page, REFUSED);

  await page.evaluate(() => moveOrder('ord-1'));
  await page.locator('.move-table[data-value="12"]').click();
  await page.locator('#move-table-go').click();

  await expect(page.locator('.toast, #toast, [class*="toast"]').first()).toContainText(
    /Somebody else changed this order/i
  );
});

test('the sheet closes on a refusal, rather than sitting there looking ready', async ({
  page,
}) => {
  /*
   * A sheet left open over an order that has moved on is an invitation to
   * press the same button again and get refused again.
   */
  await onTheOrderList(page);
  watchTheSave(page, REFUSED);

  await page.evaluate(() => moveOrder('ord-1'));
  await page.locator('.move-table[data-value="12"]').click();
  await page.locator('#move-table-go').click();

  await expect(page.locator('#moveTableModal')).toBeHidden();
});

test('a refusal fetches the order again, so the screen tells the truth', async ({ page }) => {
  await onTheOrderList(page);
  watchTheSave(page, REFUSED);

  let reloaded = 0;
  await page.route('**/sales/getOrderHistory', (route) => {
    reloaded += 1;
    route.fulfill({ json: { type: 'success', data: { orders: [ORDER] } } });
  });

  await page.evaluate(() => moveOrder('ord-1'));
  await page.locator('.move-table[data-value="12"]').click();
  await page.locator('#move-table-go').click();

  await expect.poll(() => reloaded).toBeGreaterThan(0);
});

test('an ordinary failure still reads as a failure', async ({ page }) => {
  /*
   * The conflict path must not swallow everything else. A server that is down
   * is a different problem and the waiter needs to know it is not their doing
   * either - but they must not be told somebody edited the order when nobody
   * did.
   */
  await onTheOrderList(page);
  watchTheSave(page, { status: 500, json: { type: 'error', message: 'boom' } });

  await page.evaluate(() => moveOrder('ord-1'));
  await page.locator('.move-table[data-value="12"]').click();
  await page.locator('#move-table-go').click();

  const said = page.locator('.toast, #toast, [class*="toast"]').first();
  await expect(said).toBeVisible();
  await expect(said).not.toContainText(/Somebody else changed/i);
});
