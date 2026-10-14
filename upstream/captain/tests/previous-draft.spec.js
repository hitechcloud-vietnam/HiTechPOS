import {test,expect} from '@playwright/test';
import {onTheMenu,item} from './support/shop.js';
const menu=[{category_name:'Food',items:[item('fish','Fish',500,{instant:true}),item('nethili','Nethili 65',230),item('dal','Dal Fry',200)]}];
async function draft(page){
 await onTheMenu(page,'nothing',{menu});
 await page.evaluate(async()=>{await updateQuantity('fish',1);await updateQuantity('nethili',1);localStorage.setItem('note','Old guests');window.originalKey=currentOrderKey();localStorage.setItem('test.originalKey',window.originalKey);});
 await page.goto('/kot-management.html');
 await page.locator('.floor-new').click();
 await expect(page).toHaveURL(/discount.html$/);
}
for(const table of ['T1','T2'])test(`new order at ${table} cannot inherit a prior basket`,async({page})=>{
 await draft(page);

 await page.locator('#manual_table_input').fill(table);
 await page.locator('[onclick*="goToProductsWithTableCheck"]').click();
 await expect(page.locator('#captain-discard')).toContainText('Fish × 1');
 await expect(page.locator('#captain-discard')).toContainText('Nethili 65 × 1');
 await page.locator('[data-confirm-action="discard"]').click();
 await expect(page).toHaveURL(/products.html$/); await page.waitForFunction(()=>typeof getCartData==='function' && typeof OrderQueue!=='undefined');
 const state=await page.evaluate(async()=>({cart:await getCartData(),note:localStorage.getItem('note'),table:localStorage.getItem('kiosk_table_no'),queued:OrderQueue.all().map(r=>r.key)}));
 expect(state.cart).toEqual([]);expect(state.note).toBeNull();expect(state.table).toBe(table);
 const payload=await page.evaluate(async()=>{await updateQuantity('dal',1);OrderQueue.add=row=>{window.body=row.body;return false};await checkout('test');return window.body;});
 expect(payload.items.map(i=>i.item_id)).toEqual(['dal']);
});
test('keep editing preserves items and their original table and retry key',async({page})=>{
 await draft(page);await page.locator('#manual_table_input').fill('T2');
 await page.locator('[onclick*="goToProductsWithTableCheck"]').click();
 await page.locator('[data-confirm-action="keep"]').click();await expect(page).toHaveURL(/cart.html$/);await page.waitForFunction(()=>typeof getCartData==='function');
 const state=await page.evaluate(async()=>({items:(await getCartData()).map(i=>i.id),table:localStorage.getItem('kiosk_table_no'),key:currentOrderKey(),oldKey:localStorage.getItem('test.originalKey')}));
 expect(state.items.sort()).toEqual(['fish','nethili']);expect(state.table).toBe('T1');expect(state.key).toBe(state.oldKey);
});
test('Back never discards the basket',async({page})=>{
 await draft(page);await page.locator('#manual_table_input').fill('T2');await page.locator('[onclick*="goToProductsWithTableCheck"]').click();
 await expect(page.locator('#captain-discard')).toBeVisible();await page.keyboard.press('Escape');await expect(page).toHaveURL(/cart.html$/);await page.waitForFunction(()=>typeof getCartData==='function');
 expect(await page.evaluate(async()=>(await getCartData()).length)).toBe(2);
});
