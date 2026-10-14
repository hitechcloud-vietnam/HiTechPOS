import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';

/*
 * THE ADD-ITEM SHEET, USED THE WAY A WAITER USES IT.
 *
 * Owner, after installing it: "now that search not clickable. when add its
 * shows as added and add button again. WTF? it supposed + and - number as
 * other add screen intial one."
 *
 * Both were real and neither was caught, because every test on that sheet
 * asserted on markup and on spies. The markup was right. What the markup did
 * in a browser, inside a Bootstrap modal, with a finger on it, was not:
 *
 *   THE SEARCH COULD NOT TAKE FOCUS. Bootstrap 5 modals enforce focus - they
 *   pull anything focused outside the modal straight back in. The sheet was a
 *   SIBLING of the modal, so its input could be tapped and never focused,
 *   while the buttons kept working, because a click does not need to keep
 *   focus. "Not clickable, but adding works" is exactly that shape.
 *
 *   ADDING SAID "Added" AND WENT BACK TO ADD. The sheet handed MenuView an
 *   empty cart, so every row drew ADD however many times it had been tapped.
 *   MenuView draws `- qty +` whenever it is given a count; it was never given
 *   one.
 *
 * So this file drives the sheet rather than reading it: type in the box, tap
 * ADD, and look at what the row becomes.
 */

const MENU = [
  {
    category_name: 'Biryani',
    items: [
      item('p-1', 'Chicken Biryani', 220, { diet: 'non-veg' }),
      item('p-2', 'Mutton Biryani', 320, { diet: 'non-veg' }),
    ],
  },
  { category_name: 'Drinks', items: [item('p-3', 'Coffee', 40, { diet: 'veg' })] },
];

/**
 * The modify screen, open, with an order being edited.
 *
 * The modal is opened for real rather than the sheet being called on a bare
 * page: the focus trap only exists when the modal is showing, so a test that
 * skips it cannot see the bug it is here for.
 */
async function modifyingAnOrder(page) {
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.goto('/order-history.html');
  await page.waitForFunction(() => typeof openItemPicker === 'function');

  await page.evaluate(() => {
    allOrders=[{_id:'o-1',sales_id:'INV-1',status:'pending',items:[],person_count:2}];
    editOrder('o-1');window.__order=orderBeingModified();
  });
  await expect(page.locator('#editOrderModal')).toBeVisible();
  await page.evaluate(() => openItemPicker());
  await expect(page.locator('#item-picker')).toBeVisible();
}

test('the search box can be typed in while the modal is open', async ({ page }) => {
  /*
   * The whole bug. Focus, not clicks: the box took taps and never the caret,
   * so a waiter pressed it, got a keyboard, and watched nothing arrive.
   */
  await modifyingAnOrder(page);

  const box = page.locator('#picker-search-input');
  await box.click();
  await expect(box).toBeFocused();

  await box.fill('biry');
  await expect(box).toHaveValue('biry');
});

test('typing narrows the menu to what matches', async ({ page }) => {
  await modifyingAnOrder(page);

  await page.locator('#picker-search-input').fill('cb');
  /* ItemSearch ranks initials, so "cb" is Chicken Biryani. */
  await expect(page.locator('#item-picker .dish')).toHaveCount(1);
  await expect(page.locator('#item-picker .dish')).toContainText('Chicken Biryani');

  /* And the rail goes away, because a jump index over a result list is a lie
     about what you are moving through. */
  await expect(page.locator('#item-picker-rail')).toBeHidden();
});

test('clearing the box brings the whole menu back', async ({ page }) => {
  await modifyingAnOrder(page);

  await page.locator('#picker-search-input').fill('cb');
  await expect(page.locator('#item-picker .dish')).toHaveCount(1);

  await page.locator('#picker-search-clear').click();
  await expect(page.locator('#item-picker .dish')).toHaveCount(3);
  await expect(page.locator('#item-picker-rail')).toBeVisible();
});

test('ADD becomes a counter, not the word "Added"', async ({ page }) => {
  /*
   * Owner: "it supposed + and - number as other add screen intial one."
   * The count IS the feedback, and it is the same thing the ordering screen
   * shows - so nobody has to learn this screen separately.
   */
  await modifyingAnOrder(page);

  const row = page.locator('#item-picker .dish[data-id="p-1"]');
  await row.locator('.btn-add').click();

  await expect(row.locator('.dish-step')).toBeVisible();
  await expect(row.locator('.dish-qty')).toHaveText('1');
  await expect(row.locator('.btn-add')).toHaveCount(0);
  await expect(row).not.toContainText('Added');
});

test('+ counts up and the order agrees', async ({ page }) => {
  await modifyingAnOrder(page);

  const row = page.locator('#item-picker .dish[data-id="p-1"]');
  await row.locator('.btn-add').click();
  await row.locator('.btn-increase').click();
  await row.locator('.btn-increase').click();

  await expect(row.locator('.dish-qty')).toHaveText('3');
  /* And the order itself agrees - the row is a view of it, not a counter of
     its own. */
  expect(
    await page.evaluate(() => window.__order.items.find((i) => i.product_id === 'p-1').quantity)
  ).toBe(3);
});

test('- counts down without leaving the menu', async ({ page }) => {
  /*
   * A waiter who taps once too often should not have to close the menu, find
   * the line on the order behind it, and take one off there.
   */
  await modifyingAnOrder(page);

  const row = page.locator('#item-picker .dish[data-id="p-1"]');
  await row.locator('.btn-add').click();
  await row.locator('.btn-increase').click();
  await expect(row.locator('.dish-qty')).toHaveText('2');

  await row.locator('.btn-decrease').click();
  await expect(row.locator('.dish-qty')).toHaveText('1');
  expect(
    await page.evaluate(() => window.__order.items.find((i) => i.product_id === 'p-1').quantity)
  ).toBe(1);
});

test('unsent additions retain their counter when the picker is reopened',async({page})=>{
 await modifyingAnOrder(page);
 await page.locator('#item-picker .dish[data-id="p-1"] .btn-add').click();
 await page.locator('#item-picker .dish[data-id="p-1"] .btn-increase').click();
 await page.locator('#item-picker-done').click();
 await page.locator('#open-item-picker').click();
 const rows=page.locator('#item-picker .dish[data-id="p-1"]');
 await expect(rows).not.toHaveCount(0);
 const counts=await rows.locator('.dish-qty').allTextContents();
 expect(counts.length).toBeGreaterThan(0);expect(counts.every(text=>text==='2')).toBe(true);
 await expect(rows.locator('.btn-add')).toHaveCount(0);
});

test('a counted dish stays counted after a search and back', async ({ page }) => {
  /* The count comes from the order, not from the row, so it survives a redraw
     - which is the only reason searching does not lose it. */
  await modifyingAnOrder(page);

  /* `.first()` throughout: a dish can be on this screen twice now, in a
     shortcut strip and in its category, and they are kept in step. */
  await page.locator('#item-picker .dish[data-id="p-1"] .btn-add').first().click();
  await page.locator('#picker-search-input').fill('chicken');
  await expect(page.locator('#item-picker .dish[data-id="p-1"] .dish-qty').first()).toHaveText('1');

  await page.locator('#picker-search-clear').click();
  const back = await page
    .locator('#item-picker .dish[data-id="p-1"] .dish-qty')
    .allTextContents();
  expect(back.every((said) => said === '1')).toBe(true);
});

test('a dish already on the order shows its count in a SEARCH RESULT', async ({ page }) => {
  /*
   * Owner: "how about if existing item searched and try to add?"
   *
   * The case that would have been missed. A search result is drawn from the
   * flat list, not from the sections, so if the count came from the row rather
   * than from the order a searched dish would come back as ADD - and tapping
   * it would look like adding the first one while actually adding a third.
   */
  await modifyingAnOrder(page);

  const row = page.locator('#item-picker .dish[data-id="p-1"]');
  await row.locator('.btn-add').click();
  await row.locator('.btn-increase').click();
  await expect(row.locator('.dish-qty')).toHaveText('2');

  await page.locator('#picker-search-input').fill('cb');
  const found = page.locator('#item-picker .dish[data-id="p-1"]');
  await expect(found.locator('.dish-qty')).toHaveText('2');
  await expect(found.locator('.btn-add')).toHaveCount(0);
});

test('adding from a search result counts on, it does not start again', async ({ page }) => {
  await modifyingAnOrder(page);

  await page.locator('#item-picker .dish[data-id="p-1"] .btn-add').click();
  await page.locator('#picker-search-input').fill('cb');

  const found = page.locator('#item-picker .dish[data-id="p-1"]');
  await found.locator('.btn-increase').click();
  await expect(found.locator('.dish-qty')).toHaveText('2');

  /* And the order says two, not two separate lines of one. */
  const lines = await page.evaluate(() =>
    window.__order.items.filter((i) => i.product_id === 'p-1')
  );
  expect(lines).toHaveLength(1);
  expect(lines[0].quantity).toBe(2);
});

test('- works inside a search result too', async ({ page }) => {
  await modifyingAnOrder(page);

  await page.locator('#item-picker .dish[data-id="p-1"] .btn-add').click();
  await page.locator('#item-picker .dish[data-id="p-1"] .btn-increase').click();
  await page.locator('#picker-search-input').fill('cb');

  const found = page.locator('#item-picker .dish[data-id="p-1"]');
  await found.locator('.btn-decrease').click();
  await expect(found.locator('.dish-qty')).toHaveText('1');
  expect(
    await page.evaluate(() => window.__order.items.find((i) => i.product_id === 'p-1').quantity)
  ).toBe(1);
});

test('taking the last one off turns the row back into ADD', async ({ page }) => {
  /* The other end of the same behaviour: a line removed entirely must not
     leave a counter showing zero. */
  await modifyingAnOrder(page);

  const row = page.locator('#item-picker .dish[data-id="p-1"]');
  await row.locator('.btn-add').click();
  await expect(row.locator('.dish-qty')).toHaveText('1');

  await row.locator('.btn-decrease').click();
  await expect(row.locator('.btn-add')).toHaveCount(1);
  await expect(row.locator('.dish-qty')).toHaveCount(0);
});

test('the MENU button opens every category with its count', async ({ page }) => {
  await modifyingAnOrder(page);

  await page.locator('#picker-index-btn').click();
  const rows = page.locator('#picker-index-list .menu-index-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Biryani');
  await expect(rows.first()).toContainText('2');
});
