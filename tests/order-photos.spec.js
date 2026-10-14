import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
const id='12345678-1234-1234-1234-123456789abc';
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC9kAAAAASUVORK5CYII=';
async function setup(page, handler, attachments=false) {
  await onTheMenu(page,'nothing');
  await page.route('**/captain/v1/paper-orders/photos/*',handler);
  await page.route('**/captain/v1/paper-orders/options',r=>r.fulfill({json:{enabled:attachments,configured:true,referenceAttachments:true}}));
  await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:['4']}}}));
  await page.route('**/sales/getListKot?*',r=>r.fulfill({json:{type:'success',data:{list:[{_id:'507f1f77bcf86cd799439011',items:[],sales_total:100,paper_order:{id,url:'https://untrusted.invalid/ignored'}}]}}}));
  await page.goto('/kot-management.html');
  await page.locator('.floor-card').first().click();
}
test('saved photo thumbnail opens, zooms and returns without leaving the order',async({page})=>{
  let reads=0;
  await setup(page,r=>{reads++;return r.fulfill({json:{data:photo}});});
  await expect(page.locator('.order-photo-thumb img')).toHaveAttribute('src',photo);
  await page.locator('.order-photo-open').click();
  await expect(page.locator('.order-photo-viewer')).toBeVisible();
  await page.locator('.order-photo-full img').click();
  await expect(page.locator('.order-photo-full img')).toHaveClass('order-photo-zoom');
  await page.locator('.order-photo-viewer button').click();
  await expect(page.locator('.order-photo-viewer')).toHaveCount(0);
  await expect(page.locator('.order-photo-open')).toBeFocused();
  await expect(page.locator('.kot-card')).toHaveCount(1);
  expect(reads).toBe(1);
});
test('photo failure retries safely and never loads a server-provided external URL',async({page})=>{
  let reads=0;
  await setup(page,r=>r.fulfill(++reads===1?{status:503,json:{message:'Offline'}}:{json:{data:photo}}));
  await expect(page.locator('.order-photo-status')).toHaveText('Retry');
  await page.locator('.order-photo-open').click();
  await expect(page.locator('.order-photo-viewer img')).toHaveAttribute('src',photo);
  expect(reads).toBe(2);
});

test('history photo closes with Android Back while keeping order details open',async({page})=>{
  await setup(page,r=>r.fulfill({json:{data:photo}}));
  const order={_id:'507f1f77bcf86cd799439011',table_number:'4',status:'completed',items:[],total_amount:100,paper_order:{id}};
  await page.route('**/sales/getOrderHistory',r=>r.fulfill({json:{type:'success',data:{orders:[order]}}}));
  await page.goto('/order-history.html');
  await page.waitForFunction(()=>typeof viewOrderDetails==='function' && allOrders.length===1);
  await page.evaluate(orderId=>viewOrderDetails(orderId),order._id);
  await page.locator('.order-photo-open').click();
  await expect(page.locator('.order-photo-viewer')).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
  await expect(page.locator('.order-photo-viewer')).toHaveCount(0);
  await expect(page.locator('#orderDetailsModal')).toBeVisible();
});

test('reference-only upload previews, retries the same photo and keeps the order open',async({page})=>{
  await setup(page,r=>r.fulfill({json:{data:photo}}),true);
  const requests=[];
  await page.route('**/captain/v1/paper-orders/reference',r=>{
    const body=r.request().postDataJSON();requests.push(body);
    return r.fulfill(requests.length===1?{status:503,json:{message:'Retry'}}:{json:{photo:{id:body.id}}});
  });
  await page.locator('.order-photo-add').click();
  await page.locator('.order-photo-upload input').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:Buffer.from(photo.split(',')[1],'base64')});
  await expect(page.locator('.order-photo-upload img')).toBeVisible();
  await page.locator('.order-photo-upload [data-save]').click();
  await expect(page.locator('.order-photo-upload [role=status]')).toHaveText('Retry');
  await page.locator('.order-photo-upload [data-save]').click();
  await expect(page.locator('.order-photo-upload')).toHaveCount(0);
  expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);
  expect(requests[0].saleId).toBe('507f1f77bcf86cd799439011');
  expect(requests[0].original).toBe(photo);
  await expect(page.locator('[data-order-photo]')).toHaveCount(2);
  await expect(page.locator('.kot-card')).toHaveCount(1);
});

test('photo attachment stays hidden while optional paper orders are off',async({page})=>{
  await setup(page,r=>r.fulfill({json:{data:photo}}));
  await expect(page.locator('.order-photo-add')).toBeHidden();
  await expect(page.locator('.order-photo-open')).toBeVisible();
});

test('an uncertain reference upload survives reload with the same photo and request ID',async({page})=>{
  await setup(page,r=>r.fulfill({json:{data:photo}}),true);
  const requests=[];
  await page.route('**/captain/v1/paper-orders/reference',r=>{
    const body=r.request().postDataJSON();requests.push(body);
    return r.fulfill(requests.length===1?{status:503,json:{message:'Retry'}}:{json:{photo:{id:body.id}}});
  });
  await page.locator('.order-photo-add').click();
  await expect(page.locator('.order-photo-upload input')).toBeEnabled();
  await page.locator('.order-photo-upload input').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:Buffer.from(photo.split(',')[1],'base64')});
  await page.locator('.order-photo-upload [data-save]').click();
  await expect(page.locator('.order-photo-upload [role=status]')).toHaveText('Retry');
  await expect(page.locator('.order-photo-upload input')).toBeDisabled();
  await page.reload();
  await page.locator('.floor-card').first().click();
  await page.locator('.order-photo-add').click();
  await expect(page.locator('.order-photo-upload img')).toHaveAttribute('src',photo);
  await expect(page.locator('.order-photo-upload [data-save]')).toHaveText('Retry');
  await page.locator('.order-photo-upload [data-save]').click();
  await expect(page.locator('.order-photo-upload')).toHaveCount(0);
  expect(requests[1]).toEqual(requests[0]);
  await page.locator('.order-photo-add').click();
  await expect(page.locator('.order-photo-upload input')).toBeEnabled();
  await expect(page.locator('.order-photo-upload img')).toBeHidden();
});

test('photo drafts are isolated by the signed-in staff and sale',async({page})=>{
  await setup(page,r=>r.fulfill({json:{data:photo}}),true);
  await page.locator('.order-photo-add').click();
  await expect(page.locator('.order-photo-upload input')).toBeEnabled();
  await page.locator('.order-photo-upload input').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:Buffer.from(photo.split(',')[1],'base64')});
  await expect(page.locator('.order-photo-upload [data-save]')).toBeEnabled();
  await page.locator('.order-photo-upload [data-close]').click();
  await page.evaluate(()=>document.querySelector('[data-order-photos]').dataset.orderPhotos='507f1f77bcf86cd799439012');
  await page.locator('.order-photo-add').click();
  await expect(page.locator('.order-photo-upload input')).toBeEnabled();
  await expect(page.locator('.order-photo-upload img')).toBeHidden();
  await page.locator('.order-photo-upload [data-close]').click();
  await page.evaluate(()=>{
    document.querySelector('[data-order-photos]').dataset.orderPhotos='507f1f77bcf86cd799439011';
    POSNIC.session.user.id='another-captain';
  });
  await page.locator('.order-photo-add').click();
  await expect(page.locator('.order-photo-upload input')).toBeEnabled();
  await expect(page.locator('.order-photo-upload img')).toBeHidden();
});
