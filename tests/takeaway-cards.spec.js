import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';

test('takeaway customers have separate cards, paid preparation stays open and swipes retain identity', async ({ page }) => {
  await onTheMenu(page, 'nothing');
  const ids = ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'];
  const requested = [];
  await page.route('**/sales/getTablesWithActiveOrders', r => r.fulfill({ json: { type: 'success', data: {
    tables: [], has_takeaway: true,
    takeaway_orders: ids.map((id, i) => ({sale_id: id, number: String(i + 1), orders: 1,
      amount: 100, payment_status: i ? 'Unpaid' : 'Paid', since: new Date().toISOString()})),
  } } }));
  await page.route('**/captain/v1/kitchen-ready', r => r.fulfill({json:{
    tickets: [{table:'', saleId:ids[0], items:[{ready:1,served:0}]}],
    readiness: [{table:'', saleId:ids[0], ready:1, remaining:2, items:[{name:'Fish',quantity:1}]}],
  }}));
  await page.route('**/sales/getListKot?*', r => {
    const filters = JSON.parse(new URL(r.request().url()).searchParams.get('filters'));
    requested.push(filters);
    return r.fulfill({json:{type:'success', data:{list:[{_id:filters._id, items:[], sales_total:100}]}}});
  });
  await page.goto('/kot-management.html');
  await expect(page.locator('.floor-card')).toHaveCount(2);
  await expect(page.locator('.floor-card').first()).toContainText('Take Away 1');
  await expect(page.locator('.floor-card').first()).toContainText('Paid');
  await expect(page.locator('.floor-ready')).toHaveCount(1);
  await page.locator('[data-floor-filter=ready]').click();
  await expect(page.locator('.floor-card')).toHaveCount(1);
  await expect(page.locator('.floor-card')).toHaveAttribute('data-sale-id', ids[0]);
  await page.locator('[data-floor-filter=active]').click();
  await page.locator('.floor-card').first().click();
  await expect(page.locator('#panel-title')).toHaveText('Take Away 1');
  await expect(page.locator('.kot-card')).toHaveCount(1);
  expect(requested).toContainEqual({_id:ids[0],dine_type:'Take away'});
  await page.locator('[data-detail-step="1"]').click();
  await expect(page.locator('#panel-title')).toHaveText('Take Away 2');
  await expect.poll(() => requested.at(-1)?._id).toBe(ids[1]);
});

test('older server summary is expanded into separate numbered takeaway cards', async ({page})=>{
 await onTheMenu(page,'nothing');
 const ids=['507f1f77bcf86cd799439013','507f1f77bcf86cd799439014'];
 await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:[],has_takeaway:true}}}));
 await page.route('**/sales/getListKot?*',r=>r.fulfill({json:{type:'success',data:{list:ids.map((id,i)=>({_id:id,token_id:String(i+3),sales_total:100,created_date:new Date().toISOString(),items:[]}))}}}));
 await page.goto('/kot-management.html');
 await expect(page.locator('.floor-card')).toHaveCount(2);
 await expect(page.locator('.floor-card').first()).toContainText('Take Away 3');
 await expect(page.locator('.floor-card').last()).toContainText('Take Away 4');
 await expect(page.locator('.floor-card').last()).toHaveAttribute('data-sale-id',ids[1]);
 await expect(page.locator('#floor-count')).toContainText('2');
});

test('new order tokens contain only digits and do not reuse legacy tokens on this phone',async({page})=>{
 await onTheMenu(page,'nothing');
 const result=await page.evaluate(()=>{
  localStorage.setItem(getTodayKey(),JSON.stringify(['A001','L931']));
  const issued=Array.from({length:100},()=>generateUniqueToken());
  return {issued,legacy:numericToken('L931')};
 });
 expect(result.issued.every(token=>/^[0-9]+$/.test(token))).toBe(true);
 expect(new Set(result.issued).size).toBe(100);
 expect(result.issued).not.toContain('1');
 expect(result.issued).not.toContain(result.legacy);
});
test('table cards show an explicit table icon and label',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:['5'],table_details:[{table_number:'5',orders:1,amount:1354.50}]}}}));
 await page.goto('/kot-management.html');
 await expect(page.locator('.floor-card .table-type-icon svg')).toBeVisible();
 await expect(page.locator('.floor-card .floor-name')).toContainText('Table 5');
 await page.screenshot({path:'test-artifacts/table-card-design.png',fullPage:true});
});

for (const [width,scheme] of [[320,'light'],[390,'dark'],[768,'light']]) test(`soft floor cards ${width} ${scheme}`,async({page})=>{
 await page.setViewportSize({width,height:850});
 await page.emulateMedia({colorScheme:scheme});
 await onTheMenu(page,'nothing');
 await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{
  tables:['4','5'],table_details:[{table_number:'4',orders:2,amount:440,minutes:12},{table_number:'5',orders:1,amount:280,minutes:25}],
  takeaway_orders:[{sale_id:'507f1f77bcf86cd799439011',number:'1',orders:1,amount:190,payment_status:'Paid',since:new Date().toISOString()}]
 }}}));
 await page.goto('/kot-management.html');
 await expect(page.locator('.floor-card')).toHaveCount(3);
 await expect(page.locator('.takeaway-type-icon svg')).toBeVisible();
 const sizes=await page.locator('.floor-card').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().width));
 expect(Math.max(...sizes)-Math.min(...sizes)).toBeLessThan(2);
 for(const card of await page.locator('.floor-card').all()){
  expect(await card.locator('.floor-name').evaluate(n=>getComputedStyle(n).fontWeight)).toBe('500');
  expect(await card.evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
 }
 await page.screenshot({path:`test-artifacts/soft-floor-cards-${width}-${scheme}.png`,fullPage:true});
});


for(const width of [320,490,768])test(`available and occupied table cards have equal dimensions at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:850});
 await onTheMenu(page,'nothing');
 const tables=Array.from({length:5},(_,i)=>({id:String(i+1),tableorder_value:String(i+1),status:'available',orders:[]}));
 await page.route('**/captain/v1/tables',r=>r.fulfill({json:{tables}}));
 await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:['2'],table_details:[{table_number:'2',orders:1,amount:400,since:new Date().toISOString()}]}}}));
 await page.goto('/kot-management.html');
 await page.locator('[data-floor-filter=all]').click();
 await expect(page.locator('.floor-card')).toHaveCount(5);
 const sizes=await page.locator('.floor-card').evaluateAll(cards=>cards.map(card=>{const r=card.getBoundingClientRect();return {width:r.width,height:r.height,overflow:card.scrollHeight>card.clientHeight+1};}));
 expect(Math.max(...sizes.map(s=>s.height))-Math.min(...sizes.map(s=>s.height))).toBeLessThan(1);
 expect(Math.max(...sizes.map(s=>s.width))-Math.min(...sizes.map(s=>s.width))).toBeLessThan(1);
 expect(sizes.some(s=>s.overflow)).toBe(false);
 if(width===490)await page.screenshot({path:'test-artifacts/equal-table-cards.png'});
});
