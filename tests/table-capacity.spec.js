import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';
test('seating shows capacity and excludes tables that cannot hold the party',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.evaluate(()=>localStorage.setItem('kiosk_tableorders',JSON.stringify([
  {id:'small',tableorder_value:'T2',capacity:2,max_capacity:2,area:'Garden',shape:'round'},
  {id:'large',tableorder_value:'T6',capacity:4,max_capacity:6,area:'Main',shape:'rectangle'}
 ])));
 await page.goto('/discount.html');
 await expect(page.locator('label[for=table_T2]')).toBeVisible();
 await page.locator('label[for=table_T2]').click();
 await page.locator('.entry-custom-guests summary').click();
 for(let i=0;i<4;i++) await page.locator('#pax_more').click();
 await expect(page.locator('[name=table_no][value=T2]')).toBeDisabled();
 await expect(page.locator('[name=table_no][value=T2]')).not.toBeChecked();
 await expect(page.locator('[name=table_no][value=T6]')).toBeEnabled();
 await expect(page.locator('.table-seat-info').filter({hasText:'Garden'})).toContainText('Seat capacity: 2');
 await expect(page.locator('.table-seat-info').filter({hasText:'Main'})).toContainText('Maximum seats: 6');
});

test('table and pax selection goes directly to items without a second confirmation',async({page})=>{
 await onTheMenu(page,'nothing');await page.evaluate(()=>localStorage.setItem('kiosk_tableorders',JSON.stringify([
  {id:'garden',tableorder_value:'G1',capacity:2,max_capacity:4,area:'Garden'},
  {id:'inside',tableorder_value:'M1',capacity:4,max_capacity:4,area:'Main'}
 ])));
 await page.goto('/discount.html');await expect(page.locator('[data-area=Garden]')).toBeVisible();
 await page.locator('.entry-custom-guests summary').click();
 for(let i=0;i<2;i++)await page.locator('#pax_more').click();
 await page.locator('[data-area=Garden]').click();await expect(page.locator('[data-area=Garden]')).toBeFocused();await expect(page.locator('label[for=table_M1]')).not.toBeVisible();
 await page.locator('label[for=table_G1]').click();await page.locator('[onclick="goToProductsWithTableCheck()"]').click();
 await expect(page).toHaveURL(/products.html/);await expect(page.locator('#seat-confirmation')).toHaveCount(0);
 expect(await page.evaluate(()=>localStorage.getItem('kiosk_person_count'))).toBe('3');expect(await page.evaluate(()=>localStorage.getItem('kiosk_table_no'))).toBe('G1');
});
test('native back returns from table selection to the floor without a review dialog',async({page})=>{
 await onTheMenu(page,'nothing');await page.goto('/discount.html');
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('captain:back',{cancelable:true})));
 await expect(page).toHaveURL(/kot-management.html/);
});

test('seating uses portrait tablet space and keeps tables before guest count',async({page})=>{
 await onTheMenu(page,'nothing');await page.evaluate(()=>localStorage.setItem('kiosk_tableorders',JSON.stringify(Array.from({length:12},(_,i)=>({id:String(i),tableorder_value:'T'+(i+1),capacity:4,max_capacity:6,area:i<6?'Garden':'Main',shape:'square'})))));
 await page.goto('/discount.html');await expect(page.locator('label[for=table_T1]')).toBeVisible();
 expect(await page.locator('.discount-container').evaluate(node=>getComputedStyle(node).overflowY)).toBe('visible');
 const guests=await page.locator('.person-count-section').boundingBox(),tables=await page.locator('.table-section-center').boundingBox();expect(tables.y).toBeLessThan(guests.y);
 for(const width of [320,768]){await page.setViewportSize({width,height:1024});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-artifacts/seating-${width}.png`,fullPage:true});}
});

test('Arabic order type follows right-to-left layout and takeaway skips table confirmation',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('posnic.language','ar'));await onTheMenu(page,'nothing');await page.goto('/discount.html');await expect(page.locator('html')).toHaveAttribute('dir','rtl');
 const indicator=page.locator('.dine-toggle-indicator');let segment=await page.locator('label[for=order_type_dinein]').boundingBox();let selected=await indicator.boundingBox();expect(Math.abs(selected.x-segment.x)).toBeLessThan(8);
 await page.locator('label[for=order_type_takeaway]').click();await expect(page).toHaveURL(/products.html/);await expect(page.locator('#seat-confirmation')).toHaveCount(0);expect(await page.evaluate(()=>localStorage.getItem('kiosk_table_no'))).toBe('');expect(await page.evaluate(()=>localStorage.getItem('kiosk_person_count'))).toBe('0');
});
