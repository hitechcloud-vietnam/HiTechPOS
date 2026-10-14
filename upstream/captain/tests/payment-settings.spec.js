import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
async function setup(page) {
  await onTheMenu(page,'nothing');
  let value={enabled:false,methods:['Cash','Card','Upi'],printReceipt:true}, status=200;
  const posts=[];
  await page.route('**/captain/v1/payment-settings',route=>{
    if(status!==200)return route.fulfill({status,json:{message:'Denied'}});
    if(route.request().method()==='POST') { value=route.request().postDataJSON(); posts.push(value);return route.fulfill({json:{saved:true,...value}}); }
    return route.fulfill({json:value});
  });
  return {posts,deny:()=>{status=403;}};
}
test('manager enables branch payments, methods and printing through the server',async({page})=>{
  const api=await setup(page);
  await page.goto('/me.html#preferences');
  await page.locator('a[href="payment-settings.html"]').click();
  await expect(page.locator('#payment-settings-enabled')).not.toBeChecked();
  await expect(page.locator('#payment-settings-cashier')).toBeVisible();
  await page.locator('#payment-settings-enabled').check();
  for(const method of ['Cash','Card','Upi']) await page.locator(`input[value="${method}"]`).uncheck();
  await expect(page.locator('#payment-settings-save')).toBeDisabled();
  await expect(page.locator('#payment-settings-method-error')).toBeVisible();
  await page.locator('input[value="Upi"]').check();
  await page.locator('#payment-settings-print').uncheck();
  await page.locator('#payment-settings-save').click();
  await expect(page.locator('#payment-settings-message')).toHaveText('Saved');
  expect(api.posts).toEqual([{enabled:true,methods:['Upi'],printReceipt:false}]);
  await page.reload();
  await expect(page.locator('input[value="Upi"]')).toBeChecked();
  await expect(page.locator('#payment-settings-print')).not.toBeChecked();
  await page.locator('#payment-settings-back').click();
  await expect(page).toHaveURL(/me.html#preferences$/);
});
test('settings refusal never displays an editable branch switch',async({page})=>{
  const api=await setup(page);api.deny();
  await page.goto('/payment-settings.html');
  await expect(page.locator('#payment-settings-message')).toHaveText('Permission is required.');
  await expect(page.locator('#payment-settings-form')).toBeHidden();
  await page.locator('#payment-settings-back').click();
  await expect(page).toHaveURL(/me.html#preferences$/);
  expect(api.posts).toHaveLength(0);
});

for(const [label,patch] of [['enabled flag',{enabled:false}],['receipt option',{printReceipt:false}],['methods',{methods:['Cash']}],['duplicate methods',{methods:['Cash','Cash','Upi']}]] ) {
 test(`mismatched ${label} never confirms the payment settings or clears the draft`,async({page})=>{
  await setup(page);await page.goto('/payment-settings.html');
  await page.locator('#payment-settings-enabled').check();
  await page.route('**/captain/v1/payment-settings',route=>route.fulfill({json:{saved:true,enabled:true,printReceipt:true,methods:['Cash','Card','Upi'],...patch}}));
  await page.locator('#payment-settings-save').click();
  await expect(page.locator('#payment-settings-message')).toHaveText('Could not save. Please try again.');
  await expect(page.locator('#payment-settings-enabled')).toBeChecked();
  await expect(page.locator('#payment-settings-save')).toBeEnabled();
  await page.locator('#payment-settings-back').click();
  await expect(page.locator('#captain-discard')).toBeVisible();
  await page.locator('[data-confirm-action=keep]').click();
  await expect(page.locator('#payment-settings-enabled')).toBeChecked();
 });
}
test('unsaved payment choices can be kept when leaving for branch details',async({page})=>{
  await setup(page);await page.goto('/payment-settings.html');
  await page.locator('#payment-settings-enabled').check();
  await page.locator('a[href^="branch-details"]').click();
 await page.locator('#captain-discard [data-confirm-action=keep]').click();
  await expect(page).toHaveURL(/payment-settings.html$/);
  await expect(page.locator('#payment-settings-enabled')).toBeChecked();
});

test('payment controls fit phones and tablets without clipping',async({page})=>{
  await setup(page);await page.goto('/payment-settings.html');
  await page.locator('#payment-settings-enabled').check();
  for(const width of [320,768]) {
    await page.setViewportSize({width,height:1024});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.locator('#payment-settings-save')).toBeVisible();
    for(const node of await page.locator('#payment-settings-form input').all()) { const box=await node.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(16); expect(box.x+box.width).toBeLessThanOrEqual(width-16); }
    await page.screenshot({path:`test-artifacts/payment-settings-${width}.png`,fullPage:true});
  }
});
