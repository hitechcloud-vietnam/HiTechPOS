import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
const order={_id:'legacy',order_number:'K1',status:'pending',dine_type:'Dine-in',table_number:'4',person_count:2,total_amount:200,items:[{item_id:'p-cb',name:'Chicken Biryani',quantity:1,price:200}]};
const tables=[{id:'original',tableorder_value:'4',capacity:4,max_capacity:4,orders:[{id:'legacy',guests:2}]},{id:'destination',tableorder_value:'12',capacity:4,max_capacity:4,orders:[]}];
async function setup(page,where='order-history.html',supported=true){
 await onTheMenu(page,'nothing');
 await page.route('**/sales/getOrderHistory',r=>r.fulfill({json:{type:'success',data:{orders:[order]}}}));
 await page.route('**/captain/v1/tables',r=>r.fulfill({json:{tables,...(supported?{capabilities:{legacySourceMove:true}}:{})}}));
 await page.goto('/'+where);
 await page.waitForFunction(()=>typeof moveOrder==='function');
 await page.evaluate(()=>loadOrderHistory());
 await page.evaluate(()=>moveOrder('legacy'));
 await expect(page.locator('#moveTableModal')).toBeVisible();
}
for(const where of ['order-history.html','kot-management.html'])test(`older order uses metadata-only move on ${where}`,async({page})=>{
 await setup(page,where);
 const requests=[];
 await page.route('**/captain/v1/tables/move/prepare',r=>{const body=r.request().postDataJSON();requests.push(body);return r.fulfill({json:{request_id:body.request_id,orderId:'legacy',state:'reserved'}});});
 await page.route('**/captain/v1/tables/move/complete',r=>r.fulfill({json:{request_id:r.request().postDataJSON().request_id,orderId:'legacy',state:'submitting'}}));
 await page.locator('#move-table-list [data-id="original"]').click();
 await expect(page.locator('#move-table-go')).toBeDisabled();
 await page.locator('#move-table-list [data-id="original"]').click();
 await page.locator('#move-table-list [data-id="destination"]').click();
 await page.locator('#move-table-go').click();
 await expect(page.locator('#moveTableModal')).toBeHidden();
 expect(requests).toHaveLength(1);expect(requests[0].tableIds).toEqual(['destination']);expect(requests[0].items).toBeUndefined();
});
test('older order retains failed move across Back and supports cancellation before enrollment returns',async({page})=>{
 await setup(page);
 let request;
 await page.route('**/captain/v1/tables/move/prepare',r=>{request=r.request().postDataJSON();return r.fulfill({status:503,json:{message:'Connection failed'}});});
 await page.locator('#move-table-list [data-id="destination"]').click();
 await page.locator('#move-table-go').click();
 await expect(page.locator('#move-table-go')).toHaveText('Retry');
 await page.locator('#moveTableModal').getByRole('button',{name:'Back',exact:true}).click();
 await expect(page.locator('#moveTableModal')).toBeHidden();
 await page.evaluate(()=>moveOrder('legacy'));
 await expect(page.locator('#move-table-go')).toHaveText('Retry');
 await expect(page.locator('#move-table-list .move-table')).toHaveCount(0);
 await page.route('**/captain/v1/tables/move/cancel',r=>{expect(r.request().postDataJSON().request_id).toBe(request.request_id);return r.fulfill({json:{request_id:request.request_id,state:'cancelled'}});});
 await page.locator('#move-table-cancel').click();
 await expect(page.locator('#moveTableModal')).toBeHidden();
 expect(await page.evaluate(()=>CaptainGroupMove.pending('legacy'))).toBeNull();
});
test('servers without the capability keep the existing single-table selector',async({page})=>{
 await setup(page,'order-history.html',false);
 await page.locator('#move-table-list [data-id="destination"]').click();
 await expect(page.locator('#move-table-go')).toHaveText('Move to table 12');
 await expect(page.locator('#move-primary')).toHaveCount(0);
});
