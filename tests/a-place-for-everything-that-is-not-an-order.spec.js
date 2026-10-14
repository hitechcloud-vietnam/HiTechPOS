import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';

/*
 * A PLACE FOR EVERYTHING THAT IS NOT AN ORDER.
 *
 * Owner: "arrange profile update, logout, app setting or preferences and etc
 * make it professional arrangements... right now its like fucking shit", and
 * then "mobile app make it more professional, menu and options".
 *
 * Every control on this page already existed. What did not exist was anywhere
 * to look for them: signing out was on the floor screen and only on a shop
 * with one branch, the preferences were in a sheet behind a SERVER icon, and
 * the app version was printed on the sign-in screen, so the only way to read
 * it was to sign out.
 *
 * Three headings, in the order somebody asks the questions: who am I and what
 * have I sold, what is this phone set to, and what is this build.
 */

const MENU = [{ category_name: 'Mains', items: [item('p-cb', 'Chicken Biryani', 220)] }];

/** The floor screen, signed in, as a waiter sees it. */
async function onTheFloor(page) {
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.goto('/kot-management.html');
  await expect(page.locator('.floor-new')).toBeVisible();
}

test('THE FLOOR SCREEN HAS A WAY IN, and it is not the server icon', async ({ page }) => {
  await onTheFloor(page);

  const me = page.locator('.captain-navigation a[href="me.html"]');
  await expect(me).toBeVisible();

  await me.click();
  await expect(page).toHaveURL(/me\.html$/);
});

test('it says who is signed in, and offers the day on the way past', async ({ page }) => {
  await onTheFloor(page);
  await page.goto('/me.html');

  await expect(page.locator('#me-home-who')).not.toBeEmpty();
  await expect(page.locator('#me-sales')).toHaveAttribute('href', 'my-sales.html');
});

test('the hub leads to focused account, language and preference screens', async ({ page }) => {
  await onTheFloor(page);
  await page.goto('/me.html');
  await expect(page.locator('#me-password')).toBeHidden();
  await expect(page.locator('#me-server')).toBeVisible();
  await page.locator('a[href="#account"]').click();
  for (const id of ['me-sign-out', 'me-password', 'me-lock']) await expect(page.locator('#' + id)).toBeVisible();
  await expect(page.locator('#me-copies')).toBeHidden();
  await page.locator('#me-back').click();
  await page.locator('a[href="#preferences"]').click();
  await expect(page.locator('#me-copies')).toBeVisible();
  await expect(page.getByRole('link', { name: /number card/i })).toBeVisible();
  await page.locator('#me-copies').selectOption('2');
  await page.reload();
  await expect(page.locator('#me-copies')).toHaveValue('2');
  await page.locator('#me-back').click();
  await page.locator('a[href="#language"]').click();
  await expect(page.locator('#me-language option')).toHaveCount(30);
  await page.goBack();
  await expect(page.locator('#me-server')).toBeVisible();
});

test('and the build is readable without signing out', async ({ page }) => {
  /*
   * It was on the sign-in screen only. "Which version am I on" is a question
   * somebody asks down a telephone while the shop is open.
   */
  await onTheFloor(page);
  await page.goto('/me.html');

  await expect(page.locator('#me-version')).toContainText(/Captain/);
});

test('SIGNING OUT ENDS THE SESSION, not just the menu', async ({ page }) => {
  await onTheFloor(page);
  await page.goto('/me.html');

  await page.locator('a[href="#account"]').click();
  await page.locator('#me-sign-out').click();
  await expect(page.locator('#account-signout')).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
  await expect(page.locator('#account-signout')).toHaveCount(0);
  expect(await page.evaluate(()=>POSNIC.session.active)).toBe(true);
  await page.locator('#me-sign-out').click();
  await page.locator('[data-confirm-signout]').click();
  await expect(page).toHaveURL(/index\.html$/);

  /* The sign-in page is still loading its scripts when the URL changes, and
     asking a page that has no POSNIC yet reads as a failure that is only a
     race. */
  await page.waitForFunction(() => typeof POSNIC !== 'undefined' && !!POSNIC.session);
  expect(await page.evaluate(() => POSNIC.session.active)).toBe(false);
});

/* --------------------------------------------------------------- the money */

test('THE SALES PAGE IS A PAGE, not the first thing a waiter sees', async ({ page }) => {
  /*
   * Owner: "but no on the first page. seperate page." A waiter opens this app
   * to take an order; a screen that opens on money has decided the takings
   * matter more than the table waiting.
   */
  await onTheFloor(page);
  const floor = await page.locator('body').innerText();
  expect(floor).not.toMatch(/my sales/i);
});

test('it shows the total, the tables and the orders, from the till', async ({ page }) => {
  await onTheFloor(page);

  await page.route('**/sales/myDay', (route) =>
    route.fulfill({
      json: {
        type: 'success',
        data: {
          total: 4250,
          orders: 12,
          cancelled: 1,
          tables: [
            { table: 'T4', total: 1200, orders: 3 },
            { table: 'T1', total: 900, orders: 2 },
          ],
          recent: [
            { order_id: '1234', table_number: 'T4', total_amount: 380, created_at: new Date().toISOString() },
          ],
          user_name: 'anita',
          day: '2026-09-18',
        },
      },
    })
  );

  await page.goto('/my-sales.html');

  await expect(page.locator('#sales-total')).toContainText('4,250');
  await expect(page.locator('#sales-count')).toContainText('12 orders');
  await expect(page.locator('#sales-cancelled')).toContainText('1 cancelled');
  await expect(page.locator('#sales-tables')).toContainText('T4');
});

test('a till that will not answer is not "you have sold nothing"', async ({ page }) => {
  /* The difference matters on a screen about money. */
  await onTheFloor(page);
  await page.route('**/sales/myDay', (route) => route.abort('connectionrefused'));

  await page.goto('/my-sales.html');

  await expect(page.locator('#sales-tables')).not.toContainText('No tables yet');
  await expect(page.locator('#sales-total')).toBeEmpty();
});

for (const width of [320, 768]) {
  test(`account navigation fits ${width}px and native Back leaves one screen at a time`, async ({page}) => {
    await page.setViewportSize({width,height:1024});
    await onTheFloor(page);
    await page.goto('/me.html');
    await page.locator('a[href="#account"]').click();
    await page.locator('#me-password').click();
    await expect(page.locator('#currentPassword')).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('captain:back', {cancelable:true})));
    await expect(page.locator('.me-title')).toHaveText('Account');
    await expect(page.locator('#me-password')).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('captain:back', {cancelable:true})));
    await expect(page.locator('#me-server')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:`test-artifacts/account-hub-${width}.png`,fullPage:true});
    await page.locator('a[href="#language"]').click();
    await page.locator('#me-language').selectOption('ar');
    await expect(page.locator('html')).toHaveAttribute('dir','rtl');
    await page.locator('#me-back').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('#me-language-name')).not.toBeEmpty();
  });
}

test('unsent orders prevent account switching but keep server settings reachable', async ({page}) => {
  await onTheFloor(page);
  await page.goto('/me.html#account');
  await expect(page.locator('#me-sign-out')).toBeVisible();
  await page.evaluate(() => localStorage.setItem('posnic.pending-orders',JSON.stringify([{key:'saved-order',state:'waiting'}])));
  const warnings=[];
  page.on('dialog', async dialog => { warnings.push(dialog.message()); await dialog.accept(); });
  await page.locator('#me-sign-out').click();
  await expect.poll(() => warnings.length).toBe(1);
  expect(warnings[0]).toContain('Send saved orders');
  expect(await page.evaluate(() => POSNIC.session.active)).toBe(true);
  await page.locator('#me-back').click();
  await expect(page.locator('#me-server')).toBeVisible();
  expect(await page.evaluate(() => OrderQueue.count())).toBe(1);
});

test('phone alert preferences persist and failed saves leave the real setting visible', async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'vibrate', {configurable:true,value:()=>true}));
  await onTheFloor(page);
  await page.goto('/me.html#preferences');
  await expect(page.locator('#me-sound')).not.toBeChecked();
  await expect(page.locator('#me-vibration')).not.toBeChecked();
  await page.locator('#me-sound').check();
  await page.locator('#me-vibration').check();
  await page.reload();
  await expect(page.locator('#me-sound')).toBeChecked();
  await expect(page.locator('#me-vibration')).toBeChecked();
  await page.locator('#me-sound').uncheck();
  await page.locator('#me-vibration').uncheck();
  await page.reload();
  await expect(page.locator('#me-sound')).not.toBeChecked();
  await expect(page.locator('#me-vibration')).not.toBeChecked();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key,value) { if(key.startsWith('posnic.phone.')) throw new Error('full'); return original.call(this,key,value); };
  });
  await page.locator('#me-sound').click();
  await expect(page.locator('#me-sound')).not.toBeChecked();
  await expect(page.locator('#me-preference-message')).toHaveText('Could not save. Please try again.');
});


test('sales day changes never label previous figures as the selected day', async ({page}) => {
 await onTheFloor(page);
 let attempts=0,release;
 await page.route('**/sales/myDay',async route=>{
   attempts++;
   if(attempts===2){await new Promise(resolve=>{release=resolve});return route.fulfill({status:503,json:{message:'unavailable'}});}
   return route.fulfill({json:{type:'success',data:{total:4250,orders:12,cancelled:1,tables:[{table:'T4',total:4250,orders:12}],recent:[]}}});
 });
 await page.goto('/my-sales.html');
 await expect(page.locator('#sales-count')).toHaveText('12 orders');
 await page.locator('[data-day=yesterday]').click();
 await expect.poll(()=>typeof release).toBe('function');
 await expect(page.locator('#sales-total')).toBeEmpty();
 await expect(page.locator('#sales-count')).toBeEmpty();
 await expect(page.locator('#sales-cancelled')).toBeHidden();
 await expect(page.locator('[data-day=yesterday]')).toHaveAttribute('aria-pressed','true');
 release();
 await expect(page.locator('#sales-status')).toHaveText('The till did not answer. Try again in a moment.');
 await expect(page.locator('#sales-count')).toBeEmpty();
 await page.locator('[data-day=today]').click();
 await expect(page.locator('#sales-count')).toHaveText('12 orders');
 await expect(page.locator('#sales-status')).toBeEmpty();
 await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
 await expect(page).toHaveURL(/me.html$/);
});

test('same-day failed refresh keeps confirmed figures and shows an explicit error', async ({page}) => {
 await onTheFloor(page);
 let fail=false;
 await page.route('**/sales/myDay',route=>route.fulfill(fail?{status:503,json:{message:'unavailable'}}:{json:{type:'success',data:{total:100,orders:2,cancelled:0,tables:[],recent:[]}}}));
 await page.goto('/my-sales.html');
 await expect(page.locator('#sales-count')).toHaveText('2 orders');
 fail=true;
 await page.evaluate(()=>refreshMySales());
 await expect(page.locator('#sales-count')).toHaveText('2 orders');
 await expect(page.locator('#sales-status')).toHaveText('The till did not answer. Try again in a moment.');
});
