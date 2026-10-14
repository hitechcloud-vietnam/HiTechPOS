import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
for (const size of [{width:800,height:1280},{width:1280,height:800},{width:390,height:844}]) {
 test(`order rounds use the screen and serve partial quantities ${size.width}`,async({page})=>{
  await page.setViewportSize(size);await onTheMenu(page,'nothing');
  const branchId='64f9a1c2e3b4d5e6f7000002';
  const saleId='64f9a1c2e3b4d5e6f7000001';
  await page.evaluate(branchId => { localStorage.setItem('branch_id', branchId); localStorage.setItem('kiosk_selected_branch', 'shop-kiosk-code'); }, branchId);
  const rounds=[{id:'c0',ordered_at:'2026-09-27T08:00:00Z',items:Array.from({length:12},(_,i)=>({id:`c0i${i}`,name:`Dish ${i+1}`,note:i===2?'Less salt':'',quantity:3,served:0,remaining:3}))},
    {id:'c1',ordered_at:'2026-09-27T08:25:00Z',items:[{id:'c1i0',name:'New soup',quantity:1,served:0,remaining:1}]}];
  await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:['1']}}}));
  await page.route('**/sales/getListKot?*',r=>r.fulfill({json:{type:'success',data:{list:[{_id:saleId,assigned_staff:{name:'Captain <A>'},...(size.width===1280?{branch_id:branchId}:{}),items:[],kitchen_rounds:rounds,created_date:{$date:'2026-09-27T08:00:00Z'}}]}}}));
  let sent;
  await page.route('**/sales/serveKitchenItems',r=>{sent=r.request().postDataJSON();if (sent.branchId !== branchId || sent.saleId !== saleId) return r.fulfill({status:409,json:{type:'error',message:'Invalid service request'}});rounds[0].items[0].served=sent.items[0].quantity;rounds[0].items[0].remaining=3-sent.items[0].quantity;return r.fulfill({json:{type:'success',data:rounds}});});
  await page.goto('/kot-management.html');await page.evaluate(branch=>ServiceDetails.remember(true,branch),branchId);await page.locator('.floor-card').first().click();
  await expect(page.locator('.service-round')).toHaveCount(2);
  await expect(page.locator('.service-round').first()).toContainText('New soup');
  const dimensions=await page.locator('.kot-items-list').evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight}));
  expect(dimensions.height).toBeGreaterThan(300);expect(dimensions.height).toBe(dimensions.scroll);
  await page.evaluate(() => localStorage.setItem('branch_id','64f9a1c2e3b4d5e6f7000099'));
  await page.locator('.service-order-options summary').click();
  await page.locator('.service-action input').nth(1).fill('1');
  await page.locator('.service-action input').first().fill('1');
  await page.locator('[data-serve-line="c0i0"]').click();
  await expect(page.locator('.service-result')).toHaveText('Items marked served');
  await expect(page.locator('.service-assignee')).toHaveText('Captain <A>');
  await expect(page.locator('.service-order-options')).toHaveAttribute('open','');
  await expect(page.locator('.service-action input').nth(1)).toHaveValue('1');
  expect(sent.branchId).toBe(branchId);
  expect(sent.saleId).toBe(saleId);
  expect(sent.items).toEqual([{id:'c0i0',quantity:1}]);
  await expect(page.locator('.service-line').filter({has:page.locator('[data-serve-line="c0i0"]')})).toContainText('1 / 3');
  await page.locator('.service-action input').first().fill('1');
  await page.locator('[data-serve-line="c0i0"]').click();
  await expect(page.locator('.service-line').filter({has:page.locator('[data-serve-line="c0i0"]')})).toContainText('2 / 3');
  expect(sent.branchId).toBe(branchId);
  expect(sent.items).toEqual([{id:'c0i0',quantity:2}]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-artifacts/service-rounds-${size.width}.png`});
 });
}

for (const count of [3, 201]) {
 test(`whole-order service snapshots pending rounds, recovers and batches ${count} lines`, async ({page}) => {
  await onTheMenu(page,'nothing');
  const branchId='64f9a1c2e3b4d5e6f7000002';
  const saleId='64f9a1c2e3b4d5e6f7000001';
  const lines=Array.from({length:count},(_,i)=>({id:`line${i}`,name:`Dish ${i}`,quantity:3,served:i===0?1:0,remaining:i===0?2:3}));
  const rounds=[{id:'old',ordered_at:'2026-09-27T08:00:00Z',items:[{id:'done',name:'Already served',quantity:1,served:1,remaining:0},...lines.slice(0,2)]},{id:'new',ordered_at:'2026-09-27T08:25:00Z',items:lines.slice(2)}];
  await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:['1']}}}));
  await page.route('**/sales/getListKot?*',r=>r.fulfill({json:{type:'success',data:{list:[{_id:saleId,branch_id:branchId,items:[],kitchen_rounds:rounds}]}}}));
  let fail=true;
  const requests=[];
  let release;
  await page.route('**/sales/serveKitchenItems',async r=>{
   const data=r.request().postDataJSON(); requests.push(data);
   expect(data.branchId).toBe(branchId); expect(data.saleId).toBe(saleId);
   expect(data.items.length).toBeLessThanOrEqual(200);
   expect(data.items.every(item=>item.quantity===3 && item.id!=='done')).toBe(true);
   if(fail) { await new Promise(resolve=>{release=resolve}); return r.fulfill({json:{type:'error',message:'Could not save. Please try again.'}}); }
   for(const item of data.items) { const line=lines.find(line=>line.id===item.id); line.served=item.quantity;line.remaining=0; }
   if(count===201 && lines.every(line=>!line.remaining)) rounds.push({id:'later',ordered_at:'2026-09-27T08:30:00Z',items:[{id:'later',name:'Added while serving',quantity:1,served:0,remaining:1}]});
   return r.fulfill({json:{type:'success',data:rounds}});
  });
  await page.goto('/kot-management.html');await page.evaluate(branch=>ServiceDetails.remember(true,branch),branchId);await page.locator('.floor-card').first().click();
  await page.locator('[data-serve-all]').click();
  await expect.poll(()=>typeof release).toBe('function');
  await expect(page.locator('[data-serve-all]')).toBeDisabled();
  await expect(page.locator('[data-serve-line]').first()).toBeDisabled();
  release();
  await expect(page.locator('.service-result')).toContainText('Could not save');
  await expect(page.locator('[data-serve-all]')).toBeEnabled();
  fail=false;
  await page.locator('[data-serve-all]').click();
  await expect(page.locator('.service-result')).toHaveText('Items marked served');
  expect(requests.slice(1).flatMap(request=>request.items)).toHaveLength(count);
  if(count===201) {
   await expect(page.locator('[data-serve-line]')).toHaveCount(1);
   await expect(page.locator('[data-serve-line="later"]')).toBeEnabled();
  } else {
   await expect(page.locator('[data-serve-line]')).toHaveCount(0);
   await expect(page.locator('[data-serve-all]')).toHaveCount(0);
  }
  await expect(page.locator('.service-line.is-served')).toHaveCount(count+1);
 });
}


test('held food cannot be marked served; sending it preserves identity and shows its kitchen action',async({page})=>{
 await onTheMenu(page,'nothing');
 const branchId='64f9a1c2e3b4d5e6f7000002',saleId='64f9a1c2e3b4d5e6f7000001';
 const rounds=[{id:'c0',ordered_at:'2026-09-27T08:00:00Z',items:[{id:'c0i0',name:'Pudding',held:true,quantity:1,remaining:1,served:0,seat:2,allergies:['milk']}]}];
 await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:['1']}}}));
 await page.route('**/sales/getListKot?*',r=>r.fulfill({json:{type:'success',data:{list:[{_id:saleId,branch_id:branchId,assigned_staff:{name:'Floor captain'},items:[],kitchen_rounds:rounds}]}}}));
 let sent;
 await page.route('**/sales/fireKitchenItems',r=>{sent=r.request().postDataJSON();rounds[0].items[0].held=false;return r.fulfill({json:{type:'success',data:rounds}});});
 await page.goto('/kot-management.html');await page.evaluate(branch=>ServiceDetails.remember(true,branch),branchId);await page.locator('.floor-card').first().click();
 await expect(page.locator('[data-serve-all]')).toHaveCount(0);await expect(page.locator('[data-serve-line]')).toHaveCount(0);
 await expect(page.locator('.service-allergy')).toContainText('Milk');
 await page.locator('.service-order-options summary').click();
 await page.locator('[data-fire-line]').click();
 await expect(page.locator('.service-result')).toHaveText('Course sent to kitchen');
 await expect(page.locator('.service-assignee')).toHaveText('Floor captain');
 await expect(page.locator('.service-order-options')).toHaveAttribute('open','');
 expect(sent.items).toEqual(['c0i0']);expect(sent.branchId).toBe(branchId);
 await expect(page.locator('[data-serve-line="c0i0"]')).toHaveCount(1);
});
