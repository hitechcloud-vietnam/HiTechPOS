import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { onTheMenu, item } from './support/shop.js';

const menu = [{ category_name: 'Azure regression', items: [
  item('mutton', 'Kashmiri Mutton Rogan Josh', 400, {final_price:420, tax_price:20, tax:5, tax_type:'exclusive', price_mode:'fixed'}),
  item('paratha', 'Paratha (1 Pc)', 45, {final_price:47.25, tax_price:2.25, tax:5, tax_type:'exclusive', price_mode:'fixed'}),
  item('water', 'Mineral Water', 30, {tax:5, tax_type:'inclusive', price_mode:'fixed'}),
  item('discounted', 'Discounted dish', 100, {final_price:94.5, discount_price:10, tax_price:4.5, price_mode:'fixed'}),
] }];

test('new checkout sends selling prices through menu storage, cart, refresh and durable delivery', async ({page}) => {
  await onTheMenu(page, 'nothing', {menu});
  const sent = [];
  await page.route('**/sales/qrOrder', async route => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({json:{type:'success', data:{order_id:'accepted'}}});
  });
  await page.evaluate(async () => {
    await updateQuantity('mutton', 1);
    await updateQuantity('paratha', 2);
    await updateQuantity('water', 1);
    await updateQuantity('discounted', 1);
    await syncCartSilently(await getData('products'));
  });
  await page.goto('/cart.html');
  await page.waitForFunction(() => typeof checkout === 'function');
  await page.evaluate(() => checkout('test'));
  await expect.poll(() => sent.length).toBe(1);
  await test.info().attach('checkout-payload', {body:JSON.stringify(sent[0]),contentType:'application/json'});
  if (process.env.POS_CHECKOUT_PAYLOAD) writeFileSync(process.env.POS_CHECKOUT_PAYLOAD, JSON.stringify(sent[0]));
  expect(sent[0].items.map(i => [i.item_id, i.item_price, i.item_subtotal])).toEqual([
    ['discounted',100,100], ['mutton',400,400], ['paratha',45,90], ['water',30,30],
  ]);
  await expect.poll(() => page.evaluate(() => OrderQueue.count())).toBe(0);
});

test('rejected saved order can be reviewed and retried with its original identity', async ({page}) => {
  await onTheMenu(page, 'nothing', {menu});
  await page.route('**/captain/v1/tables', r => r.fulfill({json:{tables:[{id:'four',tableorder_value:'4',status:'available',orders:[]}]}}));
  const sent = [];
  await page.route('**/sales/qrOrder', async route => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({json:{type:'success',data:{order_id:'recovered'}}});
  });
  await page.goto('/kot-management.html');
  await page.waitForFunction(() => window.POSNIC_ORDER_QUEUE_UI && POSNIC.session.active);
  await page.evaluate(() => {
    OrderQueue.add({key:'original-key', branch:'branch-1', body:{idempotencyKey:'original-key', branch:'branch-1', kiosk_table_no:'4', items:[{item_id:'mutton',item_name:'Kashmiri Mutton Rogan Josh',item_price:420,item_quantity:1}]}});
    OrderQueue.update('original-key',{state:'attention',message:'Kashmiri Mutton Rogan Josh: price changed or does not match this selling channel. Refresh the menu before saving.'});
    POSNIC_ORDER_QUEUE_UI.render();
  });
  await page.locator('[data-floor-filter=all]').click();
  await expect(page.locator('.floor-card[data-table-number="4"]')).toHaveCount(1);
  await expect(page.locator('.floor-card[data-table-number="4"]')).toContainText('Not sent to kitchen');
  await page.locator('.floor-card.is-pending').click();
  await page.getByRole('button',{name:'Reload menu'}).click();
  await expect(page.getByText('Kashmiri Mutton Rogan Josh: 420 → 400',{exact:true})).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('posnic:online')));
  await expect(page.getByText('Kashmiri Mutton Rogan Josh: 420 → 400',{exact:true})).toBeVisible();
  expect(sent).toHaveLength(0);
  await page.getByRole('button',{name:'Retry this order'}).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].idempotencyKey).toBe('original-key');
  expect(sent[0].items[0].item_price).toBe(400);
  await expect(page.getByText('All orders synced',{exact:true})).toBeVisible();
});


test('current staff can deliver while another staff checkout remains held', async ({page}) => {
  await onTheMenu(page, 'nothing');
  const sent=[];
  await page.route('**/sales/qrOrder', async route => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({json:{type:'success',data:{order_id:'recovered'}}});
  });
  await page.goto('/kot-management.html');
  await page.waitForFunction(()=>window.POSNIC_ORDER_QUEUE_UI && POSNIC.session.active);
  await page.evaluate(async()=>{
    OrderQueue.add({key:'other-held',held:true,body:{idempotencyKey:'other-held',items:[]}});
    const other=OrderQueue.all()[0];
    OrderQueue.update(other.key,{owner:{...other.owner,user:'other-staff'}});
    OrderQueue.add({key:'own-waiting',body:{idempotencyKey:'own-waiting',kiosk_table_no:'4',items:[]}});
    await POSNIC_ORDER_QUEUE_UI.flush();
  });
  await expect.poll(()=>sent.length).toBe(1);
  expect(sent[0].idempotencyKey).toBe('own-waiting');
  const remaining=await page.evaluate(()=>OrderQueue.all());
  expect(remaining.map(row=>row.key)).toEqual(['other-held']);
  expect(remaining[0].held).toBe(true);
  await expect(page.locator('.floor-card.is-pending')).toHaveCount(0);
});
