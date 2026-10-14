import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
async function contrast(locator){
 return locator.evaluate(el=>{
  const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number);
  let parent=el,bg;
  while(parent){const c=rgb(getComputedStyle(parent).backgroundColor);if(c.length===3||c[3]===1){bg=c;break;}parent=parent.parentElement;}
  const lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const a=lum(rgb(getComputedStyle(el).color)),b=lum(bg||[255,255,255]);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
 });
}
test('appearance choice overrides phone mode, persists across pages and follows system when selected',async({page})=>{
 await page.emulateMedia({colorScheme:'dark'});
 await onTheMenu(page,'nothing');
 await page.goto('/me.html#preferences');
 const choice=page.locator('#me-appearance');
 await expect(choice).toBeVisible();
 await expect(page.locator('html')).toHaveAttribute('data-color-scheme','dark');
 await choice.selectOption('light');
 await page.goto('/discount.html');
 await expect(page.locator('html')).toHaveAttribute('data-color-scheme','light');
 expect(await page.locator('body').evaluate(n=>getComputedStyle(n).backgroundColor)).toBe('rgb(255, 255, 255)');
 await page.goto('/me.html#preferences');
 await expect(choice).toHaveValue('light');
 await choice.selectOption('dark');
 await page.emulateMedia({colorScheme:'light'});
 await expect(page.locator('html')).toHaveAttribute('data-color-scheme','dark');
 await choice.selectOption('system');
 await expect(page.locator('html')).toHaveAttribute('data-color-scheme','light');
 await page.emulateMedia({colorScheme:'dark'});
 await expect(page.locator('html')).toHaveAttribute('data-color-scheme','dark');
 await page.screenshot({path:'test-artifacts/appearance-settings-dark.png'});
});
test('order names, notes and quantity controls remain readable in dark mode',async({page})=>{
 await page.emulateMedia({colorScheme:'dark'});
 await onTheMenu(page,'nothing');
 const order={_id:'order-1',dine_type:'Dine-in',table_number:'1',person_count:2,sales_total:220,total_amount:220,payment_status:'Unpaid',items:[{line_id:'one',product_id:'p-biryani',item_name:'Chicken Biryani',name:'Chicken Biryani',quantity:1,price:220,item_description:'No chilli'}]};
 await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:['1']}}}));
 await page.route('**/sales/getListKot?*',r=>r.fulfill({json:{type:'success',data:{list:[order]}}}));
 await page.goto('/kot-management.html');
 await page.locator('.floor-card').first().click();
 await expect(page.locator('.kot-card')).toBeVisible();
 const title=page.locator('.order-legacy-line strong').first();
 await expect(title).toBeVisible();
 expect(await contrast(title)).toBeGreaterThanOrEqual(4.5);
 expect(await contrast(page.locator('[data-line-action=note]').first())).toBeGreaterThanOrEqual(4.5);
 await page.screenshot({path:'test-artifacts/order-dark-contrast.png'});
 await page.goto('/discount.html');
 await expect(page.locator('.section-title').first()).toBeVisible();
 expect(await contrast(page.locator('.section-title').first())).toBeGreaterThanOrEqual(4.5);
 await page.screenshot({path:'test-artifacts/entry-dark-contrast.png'});
});

test('cart note dialog pairs readable text with its dark background',async({page})=>{
 await page.emulateMedia({colorScheme:'dark'});
 await onTheMenu(page,'nothing');
 await page.evaluate(()=>updateQuantity('p-biryani',1));
 await page.goto('/cart.html');
 await expect(page.locator('#bill-where')).toBeVisible();
 expect(await contrast(page.locator('#bill-where'))).toBeGreaterThanOrEqual(4.5);
 await page.locator('.bill-note-action').first().click();
 await expect(page.locator('#cart-notes-text')).toBeVisible();
 for(const selector of ['#cart-notes-product-name','#cart-notes-text','.notes-label']) expect(await contrast(page.locator(selector))).toBeGreaterThanOrEqual(4.5);
 await page.locator('#cart-notes-text').fill('Less spicy');
 await page.screenshot({path:'test-artifacts/cart-note-dark-contrast.png'});
});

test('explicit dark floor loading has no placeholder boxes or surface flash',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
 await onTheMenu(page,'nothing');await page.evaluate(()=>localStorage.setItem('captain_appearance','dark'));
 let finish;const gate=new Promise(r=>finish=r);
 await page.route('**/sales/getTablesWithActiveOrders',async r=>{await gate;await r.fulfill({json:{type:'success',data:{tables:['1']}}});});
 await page.goto('/kot-management.html');
 await expect(page.locator('html')).toHaveAttribute('data-color-scheme','dark');
 const loading=page.locator('.floor-loading');await expect(loading).toBeVisible();
 await expect(page.locator('.floor-area-label')).toBeHidden();
 await expect(loading).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(loading).toHaveCSS('border-top-width','0px');
 await expect(page.locator('.floor-skeleton,.section-loader')).toHaveCount(0);
 await expect(page.locator('#no-orders-message')).toBeHidden();
 expect(await contrast(loading)).toBeGreaterThanOrEqual(4.5);
 const background=await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor);
 await page.screenshot({path:'test-artifacts/floor-loading-dark.png'});finish();
 await expect(page.locator('.floor-card')).toHaveCount(1);await expect(loading).toHaveCount(0);
 await expect(page.locator('body')).toHaveCSS('background-color',background);
});

for(const theme of ['light','dark'])for(const path of ['kot-management.html','order-history.html'])test(`cancel confirmation readable ${path} ${theme}`,async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:theme});await onTheMenu(page,'nothing');await page.goto('/'+path);
 const id=path==='kot-management.html'?'cancelOrderModal':'cancelConfirmModal';
 await page.evaluate(id=>bootstrap.Modal.getOrCreateInstance(document.getElementById(id)).show(),id);
 const modal=page.locator('#'+id);await expect(modal).toBeVisible();await expect(modal).toHaveCSS('opacity','1');
 for(const selector of ['.modal-title','.modal-body p','.form-label','textarea'])expect(await contrast(modal.locator(selector).first())).toBeGreaterThanOrEqual(4.5);
 await page.screenshot({path:`test-artifacts/cancel-${path}-${theme}.png`});
});

test('home appearance shortcut toggles, persists and fits narrow header',async({page})=>{
 await page.setViewportSize({width:320,height:740});await page.emulateMedia({colorScheme:'light'});await onTheMenu(page,'nothing');await page.goto('/kot-management.html');
 const toggle=page.locator('#appearance-toggle');await expect(toggle).toHaveAccessibleName('Switch to dark mode');await toggle.click();await expect(page.locator('html')).toHaveAttribute('data-color-scheme','dark');await expect(toggle).toHaveAccessibleName('Switch to light mode');await expect(toggle.locator('[data-theme-sun]')).toBeVisible();await expect(toggle.locator('[data-theme-moon]')).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-artifacts/home-theme-shortcut-320.png'});
 await page.reload();await expect(page.locator('html')).toHaveAttribute('data-color-scheme','dark');await toggle.click();await expect(page.locator('html')).toHaveAttribute('data-color-scheme','light');await page.goto('/me.html#preferences');await expect(page.locator('#me-appearance')).toHaveValue('light');
});

test('selected table availability and icon contrast in dark mode',async({page})=>{
 await page.setViewportSize({width:560,height:844});await page.emulateMedia({colorScheme:'dark'});await onTheMenu(page,'nothing');const tables=[{id:'5',tableorder_value:'T5',capacity:6}];await page.evaluate(t=>localStorage.setItem('kiosk_tableorders',JSON.stringify(t)),tables);await page.route('**/captain/v1/tables',r=>r.fulfill({json:{tables}}));await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:[]}}}));await page.goto('/discount.html');const tile=page.locator('label[for=table_T5]');await tile.click();await expect(page.locator('#table_T5')).toBeChecked();for(const selector of ['.entry-table-name','.entry-availability','.entry-table-icon'])await expect.poll(()=>contrast(tile.locator(selector)),{message:selector}).toBeGreaterThanOrEqual(4.5);await page.screenshot({path:'test-artifacts/selected-table-dark.png'});
});
