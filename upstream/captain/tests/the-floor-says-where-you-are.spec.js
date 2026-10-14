import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';

/*
 * THE FLOOR HAS TO LOOK LIKE SOMEWHERE YOU MEANT TO ARRIVE.
 *
 * Owner, relaying a client: "due to empty stuff, he try to go back and close
 * the app. i tink he dont have feeling he is in main page dashboard."
 *
 * On a quiet morning the screen was the word "Tables" over an empty box.
 * Nothing named the shop, greeted anybody, or suggested this was the
 * destination - so it read as a screen that had failed to load, and the way
 * out of one of those is the back button. Which is what he pressed.
 */

const MENU = [
  { category_name: 'Biryani', items: [item('p-1', 'Chicken Biryani', 220, { diet: 'non-veg' })] },
];

const atTheFloor = async (page) => {
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.goto('/kot-management.html');
  await page.waitForFunction(() => typeof sayWhereWeAre === 'function');
};

test('it greets, and the greeting fits the hour', async ({ page }) => {
  await atTheFloor(page);
  await expect(page.locator('#floor-hello')).toHaveText(/Good (morning|afternoon|evening)/);
});

test('the heading is the shop, not the word "Tables"', async ({ page }) => {
  /*
   * A handset can be pointed at any till in the estate and this screen was
   * answering "which one" nowhere at all.
   */
  await atTheFloor(page);
  await expect(page.locator('#floor-shop')).toHaveText('Main Branch');
});

test('a handset with no branch list still says something', async ({ page }) => {
  /* Mid-setup, or a list that failed to parse. An empty heading reopens the
     hole this was written to close. */
  await atTheFloor(page);
  await page.evaluate(() => {
    localStorage.removeItem('kiosk_branch_list');
    sayWhereWeAre();
  });
  await expect(page.locator('#floor-shop')).toHaveText('Your shop');
});

test('the grid of boxes says what it is a grid of', async ({ page }) => {
  /* Owner: "when you show table mention text like active order or active
     tables or some suitable name." */
  await atTheFloor(page);
  await expect(page.locator('.floor-section-name')).toHaveText('Orders');
  await expect(page.locator('[data-floor-filter="active"]')).toHaveAttribute('aria-pressed', 'true');
});

test('the count does not say "tables" twice', async ({ page }) => {
  /* It sits beside a heading that already says it. */
  await atTheFloor(page);
  const said = await page.locator('#floor-count').textContent();
  expect(said || '').not.toMatch(/tables?\b/i);
});

test('a long shop name shortens rather than shoving the buttons off', async ({ page }) => {
  await atTheFloor(page);
  await page.evaluate(() => {
    document.getElementById('floor-shop').textContent =
      'The Very Long Restaurant And Catering Company Limited, Branch Number Four';
  });

  const head = await page.locator('.floor-head').boundingBox();
  const connection = await page.locator('.floor-head .route-signal').last().boundingBox();
  expect(connection.x + connection.width).toBeLessThanOrEqual(head.x + head.width + 1);
});
