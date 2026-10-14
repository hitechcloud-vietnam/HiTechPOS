import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';

for (const colorScheme of ['light','dark']) {
  test(`table detail text has readable contrast in ${colorScheme} mode`,async({page})=>{
    await page.emulateMedia({colorScheme});
    await onTheMenu(page,'nothing');
    await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:['7']}}}));
    await page.route('**/sales/getListKot?*',r=>r.fulfill({json:{type:'success',data:{list:[{_id:'contrast-order',person_count:2,sales_total:220,items:[{item_name:'Chicken Biryani',quantity:1,price:220,notes:'Less spicy'}],created_date:'2026-10-02T10:00:00Z'}]}}}));
    await page.goto('/kot-management.html');
    await page.locator('.floor-card').first().click();
    await expect(page.locator('#kot-sliding-panel .order-legacy-line > strong')).toHaveText('Chicken Biryani');
    await page.locator('#kot-sliding-panel').evaluate(async panel=>{
      await Promise.all(panel.getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));
    });
    const ratios=await page.locator('#kot-sliding-panel').evaluate(panel=>{
      const rgb=value=>(value.match(/[\d.]+/g)||[]).map(Number);
      const luminance=channels=>channels.slice(0,3).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
      return ['.order-legacy-line > strong','.order-legacy-line > span','.order-legacy-note','.order-identity','.order-summary > span','.order-summary > strong'].map(selector=>{
        const el=panel.querySelector(selector);let parent=el,bg;
        while(parent){bg=rgb(getComputedStyle(parent).backgroundColor);if(bg.length===3||bg[3]>0.99)break;parent=parent.parentElement;}
        const a=luminance(rgb(getComputedStyle(el).color)),b=luminance(bg);
        return {selector,ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)};
      });
    });
    for(const row of ratios) expect(row.ratio,row.selector).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({path:`test-artifacts/table-detail-${colorScheme}.png`});
  });
}
