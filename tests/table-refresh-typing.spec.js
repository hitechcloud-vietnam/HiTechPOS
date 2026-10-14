import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
for(const focused of [true,false]) {
 test(`a delayed table refresh preserves newer manual typing with focus ${focused}`,async({page})=>{
  await onTheMenu(page,'nothing');
  await page.goto('/discount.html');
  await expect(page.locator('#manual_table_input')).toBeVisible();
  await page.evaluate(()=>stopTableStatusPolling());
  let release,started=false;
  const responseGate=new Promise(resolve=>release=resolve);
  await page.route('**/sales/getTablesWithActiveOrders',async route=>{
   started=true;
   await responseGate;
   await route.fulfill({json:{type:'success',data:{tables:[],table_order_limit:1}}});
  });
  await page.locator('#manual_table_input').fill('T1');
  await page.evaluate(()=>{
   localStorage.setItem('kiosk_tableorders',JSON.stringify([{id:'table-2',tableorder_value:'T2',capacity:4,max_capacity:4}]));
   window.manualBeforeRefresh=document.getElementById('manual_table_input');
   window.refreshFinished=false;
   void loadTablesFromTableorders(true).then(()=>window.refreshFinished=true);
  });
  await expect.poll(()=>started).toBe(true);
  await page.locator('#manual_table_input').fill('T23');
  if(!focused)await page.locator('.seat-head-title').click();
  release();
  await page.waitForFunction(()=>window.refreshFinished);
  await expect(page.locator('#manual_table_input')).toHaveValue('T23');
  if(focused){
   await expect(page.locator('#manual_table_input')).toBeFocused();
   expect(await page.evaluate(()=>manualBeforeRefresh===document.getElementById('manual_table_input'))).toBe(true);
  }else await expect(page.locator('#table_manual_radio')).toBeChecked();
 });
}
