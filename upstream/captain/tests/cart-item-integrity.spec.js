import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';

const menu = [{ category_name: 'Food', items: [
  item('mushroom', 'Mushroom Manchurian', 150),
  item('baby-corn', 'Baby Corn Starter', 120),
  item('soup', 'Sweet Corn Soup', 90),
] }];

test('concurrent adds and a note keep every dish and the correct note', async ({ page }) => {
  await onTheMenu(page, 'nothing', { menu });
  const cart = await page.evaluate(async () => {
    await Promise.all([
      updateQuantity('mushroom', 1),
      updateQuantity('baby-corn', 1),
      updateQuantity('soup', 2),
      setCartItemNotes('baby-corn', 'Salt & pepper'),
    ]);
    return getCartData();
  });
  expect(cart.map(i => i.id).sort()).toEqual(['baby-corn', 'mushroom', 'soup']);
  expect(cart.find(i => i.id === 'baby-corn')).toMatchObject({ quantity: 1, notes: 'Salt & pepper' });
  expect(cart.find(i => i.id === 'mushroom')).toMatchObject({ quantity: 1, name: 'Mushroom Manchurian' });
  expect(cart.find(i => i.id === 'mushroom').notes || '').toBe('');
  expect(cart.find(i => i.id === 'soup').quantity).toBe(2);
});

test('a pending note save cannot add a different dish opened afterwards', async ({ page }) => {
  await onTheMenu(page, 'nothing', { menu });
  await page.evaluate(() => {
    const original = setCartItemNotes;
    window.setCartItemNotes = async (...args) => {
      await new Promise(resolve => { window.releaseNote = resolve; });
      return original(...args);
    };
    $('.dish[data-id="baby-corn"]').trigger('click');
    $('#product-notes-text').val('Salt & pepper');
    $('#notes-apply-btn').trigger('click');
    // Let the tracked click capture the original editor before switching.
  });
  await page.waitForFunction(() => typeof window.releaseNote === 'function');
  await page.evaluate(() => {
    $('#notes-cancel-btn').trigger('click');
    $('.dish[data-id="mushroom"]').trigger('click');
    window.releaseNote();
  });
  await expect.poll(() => page.evaluate(async () => (await getCartData()).find(i => i.id === 'baby-corn')?.quantity)).toBe(1);
  expect(await page.evaluate(async () => (await getCartData()).some(i => i.id === 'mushroom'))).toBe(false);
  await expect(page.locator('#product-notes-modal')).toBeVisible();
});


test('View bill waits for the last Add tap to be saved', async ({ page }) => {
  await onTheMenu(page, 'nothing', { menu });
  await page.evaluate(() => {
    const original = getProductById;
    window.getProductById = async (...args) => {
      await new Promise(resolve => setTimeout(resolve, 180));
      return original(...args);
    };
    $('.btn-add[data-id="mushroom"]').trigger('click');
    goToBill();
  });
  await expect(page).toHaveURL(/cart\.html$/);
  await expect(page.locator('#cart-item-mushroom')).toContainText('Mushroom Manchurian');
});


test('a delayed cart note updates only baby corn, even after another editor opens', async ({ page }) => {
  await onTheMenu(page, 'nothing', { menu });
  await page.evaluate(async () => {
    await updateQuantity('mushroom', 1);
    await updateQuantity('baby-corn', 1);
  });
  await page.goto('/cart.html');
  await expect(page.locator('#cart-item-baby-corn')).toBeVisible();
  await page.locator('#cart-item-baby-corn .bill-name').click();
  await expect(page.locator('#cart-notes-modal')).toBeHidden();
  await page.evaluate(() => {
    const original = setCartItemNotes;
    window.setCartItemNotes = async (...args) => {
      await new Promise(resolve => { window.releaseNote = resolve; });
      return original(...args);
    };
    $('#cart-item-baby-corn .bill-note-action').trigger('click');
    $('#cart-notes-text').val('Salt & pepper');
    $('#cart-notes-save-btn').trigger('click');
  });
  await page.waitForFunction(() => typeof window.releaseNote === 'function');
  await page.evaluate(() => {
    $('#cart-notes-cancel-btn').trigger('click');
    $('#cart-item-mushroom .bill-note-action').trigger('click');
    window.releaseNote();
  });
  await expect(page.locator('#cart-item-baby-corn .bill-note')).toHaveText('Salt & pepper');
  await expect(page.locator('#cart-item-mushroom .bill-note')).toHaveCount(0);
  await expect(page.locator('#cart-notes-modal')).toBeVisible();
  await expect(page.locator('#cart-notes-product-name')).toHaveText('Mushroom Manchurian');
});

test('the kitchen payload keeps all dishes and notes on their own item IDs', async ({ page }) => {
  await onTheMenu(page, 'nothing', { menu });
  const payload = await page.evaluate(async () => {
    // Stop before navigation/delivery; inspect exactly what the durable queue receives.
    OrderQueue.add = entry => { window.sentBody = entry.body; return false; };
    updateQuantity('mushroom', 1);
    updateQuantity('baby-corn', 1);
    updateQuantity('soup', 2);
    setCartItemNotes('baby-corn', 'Salt & pepper');
    await checkout('regression');
    return window.sentBody.items;
  });
  expect(payload).toHaveLength(3);
  expect(payload.find(i => i.item_id === 'baby-corn')).toMatchObject({ item_quantity: 1, item_description: 'Salt & pepper' });
  expect(payload.find(i => i.item_id === 'mushroom')).toMatchObject({ item_quantity: 1, item_name: 'Mushroom Manchurian', item_description: '' });
  expect(payload.find(i => i.item_id === 'soup').item_quantity).toBe(2);
});


test('two preparations of one dish keep independent notes, quantities and payload identities', async ({ page }) => {
  await onTheMenu(page, 'nothing', { menu });
  const result = await page.evaluate(async () => {
    await updateQuantity('mushroom', 1, {modifiers:[{group:'Style',name:'Dry'}]});
    await setCartItemNotes('mushroom','No chilli');
    await updateQuantity('mushroom', 1, {modifiers:[{group:'Style',name:'Gravy'}]});
    const lines = await getCartData();
    const gravy = lines.find(line => line.modifiers[0].name === 'Gravy');
    await setCartItemNotes(gravy.id,'Extra sauce');
    await updateCartQuantity(gravy.id,1);
    await syncCartSilently(await getData('products'));
    OrderQueue.add = entry => { window.sentBody = entry.body; return false; };
    await checkout('line-identity');
    return {cart:await getCartData(), payload:window.sentBody.items};
  });
  expect(result.payload).toHaveLength(2);
  expect(new Set(result.payload.map(line => line.line_id)).size).toBe(2);
  expect(result.payload.every(line => line.item_id === 'mushroom')).toBe(true);
  expect(result.payload.find(line => line.item_description === 'No chilli').item_quantity).toBe(1);
  expect(result.payload.find(line => line.item_description === 'Extra sauce').item_quantity).toBe(2);
});


test('preparation sheet separates one plate and preserves seat, hold and allergy through checkout', async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await onTheMenu(page,'nothing',{menu});
  await page.evaluate(async()=>{await updateQuantity('mushroom',2);});
  await page.goto('/cart.html');
  await page.locator('[data-preparation-cart="mushroom"]').click();
  const dialog=page.locator('#preparation-dialog');
  await dialog.locator('[name=seat]').fill('2');
  await dialog.locator('[name=course]').selectOption('Main course');
  await dialog.locator('[name=held]').check();
  await dialog.locator('summary').click();
  await dialog.locator('[name=allergy][value=milk]').check();
  await dialog.locator('[name=allergy_note]').fill('Confirm with chef');
  await dialog.locator('[name=separate]').check();
  await page.screenshot({path:'test-artifacts/readiness-preparation-phone.png'});
  await dialog.locator('[type=submit]').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.bill-line')).toHaveCount(2);
  const payload=await page.evaluate(async()=>{OrderQueue.add=entry=>{window.sentBody=entry.body;return false;};await checkout('prepared');return window.sentBody.items;});
  const held=payload.find(line=>line.held);
  expect(held).toMatchObject({item_id:'mushroom',item_quantity:1,seat:2,course:'Main course',allergies:['milk'],allergy_note:'Confirm with chef'});
  expect(payload.find(line=>!line.held)).toMatchObject({item_quantity:1,seat:0,allergies:[]});
});


test('an older server keeps ordinary ordering and does not offer unsupported preparation controls', async ({page}) => {
 await onTheMenu(page,'nothing',{serviceControls:false});
 await page.locator('.dish .btn-add').first().click();
 await page.locator('#next-btn').click();
 await expect(page).toHaveURL(/cart\.html/);
 await expect(page.locator('[data-preparation-cart]')).toHaveCount(0);
 await expect(page.locator('.bill-qty').first()).toHaveText('1');
});


test('preparation Back keeps unsaved allergy details until discard is confirmed', async ({page}) => {
 await onTheMenu(page,'nothing',{menu});
 await page.evaluate(async()=>updateQuantity('mushroom',1));
 await page.goto('/cart.html');
 await page.locator('[data-preparation-cart="mushroom"]').click();
 const dialog=page.locator('#preparation-dialog');
 await dialog.locator('summary').click();
 await dialog.locator('[name=allergy_note]').fill('Ask chef about peanuts');
 await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
 await page.locator('#captain-discard [data-confirm-action=keep]').click();
 await expect(dialog.locator('[name=allergy_note]')).toHaveValue('Ask chef about peanuts');
 await expect(page).toHaveURL(/cart.html/);
 await page.keyboard.press('Escape');
 await page.locator('#captain-discard [data-confirm-action=discard]').click();
 await expect(dialog).toHaveCount(0);
 await expect(page.locator('[data-preparation-cart="mushroom"]')).toBeFocused();
 const cart=await page.evaluate(()=>getCartData());
 expect(cart[0].allergy_note||'').toBe('');
});

test('preparation stays open during save and retains its draft on failure', async ({page}) => {
 await onTheMenu(page,'nothing',{menu});
 await page.goto('/cart.html');
 await page.evaluate(()=>ServiceDetails.open({name:'Soup'},()=>new Promise((resolve,reject)=>{window.failPreparation=()=>reject(new Error('Could not save. Please try again.'));})));
 const dialog=page.locator('#preparation-dialog');
 await dialog.locator('[name=seat]').fill('2');
 await dialog.locator('[type=submit]').click();
 await expect(dialog).toHaveAttribute('aria-busy','true');
 await expect(dialog.locator('[name=seat]')).toBeDisabled();
 await page.keyboard.press('Escape');
 await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
 await expect(dialog).toBeVisible();
 await page.evaluate(()=>window.failPreparation());
 await expect(dialog.locator('[role=alert]')).toHaveText('Could not save. Please try again.');
 await expect(dialog.locator('[name=seat]')).toBeEnabled();
 await expect(dialog.locator('[name=seat]')).toHaveValue('2');
});

for(const width of [320,768]) test(`preparation follows the dark theme and fits ${width}px`, async ({page})=>{
 await page.emulateMedia({colorScheme:'dark'});
 await page.setViewportSize({width,height:1024});
 await onTheMenu(page,'nothing',{menu});
 await page.goto('/cart.html');
 await page.evaluate(()=>ServiceDetails.open({name:'Mushroom starter',allergies:['milk']},async()=>{}));
 const dialog=page.locator('#preparation-dialog');
 expect(await dialog.evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe('rgb(255, 255, 255)');
 const bounds=await dialog.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
 await page.screenshot({path:`test-artifacts/preparation-dark-${width}.png`,fullPage:true});
});

test('cart Note and Preparation have distinct spaced touch targets',async({page})=>{
 await page.setViewportSize({width:320,height:700});
 await onTheMenu(page,'nothing',{menu});
 await page.evaluate(()=>updateQuantity('mushroom',1));
 await page.goto('/cart.html');
 const note=page.locator('.bill-note-action'),prep=page.locator('.bill-preparation-action');
 await expect(prep).toHaveAttribute('aria-label','Preparation');
 const n=await note.boundingBox(),p=await prep.boundingBox();
 expect(n.height).toBeGreaterThanOrEqual(44);expect(p.height).toBeGreaterThanOrEqual(44);
 expect(p.x>=n.x+n.width+7 || p.y>=n.y+n.height+7).toBe(true);
 await page.screenshot({path:'test-artifacts/cart-item-actions-320.png',fullPage:true});
 await note.click();await expect(page.locator('#cart-notes-modal')).toBeVisible();
 await page.locator('#cart-notes-cancel-btn').click();
 await prep.click();await expect(page.locator('#preparation-dialog')).toBeVisible();
});
