import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
for(const afterClose of ['available','cleaning','disabled']) test(`a paid floor card closes as ${afterClose} then returns to active tables`,async({page})=>{
 await onTheMenu(page,'nothing');let closed=false;const sent=[];
 await page.route('**/sales/getTablesWithActiveOrders',route=>route.fulfill({json:{type:'success',data:{tables:closed?[]:['T1'],table_details:closed?[]:[{table_number:'T1',orders:1,amount:200,awaiting_close:true}],has_takeaway:false}}}));
 await page.route('**/captain/v1/tables',route=>route.fulfill({json:{cleaningEnabled:afterClose !== 'disabled',canManage:false,tables:[{id:'table',tableorder_value:'T1',shape:'square',capacity:4,max_capacity:4,version:0,status:closed?'cleaning':'occupied',orders:closed?[]:[{id:'order',paid:true}]}]}}));
 await page.route('**/captain/v1/tables/close',route=>{closed=true;sent.push(route.request().postDataJSON());return route.fulfill({json:{status:'cleaning'}});});
 await page.goto('/kot-management.html');await expect(page.locator('.floor-card')).toContainText('Paid');
 await page.locator('.floor-card').click();await expect(page.locator('[data-action=close-confirm]')).toBeVisible();expect(sent).toHaveLength(0);
 if(afterClose === "disabled") await expect(page.locator("#table-after-close")).toHaveCount(0);
 else { await expect(page.locator("#table-after-close")).toHaveValue("available");await page.locator("#table-after-close").selectOption(afterClose); }
 await page.locator('[data-action=close-confirm]').click();await expect(page).toHaveURL(/kot-management.html/);await expect(page.locator('.floor-card')).toHaveCount(0);expect(sent[0].orderIds).toEqual(['order']);expect(sent[0].afterClose).toBe(afterClose === "disabled" ? "available" : afterClose);
});
