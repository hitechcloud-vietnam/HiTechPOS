import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';
const photo=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC9kAAAAASUVORK5CYII=','base64');
async function setup(page,enabled=true) {
  await onTheMenu(page,'nothing');
  await page.route('**/captain/v1/paper-orders/options',r=>r.fulfill({json:{enabled,configured:true}}));
  await page.route('**/captain/v1/tables',r=>r.fulfill({json:{tables:[{id:'table-4',tableorder_value:'4',status:'available'}]}}));
  await page.route('**/captain/v1/paper-orders/recognize',r=>r.fulfill({json:{id:r.request().postDataJSON().id,table:'4',pax:null,lines:[{text:'CB 5',name:'CB',quantity:5,confidence:98}]}}));
  await page.goto('/kot-management.html');
}
test('paper orders stay hidden when disabled',async({page})=>{
  await setup(page,false);await expect(page.locator('#paper-order-open')).toBeHidden();
});
test('photo draft is editable, optional pax remains empty, send carries photo reference',async({page})=>{
  await setup(page);
  await page.locator('#paper-order-open').click();
  await page.locator('.paper-order-dialog input[type=file]').setInputFiles({name:'order.png',mimeType:'image/png',buffer:photo});
  await page.getByRole('button',{name:'Read photo',exact:true}).click();
  await expect(page.locator('[data-item]')).toHaveValue('p-biryani');
  await expect(page.locator('[data-pax]')).toHaveValue('');
  await page.locator('[data-qty]').fill('6');
  await page.locator('[data-note]').fill('No onion');
  await page.screenshot({path:'test-artifacts/paper-order-review.png',fullPage:true});
  const sent=page.waitForRequest(r=>r.url().endsWith('/sales/qrOrder'));
  await page.route('**/sales/qrOrder',r=>r.fulfill({json:{type:'success',data:{order_id:'saved-order'}}}));
  await page.getByRole('button',{name:'Send to kitchen',exact:true}).click();
  const body=(await sent).postDataJSON();
  expect(body.paper_order_id).toMatch(/^[a-f0-9-]{36}$/);
  expect(body.items[0]).toMatchObject({item_id:'p-biryani',item_quantity:6,item_description:'No onion'});
  expect(body.person_count).toBe('');expect(body.kiosk_table_no).toBe('4');
});
test('failed recognition retains the photo across a page reload',async({page})=>{
  await setup(page);
  await page.route('**/captain/v1/paper-orders/recognize',r=>r.fulfill({status:422,json:{error:{message:'Recognition unavailable'}}}));
  await page.locator('#paper-order-open').click();
  await page.locator('.paper-order-dialog input[type=file]').setInputFiles({name:'order.png',mimeType:'image/png',buffer:photo});
  await page.getByRole('button',{name:'Read photo',exact:true}).click();
  await expect(page.locator('.paper-order-dialog [role=status]')).toContainText('Recognition unavailable');
  await page.reload();await page.locator('#paper-order-open').click();
  await expect(page.getByRole('button',{name:'Read photo',exact:true})).toBeVisible();
});


test('enabled paper scanning explains missing configuration instead of disappearing',async({page})=>{
  await setup(page);
  await page.route('**/captain/v1/paper-orders/options',r=>r.fulfill({json:{enabled:true,configured:false}}));
  await page.reload();await page.locator('#paper-order-open').click();
  await expect(page.getByText('Paper scanning needs server setup.',{exact:false})).toBeVisible();
  await expect(page.locator('.paper-order-dialog')).toHaveCount(0);
});

test('unreachable paper capability stays discoverable and retries on click',async({page})=>{
  await setup(page);
  await page.route('**/captain/v1/paper-orders/options',r=>r.fulfill({status:503,json:{message:'Unavailable'}}));
  await page.reload();await page.locator('#paper-order-open').click();
  await expect(page.getByText('Could not check paper scanning.',{exact:false})).toBeVisible();
  await expect(page.locator('.paper-order-dialog')).toHaveCount(0);
});
