import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';

for (const [width,language] of [[320,'ta'],[390,'ar'],[900,'en']]) {
 test(`discard confirmation fits ${width}px in ${language} and Back keeps editing`,async({page})=>{
  await page.addInitScript(code=>localStorage.setItem('posnic.language',code),language);
  await page.setViewportSize({width,height:800});
  await onTheMenu(page,'nothing');
  await page.evaluate(()=>{window.discardResult='pending';void CaptainConfirm.discard().then(value=>window.discardResult=value);});
  const dialog=page.locator('#captain-discard');
  const labels=await page.evaluate(()=>[I18N.t('Keep editing'),I18N.t('Discard changes')]);
  await expect(dialog.locator('[data-confirm-action=keep]')).toHaveText(labels[0]);
  await expect(dialog.locator('[data-confirm-action=discard]')).toHaveText(labels[1]);
  await expect(dialog.locator('[data-confirm-action=keep]')).toBeFocused();
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth && el.getBoundingClientRect().bottom<=innerHeight)).toBe(true);
  await page.screenshot({path:`test-artifacts/discard-${language}-${width}.png`,fullPage:true});
  await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(()=>window.discardResult)).toBe(false);
  await expect(page).toHaveURL(/products.html/);
 });
}

test('repeated discard prompts cannot attach duplicate destructive actions',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.evaluate(()=>{
  window.decisions=[];
  void CaptainConfirm.discard().then(value=>decisions.push(value));
  void CaptainConfirm.discard().then(value=>decisions.push(value));
 });
 await expect(page.locator('#captain-discard')).toHaveCount(1);
 await page.locator('[data-confirm-action=discard]').click();
 await expect.poll(()=>page.evaluate(()=>decisions)).toEqual([false,true]);
});
