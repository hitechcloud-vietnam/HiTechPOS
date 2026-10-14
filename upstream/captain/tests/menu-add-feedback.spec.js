import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
for(const motion of ['no-preference','reduce'])test(`successful add and increase feedback ${motion}`,async({page})=>{
 await page.emulateMedia({reducedMotion:motion});await onTheMenu(page,'nothing');
 await page.evaluate(()=>{window.bursts=0;window.burstSizes=[];window.burstKinds=[];new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.classList?.contains('menu-add-burst')){window.bursts++;window.burstSizes.push(n.children.length);window.burstKinds.push(n.textContent);}}).observe(document.body,{childList:true});});
 await page.locator('.btn-add[data-id="p-biryani"]').first().click();await expect.poll(()=>page.evaluate(async()=> (await getCartData()).find(x=>x.id==='p-biryani')?.quantity)).toBe(1);
 await page.locator('.btn-increase[data-id="p-biryani"]').first().click();await expect.poll(()=>page.evaluate(async()=> (await getCartData()).find(x=>x.id==='p-biryani')?.quantity)).toBe(2);
 await page.locator('.btn-decrease[data-id="p-biryani"]').first().click();await expect.poll(()=>page.evaluate(async()=> (await getCartData()).find(x=>x.id==='p-biryani')?.quantity)).toBe(1);
 await expect.poll(()=>page.evaluate(()=>window.bursts)).toBe(motion==='reduce'?0:3);expect(await page.evaluate(()=>window.burstSizes)).toEqual(motion==='reduce'?[]:[1,1,1]);expect(await page.evaluate(()=>window.burstKinds)).toEqual(motion==='reduce'?[]:['','💚','🙁']);await expect(page.locator('.menu-add-burst')).toHaveCount(0);
});

for(const theme of ['light','dark'])test(`single floating bubble then pop ${theme}`,async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await onTheMenu(page,'nothing');
 await page.evaluate(theme=>{document.documentElement.setAttribute('data-color-scheme',theme);new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.classList?.contains('menu-add-burst')){const a=n.firstElementChild.getAnimations()[0];a.pause();a.currentTime=300;}}).observe(document.body,{childList:true});},theme);
 await page.locator('.btn-add[data-id="p-biryani"]').first().click();
 const bubble=page.locator('.menu-add-burst i');await expect(bubble).toHaveCount(1);
 expect(await bubble.evaluate(el=>el.getAnimations()[0].effect.getTiming().duration)).toBe(460);
 const floating=await bubble.boundingBox();expect(floating.width).toBeGreaterThan(80);
 await page.screenshot({path:`test-artifacts/floating-bubble-${theme}.png`});
 await bubble.evaluate(el=>el.getAnimations()[0].currentTime=405);
 const popped=await bubble.boundingBox();expect(popped.width).toBeGreaterThan(floating.width*1.3);
 expect(await page.locator('.menu-add-burst').evaluate(el=>getComputedStyle(el).pointerEvents)).toBe('none');
 await expect(page.locator('.menu-add-burst')).toHaveCount(0);
});
