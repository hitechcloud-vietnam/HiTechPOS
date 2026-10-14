import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
const order={_id:'source',order_number:'K1',status:'pending',dine_type:'Dine-in',table_number:'4',person_count:2,seating_request_id:'original-seat',total_amount:200,items:[{item_id:'p-cb',name:'Chicken Biryani',quantity:1,price:200}]};
const tables=[{id:'target-table',tableorder_value:'12',status:'occupied',capacity:4,max_capacity:5,seating:{table_ids:['target-table']},orders:[{id:'target-order',guests:2,paid:false}]},{id:'small-table',tableorder_value:'14',status:'occupied',capacity:2,max_capacity:2,seating:{table_ids:['small-table']},orders:[{id:'other',guests:2,paid:false}]}];
async function setup(page,canMerge=true,legacy=false,supported=true){
 await onTheMenu(page,'nothing');
 await page.route('**/sales/getOrderHistory',r=>r.fulfill({json:{type:'success',data:{orders:[legacy?{...order,seating_request_id:undefined}:order]}}}));
 await page.route('**/captain/v1/tables',r=>r.fulfill({json:{canMerge,tables:legacy?tables.map(row=>({...row,seating:undefined})):tables,...(legacy&&supported?{capabilities:{legacySourceMove:true,legacyTargetMerge:true}}:{})}}));
 await page.goto('/order-history.html');
 await page.waitForFunction(()=>typeof moveOrder==='function');
 await page.evaluate(()=>loadOrderHistory());
 await page.evaluate(()=>moveOrder('source','merge'));
 await expect(page.locator('#moveTableModal')).toBeVisible();
}

test('older source and destination use the merge intent only when the server supports enrollment',async({page})=>{
 await setup(page,true,true);
 await page.locator('#moveTableModal').getByRole('button',{name:'Back',exact:true}).click();
 await expect(page.locator('#moveTableModal')).toBeHidden();
 await page.evaluate(()=>showOrderListScreen('4'));
 await expect(page.locator('[data-merge-order="source"]')).toHaveCount(1);
 await page.locator('.order-actions-menu summary').click();
 await page.locator('[data-merge-order="source"]').click();
 const calls=[];
 await page.route('**/captain/v1/tables/merge/prepare',r=>{const body=r.request().postDataJSON();calls.push(body);return r.fulfill({json:{request_id:body.request_id,orderId:'source',mergeTargetId:'target-order',state:'reserved'}});});
 await page.route('**/captain/v1/tables/move/complete',r=>r.fulfill({json:{request_id:r.request().postDataJSON().request_id,orderId:'source',mergeTargetId:'target-order',state:'submitting'}}));
 await page.locator('[data-id="target-table"]').click();
 await page.locator('#move-table-go').click();
 await expect(page.locator('#moveTableModal')).toBeHidden();
 expect(calls).toHaveLength(1);expect(calls[0].targetOrderId).toBe('target-order');expect(calls[0].items).toBeUndefined();
});

test('older destination stays disabled without enrollment support',async({page})=>{
 await setup(page,true,true,false);
 await expect(page.locator('[data-id="target-table"]')).toBeDisabled();
});
test('merge selection shows combined guest capacity and sends only the merge intent',async({page})=>{
 const calls=[];
 await setup(page);
 await page.route('**/captain/v1/tables/merge/prepare',r=>{const b=r.request().postDataJSON();calls.push(b);return r.fulfill({json:{request_id:b.request_id,orderId:'source',mergeTargetId:'target-order',state:'reserved'}});});
 await page.route('**/captain/v1/tables/move/complete',r=>r.fulfill({json:{request_id:r.request().postDataJSON().request_id,orderId:'source',mergeTargetId:'target-order',state:'submitting'}}));
 await expect(page.locator('[data-id="small-table"]')).toBeDisabled();
 await page.locator('[data-id="target-table"]').click();
 await expect(page.locator('#move-table-go')).toHaveText('Merge orders');
 await expect(page.locator('#move-table-status')).toContainText('not sent to the kitchen again');
 expect(calls).toHaveLength(0);
 await page.locator('#move-table-go').click();
 await expect(page.locator('#moveTableModal')).toBeHidden();
 expect(calls).toHaveLength(1);expect(calls[0].targetOrderId).toBe('target-order');expect(calls[0].items).toBeUndefined();
});
test('without merge permission the destination cannot be selected and Back remains available',async({page})=>{
 await setup(page,false);
 await expect(page.locator('#move-table-status')).toHaveText('Permission is required.');
 await expect(page.locator('#move-table-go')).toBeDisabled();
 await page.locator('#moveTableModal').getByRole('button',{name:'Back',exact:true}).click();
 await expect(page.locator('#moveTableModal')).toBeHidden();
});


test('merge entry follows server permission even when the paired profile has no role field',async({page})=>{
 await setup(page);
 await page.locator('#moveTableModal').getByRole('button',{name:'Back',exact:true}).click();
 await expect(page.locator('#moveTableModal')).toBeHidden();
 await page.evaluate(()=>showOrderListScreen('4'));
 await expect(page.locator('[data-merge-order="source"]')).toHaveCount(1);
 await page.locator('.order-actions-menu summary').click();
 await page.locator('[data-merge-order="source"]').click();
 await expect(page.locator('#moveTableModal .modal-title')).toHaveText('Merge orders');
 await expect(page.locator('#moveTableModal [data-id="target-table"]')).toBeVisible();
 await page.screenshot({path:'test-artifacts/occupied-merge.png',fullPage:true,animations:'disabled'});
});
