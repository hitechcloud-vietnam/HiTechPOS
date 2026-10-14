import {test, expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';

test('takeaway reservation is carried from entry to cart and durable order payload', async ({page}) => {
  await onTheMenu(page, 'nothing');
  const requests=[];
  await page.route('**/captain/v1/takeaway-number', r=>{
    requests.push(r.request().postDataJSON());
    return r.fulfill({json:{number:1}});
  });
  await page.goto('/discount.html');
  await page.locator('label[for=order_type_takeaway]').click();
  await expect(page).toHaveURL(/products.html/);
  await page.waitForFunction(()=>typeof updateQuantity === 'function');
  await page.evaluate(()=>updateQuantity('p-biryani',1));
  await page.goto('/cart.html');
  await expect(page.locator('#bill-where')).toHaveText('Take Away 1');
  await page.reload();
  await expect(page.locator('#bill-where')).toHaveText('Take Away 1');
  const body=await page.evaluate(async()=>{
    OrderQueue.add=entry=>{window.sentBody=entry.body;return false;};
    await checkout('number-test');
    return window.sentBody;
  });
  expect(body.tokenId).toBe('1');
  expect(body.takeaway_request_id).toBe(requests[0].request_id);
  expect(requests).toHaveLength(1);
});

test('failed reservation retries the same request instead of inventing a number', async ({page})=>{
 await onTheMenu(page,'nothing');
 const requests=[];
 await page.route('**/captain/v1/takeaway-number',r=>{
   requests.push(r.request().postDataJSON());
   return requests.length===1 ? r.fulfill({status:503,json:{error:{message:'Please retry.'}}}) : r.fulfill({json:{number:2}});
 });
 await page.goto('/discount.html');
 await page.locator('label[for=order_type_takeaway]').click();
 await expect.poll(()=>requests.length).toBe(1);
 await expect(page).toHaveURL(/discount.html/);
 const draft=await page.evaluate(()=>JSON.parse(localStorage.getItem('kiosk_takeaway_reservation')));
 expect(draft.number).toBeUndefined();
 await page.evaluate(()=>goToProductsWithTableCheck());
 await expect(page).toHaveURL(/products.html/);
 expect(requests[1].request_id).toBe(requests[0].request_id);
});
