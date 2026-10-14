import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
for(const [width,language] of [[320,'en'],[768,'ar']]) {
 test(`sales summary fits ${width}px in ${language} and returns from pending orders`,async({page})=>{
  await page.setViewportSize({width,height:1024});
  await onTheMenu(page,'nothing');
  await page.evaluate(language=>I18N.use(language),language);
  await page.route('**/sales/myDay',route=>route.fulfill({json:{type:'success',data:{total:123456789.99,paid_total:5000,orders:1234,cancelled:3,tables:[{table:'GardenTerraceTableWithALongName',total:123456789.99,paid_total:5000,orders:1234}],recent:[{table_number:'GardenTerraceTableWithALongName',total_amount:123456789.99,created_at:new Date().toISOString()}]}}}));
  await page.goto('/my-sales.html');
  await expect(page.locator('#sales-tables')).toContainText('GardenTerraceTableWithALongName');
  if(language==='ar')await expect(page.locator('#sales-recent .me-row-sub')).not.toContainText(/am|pm/i);
  expect(await page.locator('#sales-total').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await expect(page.locator('#sales-paid-row')).toBeVisible();
  await expect(page.locator('#sales-paid')).toContainText('5,000');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const boxes=await page.locator('.sales-breakdown>section').evaluateAll(nodes=>nodes.map(node=>({x:node.getBoundingClientRect().x,y:node.getBoundingClientRect().y})));
  if(width>=768)expect(boxes[0].y).toBe(boxes[1].y);else expect(boxes[1].y).toBeGreaterThan(boxes[0].y);
  await page.screenshot({path:`test-artifacts/sales-design-${width}.png`,fullPage:true});
  await expect(page.locator('.sales-links a[href="order-history.html"]')).toBeVisible();
  await page.locator('#sales-pending').click();
  await expect(page).toHaveURL(/pending.html$/);
  await page.locator('#pending-back').click();
  await expect(page).toHaveURL(/my-sales.html$/);
 });
}


test('older servers do not display an invented paid total',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.route('**/sales/myDay',route=>route.fulfill({json:{type:'success',data:{total:100,orders:1,cancelled:0,tables:[],recent:[]}}}));
 await page.goto('/my-sales.html');
 await expect(page.locator('#sales-count')).toHaveText('1 order');
 await expect(page.locator('#sales-paid-row')).toBeHidden();
});

test('stalled sales refresh retains known figures, releases loading and ignores its late reply',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.route('**/sales/myDay',route=>route.fulfill({json:{type:'success',data:{total:100,orders:1,cancelled:0,tables:[],recent:[]}}}));
 await page.goto('/my-sales.html');
 await expect(page.locator('#sales-count')).toHaveText('1 order');
 const before=await page.locator('#sales-total').textContent();
 await page.clock.install();
 await page.evaluate(()=>{POSNIC.api.post=()=>new Promise(resolve=>{window.finishOldSales=resolve;});void refreshMySales();});
 await expect(page.locator('main')).toHaveAttribute('aria-busy','true');
 await page.clock.fastForward(20001);
 await expect(page.locator('main')).not.toHaveAttribute('aria-busy','true');
 await expect(page.locator('#sales-status')).toContainText('did not answer');
 await expect(page.locator('#sales-total')).toHaveText(before);
 await page.evaluate(()=>{POSNIC.api.post=async()=>({type:'success',data:{total:200,orders:2,cancelled:0,tables:[],recent:[]}});return refreshMySales();});
 await expect(page.locator('#sales-count')).toHaveText('2 orders');
 await page.evaluate(()=>finishOldSales({type:'success',data:{total:999,orders:99,cancelled:0,tables:[],recent:[]}}));
 await expect(page.locator('#sales-count')).toHaveText('2 orders');
 await page.evaluate(()=>{POSNIC.api.post=()=>new Promise(()=>{});});
 await page.locator('[data-day=yesterday]').click();
 await page.clock.fastForward(20001);
 await expect(page.locator('#sales-total')).toBeEmpty();
 await expect(page.locator('#sales-count')).toBeEmpty();
 await expect(page.locator('#sales-status')).toContainText('did not answer');
 await page.locator('#sales-back').click();
 await expect(page).toHaveURL(/me.html$/);
});


test('pending Back works before a deferred navigation script finishes loading',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.evaluate(()=>sessionStorage.setItem('captain_pending_return','my-sales.html'));
 let release;
 const waiting=new Promise(resolve=>release=resolve);
 await page.route('**/assets/common/navigation.js',async route=>{await waiting;await route.continue();});
 await page.goto('/pending.html',{waitUntil:'commit'});
 await expect(page.locator('#pending-back')).toBeVisible();
 expect(await page.evaluate(()=>document.readyState)).not.toBe('complete');
 await page.locator('#pending-back').click({noWaitAfter:true});
 await expect(page).toHaveURL(/my-sales.html$/);
 release();
});
