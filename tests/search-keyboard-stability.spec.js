import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';

for (const event of ['scroll', 'touchstart', 'mouseover']) {
  test(`search keeps focus when ${event} occurs`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await onTheMenu(page, 'nothing');
    const search = page.locator('#product-search-input');
    await search.fill('co');
    await page.evaluate(event => {
      const target = event === 'scroll' ? window : document.querySelector('.scrollable-products');
      target.dispatchEvent(new Event(event, { bubbles: true }));
    }, event);
    await expect(search).toBeFocused();
    await search.pressSequentially('ffee');
    await expect(search).toHaveValue('coffee');
    await expect(page.locator('#product-notes-modal')).toBeHidden();
    expect(errors).toEqual([]);
  });
}

test('an older search cannot replace the latest results', async ({ page }) => {
  await onTheMenu(page, 'nothing');
  await page.evaluate(async () => {
    const original = getCartData;
    let first = true;
    window.getCartData = async () => {
      if (first) {
        first = false;
        await new Promise(resolve => { window.releaseSearch = resolve; });
      }
      return original();
    };
    const input = document.querySelector('#product-search-input');
    input.value = 'coffee';
    window.oldSearch = applyProductFilter();
    input.value = 'dosa';
    await applyProductFilter();
    window.releaseSearch();
    await window.oldSearch;
  });
  await expect(page.locator('#product-list .dish-name')).toHaveText(['Masala Dosa']);
});

test('clearing then typing cannot restore the full menu over search results', async ({ page }) => {
  await onTheMenu(page, 'nothing');
  await page.locator('#product-search-input').fill('coffee');
  await page.evaluate(async () => {
    const original = getData;
    window.getData = async (...args) => {
      await new Promise(resolve => { window.releaseMenu = resolve; });
      return original(...args);
    };
    const input = document.querySelector('#product-search-input');
    input.value = '';
    window.cleared = applyProductFilter();
    input.value = 'dosa';
    await applyProductFilter();
    window.releaseMenu();
    await window.cleared;
  });
  await expect(page.locator('#product-list .dish-name')).toHaveText(['Masala Dosa']);
});


test('a tap that started on another row cannot open notes or add the moved result', async ({ page }) => {
  await onTheMenu(page, 'nothing');
  for (const target of ['.dish-name', '.btn-add']) {
    await page.evaluate(target => {
      document.querySelector('.dish[data-id="p-coffee"] .dish-name')
        .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      document.querySelector('.dish[data-id="p-dosa"] ' + target)
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    }, target);
    await expect(page.locator('#product-notes-modal')).toBeHidden();
    expect(await page.evaluate(() => getCartData())).toHaveLength(0);
  }
});

test('adding a search result keeps focus and an intentional note tap still works', async ({ page }) => {
  await onTheMenu(page, 'nothing');
  const search = page.locator('#product-search-input');
  await search.fill('coffee');
  await page.locator('.dish[data-id="p-coffee"] .btn-add').click();
  await expect(search).toHaveValue('coffee');
  await expect(search).toBeFocused();
  await expect(page.locator('.dish[data-id="p-coffee"] .dish-qty')).toHaveText('1');
  await expect(page.locator('#product-notes-modal')).toBeHidden();
  await page.locator('.dish[data-id="p-coffee"] .dish-name').click();
  await expect(page.locator('#product-notes-modal')).toBeVisible();
  await expect(page.locator('#notes-product-name')).toHaveText('Coffee');
});

test('redrawing the same item between press and click does not swallow Add or plus', async ({ page }) => {
  await onTheMenu(page, 'nothing');
  await page.locator('#product-search-input').fill('coffee');
  for (const [action, quantity] of [['.btn-add', 1], ['.btn-increase', 2]]) {
    await page.evaluate(async action => {
      const row = document.querySelector('.dish[data-id="p-coffee"]');
      row.querySelector(action).dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
      row.replaceWith(row.cloneNode(true));
      document.querySelector('.dish[data-id="p-coffee"] ' + action)
        .dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true,detail:1}));
      await waitForCartMutations();
    }, action);
    await expect(page.locator('.dish[data-id="p-coffee"] .dish-qty')).toHaveText(String(quantity));
  }
});


test('a menu reload preserves the active query and keyboard focus', async ({ page }) => {
  await onTheMenu(page, 'nothing');
  const search = page.locator('#product-search-input');
  await search.fill('coffee');
  await page.evaluate(() => loadProducts());
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('coffee');
  await expect(page.locator('#product-list .dish-name')).toHaveText(['Coffee']);
  await expect(page.locator('#product-notes-modal')).toBeHidden();
});


test('Add retains results and selects the query for replacement typing', async ({ page }) => {
  await onTheMenu(page, 'nothing');
  const search = page.locator('#product-search-input');
  await search.fill('3 coffee');
  await page.locator('.dish[data-id="p-coffee"] .btn-add').click();
  await expect(search).toHaveValue('3 coffee');
  await expect(search).toBeFocused();
  expect(await search.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([0, 8]);
  await expect(page.locator('.dish[data-id="p-coffee"] .dish-qty')).toHaveText('3');
  await page.locator('.dish[data-id="p-coffee"] .btn-increase').click();
  await expect(page.locator('.dish[data-id="p-coffee"] .dish-qty')).toHaveText('4');
  await expect(search).toHaveValue('3 coffee');
  await expect(page.locator('#product-list .dish-name')).toHaveText(['Coffee']);
  await search.pressSequentially('dosa');
  await page.locator('.dish[data-id="p-dosa"] .btn-add').click();
  await expect(search).toHaveValue('dosa');
  await expect(page.locator('.dish[data-id="p-dosa"] .dish-qty')).toHaveText('1');
  await search.pressSequentially('coffee');
  await page.locator('.dish[data-id="p-coffee"] .btn-increase').click();
  await expect(search).toHaveValue('coffee');
  await expect(search).toBeFocused();
  await expect(page.locator('.dish[data-id="p-coffee"] .dish-qty')).toHaveText('5');
});

test('cancelled add retains the query and a slow add cannot erase a newer query', async ({ page }) => {
  await onTheMenu(page, 'nothing');
  const search = page.locator('#product-search-input');
  await search.fill('coffee');
  await page.evaluate(() => { POSNIC.askOptions = async () => null; });
  await page.locator('.dish[data-id="p-coffee"] .btn-add').click();
  await page.evaluate(() => waitForCartMutations());
  await expect(search).toHaveValue('coffee');
  expect(await page.evaluate(() => getCartData())).toHaveLength(0);
  await page.evaluate(() => {
    POSNIC.askOptions = () => new Promise(resolve => { window.finishOptions = () => resolve([]); });
  });
  await page.locator('.dish[data-id="p-coffee"] .btn-add').click();
  await page.waitForFunction(() => typeof window.finishOptions === 'function');
  await search.fill('dosa');
  await page.evaluate(async () => { window.finishOptions(); await waitForCartMutations(); });
  await expect(search).toHaveValue('dosa');
  await expect(search).toBeFocused();
  await expect(page.locator('#product-list .dish-name')).toHaveText(['Masala Dosa']);
  expect(await page.evaluate(async () => (await getCartData()).find(i => i.id === 'p-coffee').quantity)).toBe(1);
});
