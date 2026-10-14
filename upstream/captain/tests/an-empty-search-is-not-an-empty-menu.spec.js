import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';

/*
 * AN EMPTY SEARCH IS NOT AN EMPTY MENU.
 *
 * Owner: "how to make ux of searching best while add item? when user goes to
 * search show recent items? or show top selling or signature items? i want
 * some big options behind search... any other ways to reach the items."
 *
 * Opening the sheet showed the whole card from the top - the one thing a
 * waiter already knows how to do, and the slowest way to reach anything. There
 * are three faster answers available before a single letter is typed, and
 * between them they cover most of what a second round actually is:
 *
 *   On this table     another of what the table already has: one tap
 *   You added lately  what this handset has been selling all shift
 *   Selling today     the shop's own best sellers, already fetched
 *
 * The whole menu still follows underneath. This is a shortcut, not a
 * replacement: taking the long way round away from somebody who wants to read
 * the card would be a worse screen, not a better one.
 */

const MENU = [
  {
    category_name: 'Starters',
    items: [item('p-65', 'Chicken 65', 180), item('p-gobi', 'Gobi Manchurian', 160)],
  },
  {
    category_name: 'Mains',
    items: [
      item('p-cb', 'Chicken Biryani', 220),
      item('p-mb', 'Mutton Biryani', 320),
      item('p-naan', 'Butter Naan', 40),
    ],
  },
  { category_name: 'Drinks', items: [item('p-water', 'Water', 20)] },
];

/** The add-item sheet, over an order that already has something on it. */
async function atThePicker(page, { onOrder = [], recent = [], popular = [] } = {}) {
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.goto('/order-history.html');
  await page.waitForFunction(() => typeof openItemPicker === 'function');

  await page.evaluate(
    ({ onOrder, recent, popular }) => {
      localStorage.setItem('posnic.recent_items', JSON.stringify(recent));
      window._frequentItemIds = new Set(popular);

      /*
       * Through the app's own setter, not by replacing the getter. The order
       * is a script-scoped binding; a stubbed getter returns an object the app
       * never writes to, so anything ADDED during the test lands somewhere the
       * screen cannot see and every row stays on ADD for ever.
       */
      window.setOrderBeingModified({
        items: onOrder.map((id) => ({ product_id: id, name: id, price: 20, quantity: 1 })),
      });
      window.OrderEditor.begin();
      new window.bootstrap.Modal(document.getElementById('editOrderModal')).show();
    },
    { onOrder, recent, popular }
  );

  await page.evaluate(() => openItemPicker());
  await expect(page.locator('#item-picker .dish').first()).toBeVisible();
}

const headings = (page) =>
  page.locator('#item-picker-body .menu-section-name').allTextContents();

test('the three fast answers come before the card', async ({ page }) => {
  await atThePicker(page, {
    onOrder: ['p-water'],
    recent: ['p-cb', 'p-naan'],
    popular: ['p-65'],
  });

  const said = await headings(page);
  expect(said.slice(0, 3)).toEqual(['On this table', 'You added lately', 'Selling today']);

  /* And the whole menu still follows, untouched. */
  expect(said).toContain('Starters');
  expect(said).toContain('Mains');
  expect(said).toContain('Drinks');
});

test('a strip with nothing to say is not drawn', async ({ page }) => {
  /*
   * A strip that is sometimes there and sometimes not teaches a waiter to
   * ignore the top of the screen. An empty one is worse than none.
   */
  await atThePicker(page, { onOrder: [], recent: [], popular: [] });

  const said = await headings(page);
  expect(said).not.toContain('On this table');
  expect(said).not.toContain('You added lately');
  expect(said).not.toContain('Selling today');
  expect(said[0]).toBe('Starters');
});

test('a dish is offered once, by the closest reason', async ({ page }) => {
  /*
   * Three copies of one row is a screen that looks full and says little. A
   * dish already on the table is not also offered as recent and as popular.
   */
  await atThePicker(page, {
    onOrder: ['p-cb'],
    recent: ['p-cb', 'p-naan'],
    popular: ['p-cb', 'p-65'],
  });

  const inStrips = async (key) =>
    page.locator(`#item-picker-body [id="sec-${key}"] .dish`).evaluateAll((rows) =>
      rows.map((row) => row.getAttribute('data-id'))
    );

  expect(await inStrips('on-table')).toEqual(['p-cb']);
  expect(await inStrips('recent')).toEqual(['p-naan']);
  expect(await inStrips('selling')).toEqual(['p-65']);
});

test('what this handset adds becomes what it offers next time', async ({ page }) => {
  await atThePicker(page, { onOrder: [], recent: [], popular: [] });

  await page.locator('#item-picker .dish[data-id="p-naan"] .btn-add').first().click();

  const kept = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('posnic.recent_items') || '[]')
  );
  expect(kept[0]).toBe('p-naan');
});

test('the same dish is never remembered twice, and the list does not grow for ever', async ({
  page,
}) => {
  await atThePicker(page, { onOrder: [], recent: [], popular: [] });

  const kept = await page.evaluate(() => {
    for (let i = 0; i < 12; i += 1) rememberRecent('p-' + (i % 3));
    rememberRecent('p-0');
    return JSON.parse(localStorage.getItem('posnic.recent_items') || '[]');
  });

  /* Most recent first, each dish once, and bounded. */
  expect(kept[0]).toBe('p-0');
  expect(new Set(kept).size).toBe(kept.length);
  expect(kept.length).toBeLessThanOrEqual(8);
});

test('a strip row is a real row: number, count and all', async ({ page }) => {
  /*
   * The strips are drawn by the same MenuView as the menu, so a shortcut is
   * not a second kind of row that behaves almost the same. That is what stops
   * the two drifting apart.
   */
  await atThePicker(page, { onOrder: ['p-cb'], recent: [], popular: [] });

  const row = page.locator('#item-picker-body [id="sec-on-table"] .dish[data-id="p-cb"]');
  await expect(row.locator('.dish-no')).toHaveText('3');
  await expect(row.locator('.picker-previous-count')).toHaveText('Already ordered: 1');
  await expect(row.locator('.btn-add')).toBeVisible();
  await row.locator('.btn-add').click();
  await expect(row.locator('.dish-qty')).toHaveText('1');
  await expect(row.locator('.picker-previous-count')).toHaveText('Already ordered: 1');
});

test('both copies of a dish agree after a tap', async ({ page }) => {
  /*
   * A dish can be on the screen twice: in a strip and in its category. A
   * shortcut still saying ADD for something already on the order is the exact
   * confusion the counter was put there to end.
   */
  await atThePicker(page, { onOrder: [], recent: ['p-cb'], popular: [] });

  await page.locator('#item-picker .dish[data-id="p-cb"] .btn-add').first().click();

  await expect(page.locator('#item-picker .dish[data-id="p-cb"] .dish-qty')).toHaveText(['1', '1']);
});

test('typing still searches the whole menu, not the strips', async ({ page }) => {
  /* The shortcuts are for an empty box. The moment somebody types, the
     question changed and the answer is the search. */
  await atThePicker(page, { onOrder: ['p-water'], recent: ['p-naan'], popular: [] });

  await page.locator('#picker-search-input').fill('biry');

  /* The box is debounced, so the screen still shows the empty state for a
     moment after typing. Waiting for the result is the test doing what a
     waiter does, rather than reading the screen mid-keystroke. */
  await expect(page.locator('#item-picker-body .menu-section-name').first()).toContainText(/match/);

  const said = await headings(page);
  expect(said).not.toContain('On this table');
});
