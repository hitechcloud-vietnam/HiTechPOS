import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
for(const [width,language] of [[320,'ta'],[900,'ar']]) {
 test(`permission recovery fits ${width}px in ${language} and retains the draft`,async({page})=>{
  await page.addInitScript(code=>localStorage.setItem('posnic.language',code),language);
  await page.emulateMedia({colorScheme:'dark'});
  await page.setViewportSize({width,height:800});
  await onTheMenu(page,'nothing');
  await page.evaluate(()=>{localStorage.setItem('permission-draft','retained');location.href='access-denied.html';});
  await expect(page).toHaveURL(/access-denied.html$/);
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await expect(page.locator('h1')).toHaveText(await page.evaluate(()=>I18N.t('Permission is required.')));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-artifacts/permission-${language}-${width}.png`,fullPage:true});
  await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
  await expect(page).toHaveURL(/products.html/);
  expect(await page.evaluate(()=>localStorage.getItem('permission-draft'))).toBe('retained');
 });
}
test('a direct permission page opens the floor without resetting the server',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.goto('/access-denied.html');
 await page.locator('.permission-actions a').click();
 await expect(page).toHaveURL(/kot-management.html/);
});
