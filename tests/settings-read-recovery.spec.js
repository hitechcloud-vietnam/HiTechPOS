import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
for(const settings of [
 {page:'payment-settings.html',retry:'#payment-settings-retry',message:'#payment-settings-message',back:'#payment-settings-back',form:'#payment-settings-form',value:{enabled:false,methods:['Cash'],printReceipt:true}},
 {page:'branch-details.html',retry:'#branch-retry',message:'#branch-message',back:'#branch-back',form:'#branch-details-form',value:{id:'branch',name:'Garden',revision:'current',branch_upi_id:'garden@bank',branch_upi_name:'Garden'}},
]) {
 async function stalled(page) {
  await onTheMenu(page,'nothing');
  await page.clock.install();
  await page.addInitScript(target=>document.addEventListener('DOMContentLoaded',()=>{
   if(location.pathname.endsWith(target))POSNIC.api.get=()=>new Promise(resolve=>{window.finishOldSettings=resolve;});
  }),settings.page);
  await page.goto('/'+settings.page);
  await expect(page.locator(settings.message)).toHaveText('Loading...');
 }
 test(`${settings.page} retries a stalled read without allowing late data to replace edits`,async({page})=>{
  await stalled(page);
  await page.clock.fastForward(20001);
  await expect(page.locator(settings.message)).toHaveText('Connection failed');
  await expect(page.locator(settings.retry)).toBeVisible();
  await page.evaluate(value=>{POSNIC.api.get=async()=>value;},settings.value);
  await page.locator(settings.retry).click();
  await expect(page.locator(settings.form)).toBeVisible();
  if(settings.page==='payment-settings.html')await page.locator('#payment-settings-enabled').check();
  else await page.locator('#branch-upi-name').fill('Draft restaurant name');
  await page.evaluate(value=>finishOldSettings(value),settings.value);
  if(settings.page==='payment-settings.html')await expect(page.locator('#payment-settings-enabled')).toBeChecked();
  else await expect(page.locator('#branch-upi-name')).toHaveValue('Draft restaurant name');
  await page.locator(settings.back).click();
  await expect(page.locator('#captain-discard')).toBeVisible();
  await page.locator('[data-confirm-action=keep]').click();
  await expect(page).toHaveURL(new RegExp(settings.page+'$'));
 });
 test(`${settings.page} keeps Back usable during a stalled read`,async({page})=>{
  await stalled(page);
  await page.locator(settings.back).click();
  await expect(page).toHaveURL(/me.html#preferences$/);
 });
}
