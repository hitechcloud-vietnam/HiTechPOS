import {test,expect} from '@playwright/test';
import {onTheMenu,item} from './support/shop.js';
test('price setting persists across pages, preserves pictures and leaves cart prices unchanged',async({page})=>{
 await page.route('**/images/default-product.webp',r=>r.fulfill({path:'images/default-product.webp'}));
 const product=item('tax-dish','Mushroom Manchurian',210,{tax:5,tax_type:'inclusive',tax_price:0,final_price:210,img:'images/default-product.webp'});
 await onTheMenu(page,'nothing',{menu:[{category_name:'Starters',items:[product]}]});
 await expect(page.locator('.dish-price').first()).toContainText('210.00');
 await expect(page.locator('.dish-tax').first()).toHaveText('Including tax');
 await expect(page.locator('.dish-photo').first()).toBeVisible();
 await page.goto('/me.html#preferences');await page.locator('#me-item-prices').selectOption('excluding');
 await page.reload();await expect(page.locator('#me-item-prices')).toHaveValue('excluding');
 await page.goto('/products.html');await expect(page.locator('.dish-price').first()).toContainText('200.00');
 await expect(page.locator('.dish-tax').first()).toContainText('Excluding tax · + ₹10.00');
 await expect(page.locator('.dish-photo').first()).toBeVisible();
 const stored=await page.evaluate(async()=> (await getData('products')).find(p=>p.id==='tax-dish'));
 expect(stored.price).toBe(210);expect(stored.final_price).toBe(210);
 await page.screenshot({path:'test-artifacts/item-price-excluding-tax.png',fullPage:true});
});
