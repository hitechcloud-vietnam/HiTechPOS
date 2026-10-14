import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
test.use({isMobile:true,hasTouch:true});
for(const [width,height] of [[390,640],[768,1024]]) test(`all tables scroll above navigation at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height});await onTheMenu(page,'nothing');
 const tables=Array.from({length:40},(_,i)=>({id:String(i+1),tableorder_value:String(i+1),capacity:4,shape:'square',status:'available',orders:[]}));
 await page.route('**/captain/v1/tables',r=>r.fulfill({json:{tables}}));
 await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:[],table_details:[],has_takeaway:false}}}));
 await page.goto('/kot-management.html');await page.locator('[data-floor-filter=all]').click();
 await expect(page.locator('.floor-card')).toHaveCount(40);
 const touch = await page.context().newCDPSession(page);
 await touch.send('Emulation.setTouchEmulationEnabled', {enabled:true});
 const before = await page.evaluate(()=>document.scrollingElement.scrollTop);
 const x=Math.floor(width/2),y=Math.floor(height*0.7);
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let step=1;step<=10;step++) {
   await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-step*30}]});
   await page.waitForTimeout(20);
 }
 await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect.poll(()=>page.evaluate(()=>document.scrollingElement.scrollTop)).toBeGreaterThan(before);
 // Keep using finger swipes: a mouse wheel during touch inertia can be ignored
 // by mobile Chromium. Programmatic scrollIntoView would bypass a clipped shell.
 for (let swipe=0;swipe<25;swipe++) {
   if (await page.locator('.floor-card').last().evaluate(el=>el.getBoundingClientRect().bottom) < height-80) break;
   await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   for(let step=1;step<=10;step++) {
     await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-step*30}]});
     await page.waitForTimeout(20);
   }
   await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await page.waitForTimeout(100);
 }
 await expect.poll(()=>page.locator('.floor-card').last().evaluate(el=>el.getBoundingClientRect().bottom)).toBeLessThan(height-80);

 const result=await page.locator('.floor-card').last().evaluate(el=>{const r=el.getBoundingClientRect(),nav=document.querySelector('.captain-navigation').getBoundingClientRect();return {bottom:r.bottom,top:r.top,navTop:nav.top,scroll:document.scrollingElement.scrollHeight,viewport:innerHeight};});
 expect(result.scroll).toBeGreaterThan(result.viewport);expect(result.top).toBeGreaterThanOrEqual(0);expect(result.bottom).toBeLessThanOrEqual(result.navTop);
 await page.screenshot({path:`artifacts/table-scroll-${width}.png`});
});
