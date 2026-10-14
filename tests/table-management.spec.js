import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';
const initial = {id:'table-1',tableorder_value:'T1',capacity:4,max_capacity:6,area:'Garden',shape:'round',version:0,status:'available',orders:[]};
async function open(page,canManage=true,overrides={},cleaningEnabled=false) {
 await onTheMenu(page,'nothing');
 let row={...initial,...overrides},conflict=false;const posts=[];
 await page.route('**/captain/v1/tables**',async route=>{
  const request=route.request();
  if(request.method()==='GET')return route.fulfill({json:{canManage,cleaningEnabled,tables:[row]}});
  const body=request.postDataJSON();posts.push(body);
  if(conflict)return route.fulfill({status:409,json:{message:'Table changed. Refresh and try again.'}});
  row={...row,...body,version:row.version+1};if(request.url().endsWith('/close'))row={...row,status:body.afterClose||'available',orders:[],closing:null};return route.fulfill({json:row});
 });
 await page.goto('/tables.html');await expect(page.locator('[data-table]')).toBeVisible();
 return {posts,conflict(){conflict=true;row={...row,version:2,capacity:5};}};
}
test('manager saves table details, cancels edits, and returns to account',async({page})=>{
 const {posts}=await open(page);
 await page.locator('[data-table]').click();await page.locator('[data-action=edit-table]').click();await page.locator('#capacity').fill('5');
 await page.locator('button[type=submit]').click();await expect(page.locator('[data-table]')).toContainText('Seat capacity: 5');
 expect(posts[0]).toMatchObject({capacity:'5',version:0,id:'table-1'});
 await page.locator('[data-table]').click();await page.locator('#tables-back').click();
 await expect(page.locator('[data-table]')).toBeVisible();await page.locator('#tables-back').click();await expect(page).toHaveURL(/me.html#preferences$/);
});
test('staff can mark cleaning without gaining table settings access',async({page})=>{
 const {posts}=await open(page,false,{},true);await expect(page.locator('[data-action=add]')).toHaveCount(0);
 await page.locator('[data-table]').click();await expect(page.locator('#table-edit-form')).toHaveCount(0);
 await page.locator('[data-status=cleaning]').click();await expect(page.locator('[data-table]')).toContainText('Cleaning');
 expect(posts[0]).toEqual({id:'table-1',version:0,status:'cleaning'});
});
test('conflict preserves the draft until staff explicitly refresh',async({page})=>{
 const server=await open(page);await page.locator('[data-table]').click();await page.locator('[data-action=edit-table]').click();await page.locator('#capacity').fill('6');server.conflict();
 await page.locator('button[type=submit]').click();await expect(page.locator('#table-management-message')).toContainText('Table changed');
 await expect(page.locator('#capacity')).toHaveValue('6');
 await page.locator('#tables-refresh').click();
 await page.locator('#captain-discard [data-confirm-action=keep]').click();await expect(page.locator('#capacity')).toHaveValue('6');
 await page.locator('#tables-refresh').click();
 await page.locator('#captain-discard [data-confirm-action=discard]').click();await expect(page.locator('[data-table]')).toContainText('Seat capacity: 5');
});

test('table management fits a narrow phone and a portrait tablet',async({page})=>{
 await open(page);
 for(const width of [320,768]){
  await page.setViewportSize({width,height:1024});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-artifacts/table-management-${width}.png`,fullPage:true});
 }
});

test('staff review closure separately and make the table available only after cleaning',async({page})=>{
 const {posts}=await open(page,false,{status:'occupied',orders:[{id:'paid-order',paid:true,guests:2}]},true);
 await page.locator('[data-table]').click();await page.locator('[data-action=close-review]').click();
 await expect(page.locator('#table-after-close')).toHaveValue('available');await page.locator('#table-after-close').selectOption('cleaning');expect(posts).toHaveLength(0);
 await page.locator('[data-action=back]').click();await expect(page.locator('[data-action=close-review]')).toBeVisible();
 await page.locator('[data-action=close-review]').click();await page.locator('#table-after-close').selectOption('cleaning');await page.locator('[data-action=close-confirm]').click();
 await expect(page.locator('[data-table]')).toContainText('Cleaning');expect(posts[0].orderIds).toEqual(['paid-order']);expect(posts[0].request_id).toBeTruthy();
 await page.locator('[data-table]').click();await page.locator('[data-status=available]').click();await expect(page.locator('[data-table]')).toContainText('Available');
});
test('unpaid orders cannot be closed from table controls',async({page})=>{
 const {posts}=await open(page,false,{status:'occupied',orders:[{id:'unpaid-order',paid:false}]});await page.locator('[data-table]').click();
 await expect(page.locator('[data-action=close-review]')).toHaveCount(0);await expect(page.locator('#table-management-content')).toContainText('Record the remaining payment first.');expect(posts).toHaveLength(0);
});


test('manager selects neighbouring table identities and can clear them', async ({page}) => {
 await onTheMenu(page, 'nothing');
 let row={...initial,adjacent_table_ids:[]}; const posts=[];
 const neighbour={...initial,id:'table-2',tableorder_value:'T2'};
 await page.route('**/captain/v1/tables', async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:{canManage:true,tables:[row,neighbour]}});
  const body=route.request().postDataJSON();posts.push(body);row={...row,...body,version:row.version+1};return route.fulfill({json:row});
 });
 await page.goto('/tables.html');
 async function edit(){await page.locator('[data-table="table-1"]').click();await page.locator('[data-action=edit-table]').click();}
 await edit();
 await expect(page.locator('input[name=adjacent_table_ids]')).toHaveCount(1);
 await page.getByRole('checkbox', {name:/T2/}).check();await page.locator('button[type=submit]').click();
 await expect(page.locator('[data-table="table-1"]')).toBeVisible();expect(posts[0].adjacent_table_ids).toEqual(['table-2']);
 await edit();await expect(page.getByRole('checkbox', {name:/T2/})).toBeChecked();
 await page.getByRole('checkbox', {name:/T2/}).uncheck();await page.locator('button[type=submit]').click();
 await expect(page.locator('[data-table="table-1"]')).toBeVisible();expect(posts[1].adjacent_table_ids).toEqual([]);
});
test('closing from a combined member reviews the group and sends the primary table identity', async ({page}) => {
 await onTheMenu(page,'nothing');
 const posts=[];
 const seating={id:'group-1',primary_id:'table-1',table_ids:['table-1','table-2'],labels:['T1','T2'],guests:4};
 const orders=[{id:'paid-order',paid:true,guests:4}];
 let rows=[{...initial,status:'occupied',orders,seating},{...initial,id:'table-2',tableorder_value:'T2',version:7,status:'occupied',orders,seating}];
 await page.route('**/captain/v1/tables**', async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:{canManage:true,tables:rows}});
  posts.push(route.request().postDataJSON());rows=rows.map(row=>({...row,seating:null,orders:[],status:posts.at(-1).afterClose}));return route.fulfill({json:rows[0]});
 });
 await page.goto('/tables.html');await page.locator('[data-table="table-2"]').click();
 await expect(page.locator('[data-action=edit-table]')).toHaveCount(0);
 await page.locator('[data-action=close-review]').click();
 await expect(page.locator('#table-management-content h3')).toHaveText('T1 + T2');
 await page.locator('[data-action=close-confirm]').click();
 await expect(page.locator('[data-table="table-2"]')).toContainText('Available');
 expect(posts[0]).toMatchObject({id:'table-1',version:0,orderIds:['paid-order']});
});


test('seat limits prevent invalid capacity before sending and allow the normal capacity default', async ({page}) => {
 const {posts}=await open(page);
 await page.locator('[data-table]').click();await page.locator('[data-action=edit-table]').click();
 await page.locator('#capacity').fill('8');
 await page.locator('button[type=submit]').click();
 expect(posts).toHaveLength(0);
 expect(await page.locator('#max_capacity').evaluate(input => input.validity.rangeUnderflow)).toBe(true);
 await page.locator('#max_capacity').fill('');
 await page.locator('button[type=submit]').click();
 await expect(page.locator('[data-table]')).toBeVisible();
 expect(posts[0]).toMatchObject({capacity:'8',max_capacity:''});
});

test('empty table setup stays usable even when the device cache cannot be written', async ({page}) => {
 await onTheMenu(page,'nothing');
 await page.addInitScript(() => {
   const original=Storage.prototype.setItem;
   Storage.prototype.setItem=function(key,value) { if(key==='kiosk_tableorders') throw new Error('full'); return original.call(this,key,value); };
 });
 await page.route('**/captain/v1/tables',route=>route.fulfill({json:{canManage:true,tables:[]}}));
 await page.goto('/tables.html');
 await expect(page.locator('#table-management-content')).toContainText('No tables set up yet.');
 await expect(page.locator('#table-management-message')).toBeEmpty();
 await page.locator('[data-action=add]').click();
 for(const width of [320,768]) {
   await page.setViewportSize({width,height:1024});
   await expect(page.locator('#capacity')).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:`test-artifacts/table-edit-${width}.png`,fullPage:true});
 }
 await page.locator('#tables-back').click();
 await expect(page.locator('[data-action=add]')).toBeVisible();
});
