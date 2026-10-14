import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';

/*
 * MOVING AN ORDER TO ANOTHER TABLE.
 *
 * Guests move. A two turns into a four, a table by the door turns out to be
 * under the air conditioner, a party joins another party.
 *
 * This was already possible and almost nobody could find it: Modify, scroll
 * past every dish on the order, find the table strip, change it, Update. That
 * is the screen for adding and cancelling dishes, so moving a table meant
 * walking through the one place where a mis-tap changes what the kitchen
 * cooks.
 *
 * What these hold is the shape of the thing: the order's LINES go back
 * untouched, the new table's id goes with its number, and a waiter is told
 * which tables are already working before they choose one rather than after.
 */

const TABLES = [
  { tableorder_value: 4, _id: { $oid: 'tbl-four' } },
  { tableorder_value: 12, _id: { $oid: 'tbl-twelve' } },
  { tableorder_value: 15, _id: { $oid: 'tbl-fifteen' } },
];

const ORDERS = [
  {
    _id: 'ord-1',
    created_date:'2026-09-30T10:00:00.000Z',
    updated_date:'2026-09-30T10:10:00.000Z',
    order_number: 'K1',
    status: 'pending',
    dine_type: 'Dine-in',
    table_number: '4',
    table_id: 'tbl-four',
    person_count: 2,
    total_amount: 220,
    items: [
      { product_id: 'p-cb', item_id: 'p-cb', name: 'Chicken Biryani', quantity: 1, price: 220 },
    ],
  },
  {
    _id: 'ord-2',
    order_number: 'K2',
    status: 'pending',
    dine_type: 'Dine-in',
    table_number: '15',
    table_id: 'tbl-fifteen',
    person_count: 4,
    total_amount: 40,
    items: [{ product_id: 'p-naan', item_id: 'p-naan', name: 'Butter Naan', quantity: 1, price: 40 }],
  },
  {
    _id: 'ord-3',
    order_number: 'K3',
    status: 'pending',
    dine_type: 'Take away',
    table_number: '',
    total_amount: 40,
    items: [{ product_id: 'p-naan', item_id: 'p-naan', name: 'Butter Naan', quantity: 1, price: 40 }],
  },
];

/** The order list, with a floor and three orders on it. */
async function onTheOrderList(page, { cleaningEnabled } = {}) {
  await onTheMenu(page, 'nothing');

  /*
   * Through the app's own loader, not by assigning window.allOrders. The
   * order list is a script-scoped binding, so a value hung on window is a
   * different variable that the screen never reads, and every test would then
   * be asking an empty list politely.
   */
  await page.route('**/sales/getOrderHistory', (route) =>
    route.fulfill({ json: { type: 'success', data: { orders: ORDERS } } })
  );

  await page.route('**/captain/v1/tables', async route => route.fulfill({json:{cleaningEnabled,tables:await page.evaluate(()=>JSON.parse(localStorage.getItem('kiosk_tableorders') || '[]'))}}));
  await page.goto('/order-history.html');
  await page.waitForFunction(() => typeof moveOrder === 'function');
  await page.evaluate(
    ({ tables, orders }) => {
      localStorage.setItem('kiosk_tableorders', JSON.stringify(tables));
      /* The fixtures, for the cases that draw a card directly. Not the app's
         order list, which is script-scoped and cannot be written from here. */
      window.__orders = orders;
    },
    { tables: TABLES, orders: ORDERS }
  );
  await page.evaluate(() => loadOrderHistory());
}

/** What the sheet offers, as the number and whatever it says underneath. */
const offered = (page) =>
  page.locator('#move-table-list .move-table').evaluateAll((rows) =>
    rows.map((row) => [
      row.querySelector('.move-table-no').textContent.trim(),
      (row.querySelector('.move-table-note') || {}).textContent?.trim() || '',
    ])
  );

test('the floor is shown, with where it is now and what is already working', async ({ page }) => {
  await onTheOrderList(page);
  await page.evaluate(() => moveOrder('ord-1'));

  await expect(page.locator('#move-table-now')).toHaveText('Now on table 4');
  await expect(page.locator('#move-table-list .move-table')).toHaveCount(3);
  expect(await offered(page)).toEqual([
    ['4', 'here now'],
    ['12', ''],
    ['15', 'has an order'],
  ]);
});

test('the table it is already on cannot be chosen', async ({ page }) => {
  /* Moving a table to itself is a kitchen ticket for nothing. */
  await onTheOrderList(page);
  await page.evaluate(() => moveOrder('ord-1'));

  await expect(page.locator('.move-table[data-value="4"]')).toBeDisabled();
  await expect(page.locator('.move-table[data-value="12"]')).toBeEnabled();
});

test('choosing is not moving', async ({ page }) => {
  /*
   * The floor is not a place where anybody taps carefully. A tap that moved
   * the order the moment it landed would turn a mis-tap into a table change
   * the kitchen hears about.
   */
  await onTheOrderList(page);
  await page.evaluate(() => moveOrder('ord-1'));

  const sent = [];
  await page.route('**/sales/updateOrder', (route) => {
    sent.push(route.request().postDataJSON());
    route.fulfill({ json: { type: 'success', message: 'ok' } });
  });

  await page.locator('.move-table[data-value="12"]').click();

  expect(sent).toEqual([]);
  await expect(page.locator('#move-table-go')).toHaveText('Move to table 12');
});

test('the move carries the new table AND its id, with the lines untouched', async ({ page }) => {
  await onTheOrderList(page);
  await page.evaluate(() => moveOrder('ord-1'));

  let sent = null;
  await page.route('**/sales/updateOrder', (route) => {
    sent = route.request().postDataJSON();
    route.fulfill({ json: { type: 'success', message: 'Order updated' } });
  });

  await page.locator('.move-table[data-value="12"]').click();
  await page.locator('#move-table-go').click();
  await expect.poll(() => sent).not.toBeNull();

  expect(sent.order_id).toBe('ord-1');
  expect(sent.seen_at).toBe('2026-09-30T10:10:00.000Z');
  expect(sent.table_number).toBe('12');
  /* The id, which is the half the till used to drop on the floor. */
  expect(sent.table_id).toBe('tbl-twelve');

  /* Nothing else about the order moved with it. */
  expect(sent.items).toHaveLength(1);
  expect(sent.items[0].quantity).toBe(1);
  expect(sent.person_count).toBe(2);
  expect(sent.dine_type).toBe('Dine-in');
});

test('a takeaway has no table to move it to, and is not offered one', async ({ page }) => {
  await onTheOrderList(page);
  await page.evaluate(() => showOrderListScreen('all'));
  await expect(page.locator('.order-card').first()).toBeVisible();

  /* All three orders are listed; only the two on tables can be moved. */
  expect(await page.locator('.order-card').count()).toBe(3);
  expect(await page.locator('.order-card .move-btn').count()).toBe(2);

  /*
   * And it is the takeaway that is missing one, not whichever card happened
   * to be third. Found by the order's own id, because the card shows its
   * number in a format this test should not be asserting the shape of.
   */
  const takeaway = page.locator('.order-card[data-order-id="ord-3"]');
  await expect(takeaway).toHaveCount(1);
  expect(await takeaway.locator('.move-btn').count()).toBe(0);
});

test('held, cleaning and undersized tables are unavailable before confirming a move',async({page})=>{
 await onTheOrderList(page, { cleaningEnabled: true });
 await page.evaluate(()=>{localStorage.setItem('kiosk_tableorders',JSON.stringify([
  {tableorder_value:'4',capacity:4,max_capacity:4},
  {tableorder_value:'12',capacity:4,max_capacity:4,service_state:'cleaning'},
  {tableorder_value:'15',capacity:4,max_capacity:4,service_state:'held'},
  {tableorder_value:'16',capacity:1,max_capacity:1},
  {tableorder_value:'17',capacity:2,max_capacity:2}
 ]));moveOrder('ord-1');});
 for(const value of ['4','12','15','16'])await expect(page.locator(`.move-table[data-value="${value}"]`)).toBeDisabled();
 await expect(page.locator('.move-table[data-value="17"]')).toBeEnabled();
 await expect(page.locator('.move-table[data-value="12"]')).toContainText('Cleaning');
});

for (const cleaningEnabled of [undefined, false]) {
 test(`cleaning does not block moving a table when ${cleaningEnabled === undefined ? 'unset' : 'disabled'}`,async({page})=>{
  await onTheOrderList(page, { cleaningEnabled });
  await page.evaluate(()=>{
   localStorage.setItem('kiosk_tableorders',JSON.stringify([
    {tableorder_value:'4',capacity:4},
    {tableorder_value:'12',capacity:4,service_state:'cleaning'}
   ]));
   moveOrder('ord-1');
  });
  await expect(page.locator('.move-table[data-value="12"]')).toBeEnabled();
  await expect(page.locator('.move-table[data-value="12"]')).not.toContainText('Cleaning');
 });
}


test('pending move cannot be dismissed or submitted twice and failure restores selection',async({page})=>{
 await onTheOrderList(page);
 let release, sent=0;
 const gate=new Promise(resolve=>{release=resolve;});
 await page.route('**/sales/updateOrder',async route=>{sent++;await gate;await route.fulfill({status:500,json:{message:'Try again'}});});
 await page.evaluate(()=>moveOrder('ord-1'));
 await page.locator('.move-table[data-value="12"]').click();
 await page.locator('#move-table-go').click();
 await expect.poll(()=>sent).toBe(1);
 await page.evaluate(()=>{confirmMoveTable();bootstrap.Modal.getInstance(document.getElementById('moveTableModal')).hide();moveOrder('ord-2');});
 await expect(page.locator('#moveTableModal')).toHaveClass(/show/);
 await expect(page.locator('#moveTableModal')).toHaveAttribute('aria-busy','true');
 await expect(page.locator('.move-table[data-value="15"]')).toBeDisabled();
 expect(sent).toBe(1);
 release();
 await expect(page.locator('#move-table-go')).toBeEnabled();
 await expect(page.locator('.move-table[data-value="12"]')).toHaveClass(/is-chosen/);
 await page.locator('#moveTableModal [data-bs-dismiss]').last().click();
 await expect(page.locator('#moveTableModal')).toBeHidden();
});


test('live move choices replace cache and account for guests already seated',async({page})=>{
 await onTheOrderList(page);
 await page.route('**/captain/v1/tables',route=>route.fulfill({json:{tables:[
  {id:'new-small',tableorder_value:'20',capacity:4,max_capacity:4,status:'occupied',orders:[{id:'other',guests:3}]},
  {id:'new-room',tableorder_value:'21',capacity:6,max_capacity:6,status:'occupied',orders:[{id:'other2',guests:3}]},
  {id:'closing',tableorder_value:'22',capacity:6,status:'occupied',closing:{request_id:'closing'}}
 ]}}));
 await page.evaluate(()=>moveOrder('ord-1'));
 await expect(page.locator('.move-table')).toHaveCount(3);
 await expect(page.locator('.move-table[data-value="12"]')).toHaveCount(0);
 await expect(page.locator('.move-table[data-value="20"]')).toBeDisabled();
 await expect(page.locator('.move-table[data-value="21"]')).toBeEnabled();
 await expect(page.locator('.move-table[data-value="22"]')).toBeDisabled();
});

test('failed table refresh leaves no stale choices and Retry restores current floor',async({page})=>{
 await onTheOrderList(page);
 let failed=true;
 await page.route('**/captain/v1/tables',route=>route.fulfill(failed?{status:503,json:{message:'offline'}}:{json:{tables:[{id:'fresh',tableorder_value:'30',capacity:4}]}}));
 await page.evaluate(()=>moveOrder('ord-1'));
 await expect(page.locator('#move-table-retry')).toBeVisible();
 await expect(page.locator('.move-table')).toHaveCount(0);
 await expect(page.locator('#move-table-go')).toBeDisabled();
 failed=false;
 await page.locator('#move-table-retry').click();
 await expect(page.locator('.move-table[data-value="30"]')).toBeEnabled();
 await page.locator('#moveTableModal [data-bs-dismiss]').last().click();
 await expect(page.locator('#moveTableModal')).toBeHidden();
});


test('group move resumes the saved request after reopening the screen',async({page})=>{
 await onTheOrderList(page);
 await page.route('**/sales/getOrderHistory',route=>route.fulfill({json:{type:'success',data:{orders:ORDERS.map(order=>order._id==='ord-1'?{...order,seating_request_id:'seating-original',seating_table_ids:['tbl-four']}:order)}}}));
 await page.evaluate(()=>loadOrderHistory());
 let fail=true;const prepares=[];
 await page.route('**/captain/v1/tables/move/prepare',route=>{const body=route.request().postDataJSON();prepares.push(body);return route.fulfill({json:{request_id:body.request_id,orderId:body.orderId,state:'reserved'}});});
 await page.route('**/captain/v1/tables/move/complete',route=>route.fulfill(fail?{status:503,json:{message:'offline'}}:{json:{request_id:route.request().postDataJSON().request_id,orderId:'ord-1',state:'submitting'}}));
 await page.evaluate(()=>moveOrder('ord-1'));
 await page.locator('.move-table[data-value="12"]').click();
 await page.locator('#move-table-go').click();
 await expect.poll(()=>prepares.length).toBe(1);
 await expect(page.locator('#move-table-go')).toHaveText('Retry');
 await expect(page.locator('.move-table')).toHaveCount(0);
 await expect(page.locator('#move-table-go')).toBeEnabled();
 await page.locator('#moveTableModal [data-bs-dismiss]').last().click();
 await expect(page.locator('#moveTableModal')).toBeHidden();
 await page.reload();
 await page.evaluate(()=>loadOrderHistory());
 await page.evaluate(()=>moveOrder('ord-1'));
 await expect(page.locator('#move-table-go')).toHaveText('Retry');
 fail=false;
 await page.locator('#move-table-go').click();
 await expect(page.locator('#moveTableModal')).toBeHidden();
 expect(prepares).toHaveLength(2);
 expect(prepares[1]).toEqual(prepares[0]);
 expect(await page.evaluate(()=>CaptainGroupMove.pending('ord-1'))).toBeNull();
});

test('a saved move can be cancelled and a lost cancellation reply survives reload',async({page})=>{
 await onTheOrderList(page);
 await page.route('**/sales/getOrderHistory',route=>route.fulfill({json:{type:'success',data:{orders:ORDERS.map(order=>order._id==='ord-1'?{...order,seating_request_id:'seating-original'}:order)}}}));
 await page.evaluate(()=>loadOrderHistory());
 let prepares=0, completes=0, cancels=0;
 await page.route('**/captain/v1/tables/move/prepare',route=>{prepares++;return route.fulfill({json:{request_id:route.request().postDataJSON().request_id,orderId:'ord-1',state:'reserved'}});});
 await page.route('**/captain/v1/tables/move/complete',route=>{completes++;return route.fulfill({status:503,json:{message:'offline'}});});
 await page.route('**/captain/v1/tables/move/cancel',route=>{cancels++;return route.fulfill(cancels===1?{status:503,json:{message:'offline'}}:{json:{request_id:route.request().postDataJSON().request_id,state:'cancelled'}});});
 await page.evaluate(()=>moveOrder('ord-1'));
 await page.locator('.move-table[data-value="12"]').click();
 await page.locator('#move-table-go').click();
 await expect(page.locator('#move-table-cancel')).toBeVisible();
 await page.locator('#move-table-cancel').click();
 await expect.poll(()=>cancels).toBe(1);
 await expect(page.locator('#move-table-go')).toBeEnabled();
 await page.reload();
 await page.evaluate(()=>loadOrderHistory());
 await page.evaluate(()=>moveOrder('ord-1'));
 await page.locator('#move-table-go').click();
 await expect(page.locator('#moveTableModal')).toBeHidden();
 expect(prepares).toBe(1);
 expect(completes).toBe(1);
 expect(cancels).toBe(2);
 expect(await page.evaluate(()=>CaptainGroupMove.pending('ord-1'))).toBeNull();
});

test('a group move selects neighbouring seats and sends the chosen primary table',async({page})=>{
 await page.setViewportSize({width:320,height:740});
 await onTheOrderList(page);
 await page.route('**/sales/getOrderHistory',route=>route.fulfill({json:{type:'success',data:{orders:ORDERS.map(order=>order._id==='ord-1'?{...order,person_count:4,seating_request_id:'seating-original'}:order)}}}));
 await page.evaluate(()=>loadOrderHistory());
 await page.route('**/captain/v1/tables',route=>route.fulfill({json:{tables:[
   {id:'table-a',tableorder_value:'20',capacity:2,max_capacity:2,adjacent_table_ids:['table-b']},
   {id:'table-b',tableorder_value:'21',capacity:2,max_capacity:2,adjacent_table_ids:[]},
   {id:'table-c',tableorder_value:'22',capacity:4,max_capacity:4,adjacent_table_ids:[]}
 ]}}));
 let prepared;
 await page.route('**/captain/v1/tables/move/prepare',route=>{prepared=route.request().postDataJSON();return route.fulfill({json:{request_id:prepared.request_id,orderId:'ord-1',state:'reserved'}});});
 await page.route('**/captain/v1/tables/move/complete',route=>route.fulfill({json:{request_id:route.request().postDataJSON().request_id,orderId:'ord-1',state:'submitting'}}));
 await page.evaluate(()=>moveOrder('ord-1'));
 await page.locator('.move-table[data-value="20"]').click();
 await expect(page.locator('#move-table-go')).toBeDisabled();
 await expect(page.locator('.move-table[data-value="22"]')).toBeDisabled();
 await page.locator('.move-table[data-value="21"]').click();
 await expect(page.locator('#move-table-go')).toBeEnabled();
 await page.locator('#move-primary').selectOption('table-b');
 await expect(page.getByLabel('Main table',{exact:true})).toBeVisible();
 for(const width of [320,768]){
   await page.setViewportSize({width,height:900});
   const bounds=await page.locator('#moveTableModal .modal-content').boundingBox();
   expect(bounds.x).toBeGreaterThanOrEqual(0);
   expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
   const select=await page.locator('#move-primary').boundingBox();
   expect(select.height).toBeGreaterThanOrEqual(48);
   await page.screenshot({path:`output/group-move-${width}.png`,fullPage:true});
 }
 await page.locator('#move-table-go').click();
 await expect(page.locator('#moveTableModal')).toBeHidden();
 expect(prepared.tableIds).toEqual(['table-a','table-b']);
 expect(prepared.primaryId).toBe('table-b');
 expect(prepared.guests).toBe(4);
});
