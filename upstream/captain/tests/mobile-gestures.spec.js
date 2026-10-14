import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';
test.use({ hasTouch: true });

async function swipe(page, target, {dx = 0, dy = 150, cancel = false} = {}) {
  const box = await page.locator(target).boundingBox();
  const x = Math.max(40, Math.min(250, box.x + box.width / 2));
  const y = box.y + Math.min(12, box.height / 2);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x,y}] });
  for (let n = 1; n <= 6; n++) {
    await cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x:x+dx*n/6,y:y+dy*n/6}] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type:cancel?'touchCancel':'touchEnd', touchPoints:[] });
  await cdp.detach();
}
async function floor(page) {
  await onTheMenu(page, 'nothing');
  let count = 0, fail = false, hold = null;
  await page.route('**/sales/getTablesWithActiveOrders', async route => {
    count++;
    if (hold) await hold;
    await route.fulfill({json: fail ? {type:'error',message:'offline'} : {type:'success',data:{tables:count === 1?['1']:['1','2']}}});
  });
  await page.goto('/kot-management.html');
  await expect(page.locator('.floor-card')).toHaveCount(1);
  return { count:()=>count, fail:()=>{fail=true;}, hold:promise=>{hold=promise;} };
}

test('pulling the active table list refreshes in place, without activating a table', async ({page}) => {
  const api = await floor(page);
  const marker = await page.evaluate(() => window.gesturePageMarker = Math.random());
  await swipe(page, '#tables-list');
  await expect(page.locator('.floor-card')).toHaveCount(2);
  await expect(page.locator('#mobile-refresh-status')).toHaveAttribute('data-state','done');
  expect(api.count()).toBe(2);
  expect(await page.evaluate(() => window.gesturePageMarker)).toBe(marker);
  await expect(page.locator('#kot-sliding-panel')).not.toHaveClass(/open/);
});

test('failed refresh keeps active tables and releases refresh controls', async ({page}) => {
  const api = await floor(page); api.fail();
  await swipe(page, '#tables-list');
  await expect(page.locator('#mobile-refresh-status')).toHaveAttribute('data-state','error');
  await expect(page.locator('.floor-card')).toHaveCount(1);
  await expect(page.locator('[data-mobile-refresh]')).toBeEnabled();
});

test('repeated pulls and refresh taps share one pending request', async ({page}) => {
  const api = await floor(page);
  let release; api.hold(new Promise(resolve => {release=resolve;}));
  await swipe(page, '#tables-list');
  await expect.poll(api.count).toBe(2);
  await page.screenshot({path:"test-artifacts/pull-refresh-loading.png"});
  await page.evaluate(() => { MobileGestures.refresh(); refreshPage(); });
  await swipe(page, '#tables-list');
  expect(api.count()).toBe(2);
  release();
  await expect(page.locator('.floor-card')).toHaveCount(2);
});

for (const [name,gesture] of [['short',{dy:35}],['horizontal',{dx:100,dy:15}],['cancelled',{cancel:true}]]) {
  test(`${name} gesture does not refresh or activate an order`, async ({page}) => {
    const api = await floor(page);
    await swipe(page, '#tables-list',gesture);
    expect(api.count()).toBe(1);
    await expect(page.locator('#kot-sliding-panel')).not.toHaveClass(/open/);
  });
}

test('menu refresh preserves selected items and gestures do not interrupt typing or notes', async ({page}) => {
  await onTheMenu(page, 'nothing');
  await page.evaluate(() => updateQuantity('p-coffee',1));
  let refreshes=0;
  await page.route('**/items/accessQr',route=>{refreshes++;return route.fulfill({json:{type:'success',data:{products:[{category_name:'Food',items:[item('p-biryani','Chicken Biryani',220)]}],kiosk_images:{},tableorders:[],kiosk_payment:{}}}});});
  const search=page.locator('#product-search-input');
  await search.fill('coffee');
  await swipe(page,'#product-list');
  expect(refreshes).toBe(0);
  await expect(search).toBeFocused();
  await page.locator('.dish-name').click();
  await swipe(page,'#product-notes-modal');
  expect(refreshes).toBe(0);
  await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
  await expect(page.locator('#product-notes-modal')).toBeHidden();
  await page.evaluate(()=>{window.dispatchEvent(new Event('captain:back',{cancelable:true}));document.activeElement.blur();window.scrollTo(0,0);});
  await expect(search).toHaveValue('');
  await page.locator('[data-mobile-refresh]').click();
  await expect(page.locator('#mobile-refresh-status')).toHaveAttribute('data-state','done');
  expect(refreshes).toBe(1);
  expect(await page.evaluate(async()=>(await getCartData()).find(i=>i.id==='p-coffee').quantity)).toBe(1);
});

test('history refresh preserves the selected table and last results on failure; Back returns to tables', async ({page}) => {
  await onTheMenu(page,'nothing');
  let fail=false;
  await page.route('**/sales/getOrderHistory',route=>route.fulfill({json: fail?{type:'error',message:'offline'}:{type:'success',data:{orders:[{_id:'order-1',table_number:'1',dine_type:'Dine-in',status:'pending',total_amount:100,items:[]}]}}}));
  await page.goto('/order-history.html');
  await page.waitForFunction(()=>typeof allOrders !== 'undefined' && allOrders.length===1);
  await page.evaluate(()=>showOrderListScreen('1'));
  await expect(page.locator('#orders-list .order-card')).toHaveCount(1);
  fail=true;
  await swipe(page,'#orders-list');
  await expect(page.locator('#mobile-refresh-status')).toHaveAttribute('data-state','error');
  await expect(page.locator('#orders-list .order-card')).toHaveCount(1);
  await expect(page.locator('#page-loader')).toBeHidden();
  await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
  await expect(page.locator('#order-list-screen')).toBeVisible();
  await expect(page.locator('#header-title')).toHaveText('All Orders');
});


test('a list scrolled below the top scrolls normally instead of refreshing', async ({page}) => {
  const api = await floor(page);
  await page.evaluate(() => {
    const list=document.querySelector('#tables-list');
    list.style.cssText='display:block;height:220px;flex:none;overflow:auto;';
    const spacer=document.createElement('div'); spacer.style.height='1200px'; list.append(spacer);
    list.scrollTop=300;
  });
  await swipe(page,'#tables-list',{dy:100});
  expect(api.count()).toBe(1);
  expect(await page.locator('#tables-list').evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
});

test('Back closes the menu index before clearing search or leaving the menu', async ({page}) => {
  await onTheMenu(page,'nothing');
  await page.evaluate(()=>MenuScreen.openIndex());
  await expect(page.locator('#menu-index')).toBeVisible();
  expect(await page.evaluate(()=>!window.dispatchEvent(new Event('captain:back',{cancelable:true})))).toBe(true);
  await expect(page.locator('#menu-index')).toBeHidden();
  await page.locator('#product-search-input').fill('coffee');
  expect(await page.evaluate(()=>!window.dispatchEvent(new Event('captain:back',{cancelable:true})))).toBe(true);
  await expect(page.locator('#product-search-input')).toHaveValue('');
  await expect(page).toHaveURL(/products\.html$/);
});


test('the menu sheet drags down to dismiss, without refreshing or navigating away', async ({page}) => {
  await onTheMenu(page,'nothing');
  await page.evaluate(()=>MenuScreen.openIndex());
  await swipe(page,'#menu-index .ui-sheet-head',{dy:110});
  await expect(page.locator('#menu-index')).toBeHidden();
  await expect(page.locator('#mobile-refresh-status')).toBeHidden();
  await expect(page).toHaveURL(/products\.html$/);
});


test('an empty menu refresh stays on the menu and keeps the branch and cart', async ({page}) => {
  await onTheMenu(page,'nothing');
  await page.evaluate(()=>updateQuantity('p-coffee',1));
  const branch=await page.evaluate(()=>localStorage.getItem('kiosk_selected_branch'));
  await page.route('**/items/accessQr',route=>route.fulfill({json:{type:'success',data:{products:[]}}}));
  await page.locator('[data-mobile-refresh]').click();
  await expect(page.locator('#mobile-refresh-status')).toHaveAttribute('data-state','error');
  await expect(page).toHaveURL(/products\.html$/);
  expect(await page.evaluate(()=>localStorage.getItem('kiosk_selected_branch'))).toBe(branch);
  expect(await page.evaluate(async()=>(await getCartData()).find(i=>i.id==='p-coffee').quantity)).toBe(1);
});


test('dashboard pull restores the connection before requesting fresh tables', async ({page}) => {
  await floor(page);
  await page.evaluate(() => {
    window.recoverySteps=[];
    POSNIC.net.check=async manual=>{
      recoverySteps.push(manual?'reconnect':'automatic');
      await new Promise(resolve=>setTimeout(resolve,50));
      recoverySteps.push('restored');
      return true;
    };
    const original=window.loadTables;
    window.loadTables=()=>{recoverySteps.push('tables');return original();};
  });
  await swipe(page,'#tables-list');
  await expect(page.locator('.floor-card')).toHaveCount(2);
  expect(await page.evaluate(()=>recoverySteps)).toEqual(['reconnect','restored','tables']);
});
