import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
async function open(page){
 await onTheMenu(page,'nothing');let data={id:'branch',name:'Garden',revision:'first',branch_upi_id:'garden@bank',branch_upi_name:'Garden Restaurant'};const posts=[];let conflict=false;
 await page.route('**/captain/v1/branch-details',async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:data});
  const body=route.request().postDataJSON();posts.push(body);
  if(conflict)return route.fulfill({status:409,json:{error:{message:'Settings changed'}}});
  data={...data,...body,revision:'next'};return route.fulfill({json:data});
 });await page.goto('/branch-details.html');await expect(page.locator('#branch-upi-id')).toHaveValue('garden@bank');
 return {posts,conflict(){conflict=true;data={...data,revision:'newer',branch_upi_id:'cashier@bank'};}};
}
test('branch UPI validates receiving details, saves to the server and supports Back',async({page})=>{
 const {posts}=await open(page);await page.locator('#branch-upi-id').fill('not a upi id');await page.locator('button[type=submit]').click();
 await expect(page.locator('#branch-message')).toContainText('valid UPI');expect(posts).toHaveLength(0);
 await page.locator('#branch-upi-id').fill('new@bank');await page.locator('button[type=submit]').click();await expect(page.locator('#branch-message')).toHaveText('Saved');
 expect(posts[0]).toMatchObject({branch_upi_id:'new@bank',branch_upi_name:'Garden Restaurant',revision:'first'});
 await page.locator('#branch-back').click();await expect(page).toHaveURL(/me.html/);
});
test('a changed payee keeps the draft until staff choose to refresh',async({page})=>{
 const server=await open(page);await page.locator('#branch-upi-id').fill('draft@bank');server.conflict();await page.locator('button[type=submit]').click();
 await expect(page.locator('#branch-message')).toContainText('Settings changed');await expect(page.locator('#branch-upi-id')).toHaveValue('draft@bank');
 await page.locator('#branch-retry').click();
 await page.locator('#captain-discard [data-confirm-action=discard]').click();await expect(page.locator('#branch-upi-id')).toHaveValue('cashier@bank');
});

for(const [label,patch] of [['missing details',null],['wrong branch',{id:'other'}],['wrong payee',{branch_upi_id:'other@bank'}],['wrong name',{branch_upi_name:'Another Restaurant'}],['missing revision',{revision:''}]]) {
 test(`UPI save rejects ${label} without losing its draft or original revision`,async({page})=>{
  await open(page);
  await page.route('**/captain/v1/branch-details',route=>route.fulfill({json:patch===null?{}:{id:'branch',revision:'next',branch_upi_id:'draft@bank',branch_upi_name:'Garden Restaurant',...patch}}));
  await page.locator('#branch-upi-id').fill('draft@bank');
  await page.locator('button[type=submit]').click();
  await expect(page.locator('#branch-message')).toHaveText('Could not save. Please try again.');
  await expect(page.locator('#branch-upi-id')).toHaveValue('draft@bank');
  await expect(page.locator('#branch-upi-name')).toHaveValue('Garden Restaurant');
  const posts=[];
  await page.route('**/captain/v1/branch-details',route=>{const body=route.request().postDataJSON();posts.push(body);return route.fulfill({json:{id:'branch',...body,revision:'confirmed'}});});
  await page.locator('button[type=submit]').click();
  await expect(page.locator('#branch-message')).toHaveText('Saved');
  expect(posts[0].revision).toBe('first');
 });
}

test('removing UPI accepts the server clearing the receiving name',async({page})=>{
 await open(page);
 await page.route('**/captain/v1/branch-details',route=>route.fulfill({json:{id:'branch',revision:'cleared',branch_upi_id:'',branch_upi_name:''}}));
 await page.locator('#branch-upi-id').fill('');
 await page.locator('button[type=submit]').click();
 await expect(page.locator('#branch-message')).toHaveText('Saved');
 await expect(page.locator('#branch-upi-name')).toHaveValue('');
});
