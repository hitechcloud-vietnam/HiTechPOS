import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
test.use({hasTouch:true,viewport:{width:390,height:844}});
async function swipe(page,selector,{dx=0,dy=140,cancel=false}={}) {
 await page.locator(selector).evaluate(async el=>{
  const surface=el.closest('#kot-sliding-panel, .modal') || el;
  await Promise.all(surface.getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));
 });
 const box=await page.locator(selector).boundingBox();
 const x=Math.max(40,Math.min(220,box.x+box.width/2)),y=box.y+10;
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let n=1;n<=8;n++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*n/8,y:y+dy*n/8}]});
 await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});await cdp.detach();
}
async function floor(page) {
 await onTheMenu(page,'nothing');
 let calls=0,fail=false;
 await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:['1','2','3'],table_details:['1','2','3'].map(table_number=>({table_number,item_count:1}))}}}));
 await page.route('**/sales/getListKot?*',r=>{calls++;return r.fulfill({json:fail?{type:'error',message:'offline'}:{type:'success',data:{list:[{_id:'sale',items:[{item_name:'Soup',quantity:1,price:10}],created_date:'2026-09-28T10:00:00Z'}]}}});});
 await page.goto('/kot-management.html');await page.locator('.floor-card').first().click();
 await expect(page.locator('.mobile-detail-position')).toHaveText('1 / 3');
 await expect(page.locator('[data-detail-step="1"]')).toBeEnabled();
 return {calls:()=>calls,fail:()=>{fail=true;}};
}
test('table detail swipes follow list order, stop at boundaries and support buttons',async({page})=>{
 await floor(page);
 await expect(page.locator('[data-detail-step="-1"]')).toBeDisabled();
 await swipe(page,'.kot-card',{dx:-130,dy:4});
 await expect(page.locator('#panel-title')).toHaveText('Table 2');
 await expect(page.locator('[data-detail-step="1"]')).toBeEnabled();
 await page.locator('[data-detail-step="1"]').click();
 await expect(page.locator('#panel-title')).toHaveText('Table 3');
 await expect(page.locator('[data-detail-step="1"]')).toBeDisabled();
 await swipe(page,'.kot-card',{dx:-130,dy:4});
 await expect(page.locator('#panel-title')).toHaveText('Table 3');
 await swipe(page,'.kot-card',{dx:130,dy:4});
 await expect(page.locator('#panel-title')).toHaveText('Table 2');
});
test('detail refresh keeps last content on failure and header drag dismisses',async({page})=>{
 const api=await floor(page);
 const content=await page.locator('#sliding-panel-content').innerHTML();api.fail();
 await swipe(page,'.kot-card');
 await expect(page.locator('#mobile-refresh-status')).toHaveAttribute('data-state','error');
 expect(api.calls()).toBe(2);
 expect(await page.locator('#sliding-panel-content').innerHTML()).toBe(content);
 await swipe(page,'#panel-title');
 await expect(page.locator('#kot-sliding-panel')).not.toHaveClass(/open/);
});
test('short and cancelled swipes do nothing; RTL reverses detail navigation',async({page})=>{
 const api=await floor(page);
 await swipe(page,'.kot-card',{dx:-35,dy:0});
 await swipe(page,'.kot-card',{dx:-130,dy:0,cancel:true});
 expect(api.calls()).toBe(1);
 await page.evaluate(()=>document.documentElement.dir='rtl');
 await swipe(page,'.kot-card',{dx:130,dy:0});
 await expect(page.locator('#panel-title')).toHaveText('Table 2');
});
test('serving an order blocks navigation and refresh gestures',async({page})=>{
 const api=await floor(page);
 await page.locator('.kot-card').evaluate(el=>el.dataset.serving='true');
 await swipe(page,'.kot-card',{dx:-130,dy:0});
 await swipe(page,'.kot-card');
 expect(api.calls()).toBe(1);
 await expect(page.locator('#panel-title')).toHaveText('Table 1');
});
test('history detail navigation respects selected table and uses one modal',async({page})=>{
 await onTheMenu(page,'nothing');
 let calls=0;
 await page.route('**/sales/getOrderHistory',r=>{calls++;return r.fulfill({json:{type:'success',data:{orders:[1,2,3].map(i=>({_id:`order-${i}`,order_id:`ID-${i}`,table_number:i===3?'2':'1',dine_type:'Dine-in',status:'pending',total_amount:100,items:[]}))}}});});
 await page.goto('/order-history.html');
 await page.waitForFunction(()=>typeof allOrders!=='undefined' && allOrders.length===3);
 await page.evaluate(()=>{showOrderListScreen('1');viewOrderDetails('order-1');});
 await expect(page.locator('.mobile-detail-position')).toHaveText('1 / 2');
 await swipe(page,'#order-details-content',{dx:-130,dy:0});
 await expect(page.locator('#order-details-content')).toContainText('ID-2');
 await expect(page.locator('.modal-backdrop')).toHaveCount(1);
 await expect(page.locator('[data-detail-step="1"]')).toBeDisabled();
 await swipe(page,'#order-details-content');
 await expect(page.locator('#mobile-refresh-status')).toHaveAttribute('data-state','done');
 expect(calls).toBe(2);
 await expect(page.locator('#order-details-content')).toContainText('ID-2');
 await swipe(page,'#orderDetailsModal .modal-title');
 await expect(page.locator('#orderDetailsModal')).not.toBeVisible();
});
test('My sales refresh retains day and data during an outage',async({page})=>{
 await onTheMenu(page,'nothing');let fail=false;const days=[];
 await page.route('**/sales/myDay',r=>{days.push(r.request().postDataJSON().day);return r.fulfill({json:fail?{type:'error'}:{type:'success',data:{total:120,orders:2,tables:[{table:'1',total:120,orders:2}],recent:[]}}});});
 await page.goto('/my-sales.html');await expect(page.locator('#sales-total')).toHaveText(/120\.00/);
 await page.locator('[data-day="yesterday"]').click();await expect.poll(()=>days.length).toBe(2);
 fail=true;await swipe(page,'#sales-tables');
 await expect(page.locator('#mobile-refresh-status')).toHaveAttribute('data-state','error');
 expect(days[2]).toBe(days[1]);await expect(page.locator('#sales-total')).toHaveText(/120\.00/);
 await expect(page.locator('#sales-tables')).toContainText('120');
});

test('late table responses cannot overwrite a newer selection or reopen closed details',async({page})=>{
 await floor(page);let release;let delay=true;
 await page.route('**/sales/getListKot?*',async r=>{
  const filters=JSON.parse(new URL(r.request().url()).searchParams.get('filters'));
  if(filters.table_number==='2' && delay) await new Promise(resolve=>{release=resolve;});
  await r.fulfill({json:{type:'success',data:{list:[{_id:`table-${filters.table_number}`,items:[{item_name:`Dish ${filters.table_number}`,quantity:1,price:10}]}]}}});
 });
 await page.evaluate(()=>{void selectTable('2');});
 await expect.poll(()=>typeof release).toBe('function');
 await page.evaluate(()=>selectTable('3'));
 await expect(page.locator('#panel-title')).toHaveText('Table 3');
 release();await expect(page.locator('#sliding-panel-content')).toContainText('Dish 3');
 release=undefined;
 await page.evaluate(()=>{void selectTable('2');closeSlidingPanel();});
 await expect.poll(()=>typeof release).toBe('function');
 await expect(page.locator('#kot-sliding-panel')).not.toHaveClass(/open/);
 release();
 await expect(page.locator('#kot-sliding-panel')).not.toHaveClass(/open/);
});
