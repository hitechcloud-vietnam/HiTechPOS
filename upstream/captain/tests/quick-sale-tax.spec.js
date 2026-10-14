import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';

for (const theme of ['light', 'dark']) test(`quick sale previews added tax, preserves it on the bill and sends the untaxed base once (${theme})`, async ({page}) => {
  await page.emulateMedia({colorScheme:theme});
  await onTheMenu(page, 'nothing');
  await page.route('**/items/instantItemTax', r => r.fulfill({json:{type:'success',data:{id:'tax5',name:'GST',rate:5,type:'exclusive'}}}));
  let created, sent;
  await page.route('**/items/instanceItemInsert', r => {
    created=r.request().postDataJSON();
    return r.fulfill({json:{type:'success',data:{id:'quick-tax',name:'Special plate',selling_price:100,tax:5,tax_name:'GST',tax_type:'exclusive'}}});
  });
  await page.route('**/sales/qrOrder', r => {sent=r.request().postDataJSON();return r.fulfill({json:{type:'success',data:{order_id:'taxed-order'}}});});
  await page.locator('#product-search-input').fill('Special plate');
  await page.locator('.menu-quick-sale-btn').click();
  await page.locator('#ask-price-input').fill('100');
  await expect(page.locator('#ask-price-tax')).toContainText('GST (5%)');
  await expect(page.locator('#ask-price-tax')).toContainText('105.00');
  await page.screenshot({path:`test-artifacts/quick-sale-tax-preview-${theme}.png`});
  await page.locator('#ask-price-ok').click();
  await expect.poll(()=>created?.quick_sale_tax?.rate).toBe(5);
  await expect.poll(()=>page.evaluate(async()=> (await getCartData()).find(x=>x.id==='quick-tax')?.final_price)).toBe(105);
  await page.goto('/cart.html');
  await page.waitForFunction(()=>typeof checkout==='function');
  const line=await page.evaluate(async()=> (await getCartData()).find(x=>x.id==='quick-tax'));
  expect(line).toMatchObject({selling_price:100,subtotal:100,tax_price:5,final_price:105});
  await expect(page.locator('body')).toContainText('105.00');
  await page.screenshot({path:`test-artifacts/quick-sale-tax-bill-${theme}.png`});
  await page.evaluate(()=>checkout('test'));
  await expect.poll(()=>sent?.items?.[0]?.item_price).toBe(100);
});

test('missing configured tax blocks quick sale without creating an untaxed item', async ({page})=>{
  await onTheMenu(page,'nothing');
  let creates=0;
  await page.route('**/items/instantItemTax',r=>r.fulfill({json:{type:'error',message:'Configure a default tax in Tax settings before using Quick sale.'}}));
  await page.route('**/items/instanceItemInsert',r=>{creates++;return r.abort();});
  await page.locator('#product-search-input').fill('Special plate');
  await page.locator('.menu-quick-sale-btn').click();
  await expect(page.getByText('Configure a default tax in Tax settings before using Quick sale.',{exact:true})).toBeVisible();
  expect(creates).toBe(0);
});
