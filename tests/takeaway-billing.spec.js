import {test, expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
const ids=['507f1f77bcf86cd799439011','507f1f77bcf86cd799439012'];
const bill={table:'Take Away 1',revision:'v1',currency:'₹',totalMinor:10000,paidMinor:0,dueMinor:10000,guests:2,collectEnabled:true,labels:{base:'Subtotal'},lines:[{id:'fish',name:'Fish',quantity:1,amountMinor:10000,components:[{key:'base',minor:10000}]}]};
async function setup(page, options={enabled:true,takeawayPayments:true}) {
 await onTheMenu(page,'nothing');
 const calls={bill:[],split:[],print:[],plan:[],guestPrint:[]};
 await page.route('**/captain/v1/payment-options',r=>r.fulfill({json:options}));
 await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:[],has_takeaway:true,takeaway_orders:ids.map((id,i)=>({sale_id:id,number:String(i+1),orders:1,amount:100,payment_status:'Unpaid'}))}}}));
 await page.route('**/sales/getListKot?*',r=>{
  const filters=JSON.parse(new URL(r.request().url()).searchParams.get('filters'));
  return r.fulfill({json:{type:'success',data:{list:[{_id:filters._id,sales_id:'1',payment_status:'Unpaid',sales_total:100,items:[]}]}}});
 });
 await page.route('**/captain/v1/bill?*',r=>{calls.bill.push(new URL(r.request().url()).searchParams.get('saleId'));return r.fulfill({json:{...bill,collectEnabled:options.enabled}});});
 await page.route('**/sales/guestBills/table?*',r=>{calls.split.push(new URL(r.request().url()).searchParams.get('saleId'));return r.fulfill({json:{type:'success',data:{...bill,collectEnabled:options.enabled}}});});
 await page.route('**/sales/requestBillPrint',r=>{calls.print.push(r.request().postDataJSON());return r.fulfill({json:{type:'success',data:{status:true}}});});
 await page.route('**/sales/guestBills/print',r=>{calls.guestPrint.push(r.request().postDataJSON());return r.fulfill({json:{type:'success',data:{queued:true}}});});
 await page.route('**/captain/v1/payments/table',r=>{
  const body=r.request().postDataJSON();calls.plan.push(body);
  return r.fulfill({json:{...bill,id:body.saleId,enabled:options.enabled,version:0,methods:['Cash','Card'],guests:[{name:'Guest 1',totalMinor:10000,paid:false}],payments:[]}});
 });
 await page.route('**/captain/v1/payments/release',r=>r.fulfill({json:{released:true}}));
 await page.goto('/kot-management.html');
 await page.locator('.floor-card').first().click();
 await expect(page.locator('.kot-card')).toBeVisible();
 return calls;
}
test('takeaway bill, print and split-to-payment keep the selected sale identity',async({page})=>{
 const calls=await setup(page);
 await page.locator('[data-review-bill]').click();
 await expect(page.locator('#bill-review .bill-review-lines')).toContainText('Fish');
 expect(calls.bill.at(-1)).toBe(ids[0]);
 await page.locator('[data-bill-print]').click();
 await expect(page.locator('#bill-review [role=status]')).toHaveText('Bill asked for');
 expect(calls.print[0].saleId).toBe(ids[0]);
 await page.locator('[data-bill-split]').click();
 await expect(page.locator('.guest-bill-context')).toContainText('Take Away 1');
 await expect(page.locator('.guest-bill-context')).not.toContainText('Table Take');
 expect(calls.split).toEqual([ids[0]]);
 await page.locator('#guest-bills [data-action=next]').click();
 await page.locator('#guest-bills [data-action=next]').click();
 await expect(page.locator('#cp-received')).toBeVisible();
 expect(calls.plan[0]).toMatchObject({saleId:ids[0],revision:'v1',plan:{mode:'equal'}});
});
test('printing takeaway guest bills works when mobile collection is disabled',async({page})=>{
 const calls=await setup(page,{enabled:false,takeawayPayments:true});
 await expect(page.locator('[data-collect-table]')).toBeVisible();
 await page.locator('[data-collect-table]').click();
 await expect(page.locator('#captain-payments')).toContainText('Payment collection is not enabled for this phone.');
 await page.locator('#captain-payments [data-action=close]').first().click();
 await page.locator('[data-split-table]').click();
 await page.locator('#guest-bills [data-action=next]').click();
 await page.locator('#guest-bills [data-action=next]').click();
 await expect(page.locator('#guest-bills')).toBeHidden();
 expect(calls.guestPrint[0]).toMatchObject({saleId:ids[0],revision:'v1'});
});
test('an uncertain takeaway payment stays with its sale across navigation and reload',async({page})=>{
 await setup(page);
 const posts=[];
 await page.route('**/captain/v1/payments/record',r=>{posts.push(r.request().postDataJSON());return r.fulfill({status:503,json:{message:'Unavailable'}});});
 await page.locator('[data-collect-table]').click();
 await page.locator('#captain-payments [data-action=record]').click();
 await page.locator('#captain-payments [data-action=record]').click();
 await expect(page.locator('.cp-error')).toContainText('Payment status is not confirmed');
 await page.locator('#captain-payments [data-action=close]').first().click();
 await page.locator('[data-detail-step="1"]').click();
 await page.locator('[data-collect-table]').click();
 await expect(page.locator('#cp-received')).toBeVisible();
 await expect(page.locator('#captain-payments')).not.toContainText('Payment status is not confirmed');
 await page.reload();
 await page.locator('.floor-card').first().click();
 await page.locator('[data-collect-table]').click();
 await expect(page.locator('.cp-error')).toContainText('Payment status is not confirmed');
 await page.locator('#captain-payments [data-action=record]').click();
 await expect.poll(()=>posts.length).toBe(2);
 expect(posts[1]).toEqual(posts[0]);
 expect(posts[1].planId).toBe(ids[0]);
});
test('older servers never receive a takeaway billing request without identity support',async({page})=>{
 const calls=await setup(page,{enabled:true});
 await expect(page.locator('[data-takeaway-billing]')).toBeHidden();
 expect(calls.plan).toEqual([]);
});

for(const paid of [true,false])test(`takeaway completion remains separate from payment paid=${paid}`,async({page})=>{
 const calls=await setup(page);
 const rounds=[{id:'batch1',ordered_at:'2026-10-04T00:00:00Z',items:[{id:'c0i0',line_key:'fish',name:'Fish',quantity:1,served:0,remaining:1}]}];
 await page.route('**/sales/getListKot?*',r=>r.fulfill({json:{type:'success',data:{list:[{_id:ids[0],dine_type:'Take away',payment_status:paid?'Paid':'Unpaid',sales_total:100,items:[],kitchen_rounds:rounds}]}}}));
 const served=[];
 await page.route('**/sales/serveKitchenItems',r=>{served.push(r.request().postDataJSON());return r.fulfill({json:{type:'success',data:[{...rounds[0],items:[{...rounds[0].items[0],served:1,remaining:0}]}]}})});
 await page.reload();await page.locator('.floor-card').first().click();
 await expect(page.getByRole('button',{name:'Handed over',exact:true})).toBeVisible();
 if(paid){
  await expect(page.locator('[data-order-add]')).toHaveCount(0);
  await expect(page.locator('[data-serve-and-collect]')).toHaveCount(0);
  await page.getByRole('button',{name:'Handed over',exact:true}).click();
  await expect.poll(()=>served.length).toBe(1);
  expect(calls.plan).toHaveLength(0);
 }else{
  await page.locator('[data-collect-table]').click();
  await expect(page.locator('#captain-payments')).toContainText('Food stays active until handed over');
  expect(served).toHaveLength(0);
  await page.locator('#captain-payments [data-action=close]').first().click();
  await page.route('**/sales/serveKitchenItems',r=>r.fulfill({status:503,json:{message:'Service unavailable'}}));
  await page.getByRole('button',{name:'Hand over & collect payment',exact:true}).click();
  await expect(page.locator('.service-result')).not.toHaveText('Saving…');
  await expect(page.locator('#captain-payments')).not.toBeVisible();
  expect(served).toHaveLength(0);
  await page.unroute('**/sales/serveKitchenItems');
  await page.route('**/sales/serveKitchenItems',r=>{served.push(r.request().postDataJSON());return r.fulfill({json:{type:'success',data:[{...rounds[0],items:[{...rounds[0].items[0],served:1,remaining:0}]}]}})});
  await page.getByRole('button',{name:'Hand over & collect payment',exact:true}).click();
  await expect.poll(()=>served.length).toBe(1);
  await expect(page.locator('#cp-received')).toBeVisible();
 }
 expect(served[0]).toMatchObject({saleId:ids[0],items:[{id:'c0i0',quantity:1}]});
});

for(const width of [390,768])test(`bill scrolls independently and split selection uses dark surface ${width}`,async({page})=>{
 await page.setViewportSize({width,height:640});await page.emulateMedia({colorScheme:'dark'});await setup(page);
 await page.route('**/captain/v1/bill?*',r=>r.fulfill({json:{...bill,lines:Array.from({length:25},(_,i)=>({...bill.lines[0],id:'line-'+i,name:'Dish '+i}))}}));
 await page.locator('[data-review-bill]').click();const body=page.locator('#bill-review .bill-review-body');await expect(body).toContainText('Dish 24');
 const footer=page.locator('#bill-review footer');const before=await footer.boundingBox();expect(before.y+before.height).toBeLessThanOrEqual(641);
 await body.hover();await page.mouse.wheel(0,3000);await expect.poll(()=>body.evaluate(n=>n.scrollTop)).toBeGreaterThan(0);
 await expect(page.locator('#bill-review .bill-review-totals')).toBeInViewport();const after=await footer.boundingBox();expect(Math.abs(after.y-before.y)).toBeLessThan(1);
 await page.screenshot({path:`test-artifacts/bill-scroll-dark-${width}.png`});await page.locator('[data-bill-split]').click();const selected=page.locator('#guest-bills .guest-bill-modes label').first();
 await expect(selected).toBeVisible();expect(await selected.evaluate(n=>getComputedStyle(n).backgroundColor)).not.toBe('rgb(245, 244, 255)');
 const splitFooter=await page.locator('#guest-bills footer').boundingBox();expect(splitFooter.y+splitFooter.height).toBeLessThanOrEqual(641);await page.screenshot({path:`test-artifacts/split-dark-${width}.png`});
});
