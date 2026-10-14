import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
for(const width of [320,768])test(`table first and distinct guests lead straight to items at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:800});
 await onTheMenu(page,'nothing');
 const tables=[{id:'4',tableorder_value:'4',status:'available',capacity:6}];
 await page.evaluate(tables=>localStorage.setItem('kiosk_tableorders',JSON.stringify(tables)),tables);
 await page.route('**/captain/v1/tables',r=>r.fulfill({json:{tables}}));
 await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:[]}}}));
 await page.goto('/discount.html');
 const table=page.locator('.table-section-center'),guests=page.locator('.person-count-section');
 await expect(page.locator('.table-label').first()).toBeVisible();
 expect((await table.boundingBox()).y).toBeLessThan((await guests.boundingBox()).y);
 const guest=page.locator('[data-person="3"]');
 await expect(guest.locator('i')).toHaveCount(1);
 await page.screenshot({path:`test-artifacts/table-first-${width}.png`,fullPage:true});
 await page.locator('.table-label').first().click();
 await expect(page).toHaveURL(/discount.html/);
 await guest.click();
 await expect(page).toHaveURL(/products.html/);
 expect(await page.evaluate(()=>localStorage.getItem('kiosk_table_no'))).toBe('4');
 expect(await page.evaluate(()=>localStorage.getItem('kiosk_person_count'))).toBe('3');
});

test('takeaway goes directly to items without table or guests',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.route('**/captain/v1/takeaway-number',r=>r.fulfill({json:{number:1}}));
 await page.goto('/discount.html');
 await page.locator('label[for=order_type_takeaway]').click();
 await expect(page).toHaveURL(/products.html/);
 expect(await page.evaluate(()=>localStorage.getItem('orderType'))).toBe('Take away');
 expect(await page.evaluate(()=>localStorage.getItem('kiosk_table_no'))).toBe('');
 expect(await page.evaluate(()=>localStorage.getItem('kiosk_person_count'))).toBe('0');
});

for(const theme of ['light','dark'])test(`refined seating cards and custom guests ${theme}`,async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:theme});await onTheMenu(page,'nothing');const tables=[{id:'1',tableorder_value:'1',capacity:10},{id:'2',tableorder_value:'2',capacity:4}];await page.evaluate(t=>localStorage.setItem('kiosk_tableorders',JSON.stringify(t)),tables);
 await page.route('**/captain/v1/tables',r=>r.fulfill({json:{tables}}));await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:['2'],table_order_counts:{'2':1}}}}));await page.goto('/discount.html');
 await expect(page.locator('.entry-table-icon')).toHaveCount(2);await expect(page.locator('#table_2')).toBeDisabled();await expect(page.locator('label[for=table_2] .entry-availability')).toHaveText('Occupied');await expect(page.locator('label[for=table_2] [data-table-state=occupied]')).toBeVisible();await expect(page.locator('label[for=table_1] .entry-state-badge')).toHaveCount(0);await expect(page.locator('.pax-stepper')).toBeHidden();await expect(page.locator('#manual_table_input')).toHaveAttribute('placeholder','e.g. 6A');
 await page.screenshot({path:`test-artifacts/seating-refined-${theme}.png`,fullPage:true});await page.getByText('More guests',{exact:true}).click();await expect(page.locator('.pax-stepper')).toBeVisible();await page.locator('#pax_more').click();await expect(page.locator('#person_count')).toHaveValue('2');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('ten tables use compact rows on phone',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'dark'});await onTheMenu(page,'nothing');const tables=Array.from({length:10},(_,i)=>({id:String(i+1),tableorder_value:String(i+1),capacity:4}));await page.evaluate(t=>localStorage.setItem('kiosk_tableorders',JSON.stringify(t)),tables);await page.route('**/captain/v1/tables',r=>r.fulfill({json:{tables}}));await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:[]}}}));await page.goto('/discount.html');
 const cards=page.locator('.table-item:not(.manual-table) .table-label');await expect(cards).toHaveCount(10);const first=await cards.first().boundingBox(),third=await cards.nth(2).boundingBox(),last=await cards.last().boundingBox();expect(first.height).toBeLessThanOrEqual(72);expect(third.y).toBe(first.y);expect(last.y+last.height-first.y).toBeLessThanOrEqual(300);await expect(cards.last()).toBeInViewport();const custom=await page.locator('.manual-label').boundingBox();expect(Math.abs(custom.height-first.height)).toBeLessThan(1);expect(Math.abs(custom.width-first.width)).toBeLessThan(1);expect(custom.y).toBe(last.y);await page.locator('#manual_table_input').fill('6A');await expect(page.locator('#manual_table_input')).toHaveValue('6A');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-artifacts/ten-tables-compact-dark.png',fullPage:true});
});

test('table labels use natural numeric order including temporary suffixes',async({page})=>{
 await onTheMenu(page,'nothing');const tables=['T1','T10','T2','T9','T6B','T6','T6A'].map(v=>({id:v,tableorder_value:v,capacity:4}));await page.evaluate(t=>localStorage.setItem('kiosk_tableorders',JSON.stringify(t)),tables);await page.route('**/captain/v1/tables',r=>r.fulfill({json:{tables}}));await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:[]}}}));await page.goto('/discount.html');await expect(page.locator('.entry-table-name [translate=no]')).toHaveText(['T1','T2','T6','T6A','T6B','T9','T10']);
});
