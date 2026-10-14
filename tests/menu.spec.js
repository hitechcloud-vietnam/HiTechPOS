import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';

/*
 * The menu, in a real browser.
 *
 * menu-view.test.js checks what the rows SAY. This checks what the screen
 * DOES, which is the part that changed: one continuous scroll instead of a
 * list that was replaced on every category tap, a rail that reports where you
 * are instead of filtering, and a place in the menu that survives adding
 * something to the bill.
 *
 * None of that can be tested without a layout. A section is "the one you are
 * reading" only relative to a viewport, and whether adding a dish cost you
 * your place is a question about scroll position.
 */

const MENU = [
  {
    category_name: 'Biryani',
    items: [
      item('p-1', 'Chicken Biryani', 220, { description: 'Long grain rice, slow cooked', diet: 'non-veg' }),
      item('p-2', 'Mutton Biryani', 280, { diet: 'non-veg' }),
      item('p-3', 'Veg Biryani', 180, { diet: 'veg', prep_minutes: 20 }),
    ],
  },
  {
    category_name: 'Starters',
    items: [
      item('p-4', 'Chicken 65', 190, { diet: 'non-veg' }),
      item('p-5', 'Gobi Manchurian', 150, { diet: 'veg' }),
    ],
  },
  {
    category_name: 'Drinks',
    items: [
      item('p-6', 'Coffee', 40, { diet: 'veg' }),
      item('p-7', 'Fresh Lime Soda', 60, { diet: 'veg' }),
      item('p-8', 'Mango Lassi', 80, { diet: 'veg', available_quantity: 0 }),
    ],
  },
];

const atTheMenu = (page) => onTheMenu(page, 'two chicken biryani', { menu: MENU });

/* --------------------------------------------------------- one long menu */

test('the whole menu is on the page at once, in sections', async ({ page }) => {
  /*
   * THE CHANGE. The old screen drew ONE category and swapped the whole list
   * when a chip was tapped. A table orders across categories - a biryani, a
   * Coke, a gulab jamun - so every third item cost a tap back up to the rail,
   * a rebuilt list, and the scroll position gone.
   */
  await atTheMenu(page);

  await expect(page.locator('.menu-section')).toHaveCount(3);
  await expect(page.locator('.dish')).toHaveCount(8);

  for (const name of ['Biryani', 'Starters', 'Drinks']) {
    await expect(page.locator('.menu-section-name', { hasText: name })).toHaveCount(1);
  }
});

test('a section says how many are in it', async ({ page }) => {
  /* So nobody scrolls a section to find out it holds two. */
  await atTheMenu(page);
  const drinks = page.locator('#sec-drinks');
  await expect(drinks.locator('.menu-section-count')).toHaveText('3');
});

test('the "all" bucket is not drawn as a section of its own', async ({ page }) => {
  /* It is built for search and the voice matcher. Drawing it would put every
     dish on the menu a second time. */
  await atTheMenu(page);
  await expect(page.locator('#sec-all')).toHaveCount(0);
  await expect(page.getByText('Chicken Biryani', { exact: true })).toHaveCount(1);
});

/* ------------------------------------------------------------- the rail */

test('the rail is a jump index, not a filter', async ({ page }) => {
  await atTheMenu(page);

  await page.locator('.menu-chip', { hasText: 'Drinks' }).click();
  await expect(page.locator('#sec-drinks')).toBeInViewport();

  /* The whole menu is STILL there. That is the difference between jumping and
     filtering, and it is the entire point of the change. */
  await expect(page.locator('.dish')).toHaveCount(8);
  await expect(page.locator('.menu-section')).toHaveCount(3);
});

test('scrolling lights the chip for where you are', async ({ page }) => {
  await atTheMenu(page);

  /* Starts on the first section. */
  await expect(page.locator('.menu-chip.is-here')).toHaveText('Biryani');

  await page.locator('.menu-chip', { hasText: 'Drinks' }).click();
  await expect(page.locator('.menu-chip.is-here')).toHaveText('Drinks');

  /* Exactly one. A rail with two lit chips has told you nothing. */
  await expect(page.locator('.menu-chip.is-here')).toHaveCount(1);
});

test('a section heading stays put while you are under it', async ({ page }) => {
  /* Somebody eight dishes into Biryani should not have to scroll back up to
     find out that is where they are. */
  await atTheMenu(page);
  await page.locator('.menu-chip', { hasText: 'Starters' }).click();
  await expect(page.locator('#sec-starters .menu-section-head')).toBeInViewport();
});

/* ------------------------------------------------------------ the rows */

test('a dish shows what the server has been sending all along', async ({ page }) => {
  /*
   * The description, the veg mark and the kitchen's timing have been in the
   * menu response for months. The grid of photo cards had nowhere to put any
   * of them, so none of them were ever seen.
   */
  await atTheMenu(page);
  const biryani = page.locator('.dish[data-id="p-1"]');

  await expect(biryani.locator('.dish-name')).toHaveText('Chicken Biryani');
  await expect(biryani.locator('.dish-note')).toHaveText('Long grain rice, slow cooked');
  await expect(biryani.locator('.dish-diet.is-nonveg')).toHaveCount(1);

  await expect(page.locator('.dish[data-id="p-3"] .dish-prep')).toContainText('20 min');
});

test('a chicken dish is not marked vegetarian', async ({ page }) => {
  /*
   * "non-veg" contains "veg", so a check for veg that runs first marks every
   * chicken dish on the menu green. That is not a cosmetic bug - it is the app
   * telling somebody their food is vegetarian.
   */
  await atTheMenu(page);
  await expect(page.locator('.dish[data-id="p-1"] .dish-diet.is-veg')).toHaveCount(0);
  await expect(page.locator('.dish[data-id="p-5"] .dish-diet.is-veg')).toHaveCount(1);
});

test('a dish with no photograph gets its icon, not a broken image', async ({ page }) => {
  /* Most shops have uploaded no pictures and never will. Forty grey
     placeholders look like an app that failed to load. */
  await atTheMenu(page);
  await expect(page.locator('.dish[data-id="p-1"] .dish-icon')).toHaveCount(1);
  await expect(page.locator('.dish[data-id="p-1"] img')).toHaveCount(0);
});

test('sold out is dimmed and named, not hidden', async ({ page }) => {
  /* A waiter has to be able to TELL the table it is off. A dish that has
     silently vanished cannot be talked about. */
  await atTheMenu(page);
  const lassi = page.locator('.dish[data-id="p-8"]');
  await expect(lassi).toHaveClass(/is-out/);
  await expect(lassi).toContainText('Sold out');
  await expect(lassi.locator('.dish-add')).toHaveCount(0);
});

test('sold out sinks within its section, and stays in it', async ({ page }) => {
  await atTheMenu(page);
  const names = await page.locator('#sec-drinks .dish-name').allTextContents();
  assertOrder(names, ['Coffee', 'Fresh Lime Soda', 'Mango Lassi']);
});

function assertOrder(actual, expected) {
  expect(actual).toEqual(expected);
}

/* ----------------------------------------------------------- adding one */

test('adding a dish does not cost you your place in the menu', async ({ page }) => {
  /*
   * THE REASON THE ROW IS PATCHED RATHER THAN THE MENU REDRAWN. Somebody
   * halfway down a long menu who adds a dish and is returned to the top has
   * lost their place for no reason they can see - and on this screen their
   * place is most of the screen.
   */
  await atTheMenu(page);
  await page.locator('.menu-chip', { hasText: 'Drinks' }).click();
  await page.waitForTimeout(700); // the smooth scroll lands

  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);

  await page.locator('.dish[data-id="p-6"] .dish-add').click();
  await expect(page.locator('.dish[data-id="p-6"] .dish-qty')).toHaveText('1');

  const after = await page.evaluate(() => window.scrollY);
  expect(Math.abs(after - before)).toBeLessThan(8);
});

test('ADD becomes a stepper that counts up and back down', async ({ page }) => {
  await atTheMenu(page);
  const row = page.locator('.dish[data-id="p-1"]');

  await row.locator('.dish-add').click();
  await expect(row.locator('.dish-qty')).toHaveText('1');

  await row.locator('.btn-increase').click();
  await expect(row.locator('.dish-qty')).toHaveText('2');

  await row.locator('.btn-decrease').click();
  await expect(row.locator('.dish-qty')).toHaveText('1');

  await row.locator('.btn-decrease').click();
  await expect(row.locator('.dish-add')).toBeVisible();
});

test('the row does not change height when it is added to', async ({ page }) => {
  /* A list that reflows under a thumb is a list that gets the wrong thing
     tapped. ADD and the stepper are deliberately the same size. */
  await atTheMenu(page);
  const row = page.locator('.dish[data-id="p-1"]');

  const before = (await row.boundingBox()).height;
  await row.locator('.dish-add').click();
  await expect(row.locator('.dish-qty')).toHaveText('1');
  const after = (await row.boundingBox()).height;

  expect(Math.abs(after - before)).toBeLessThan(2);
});

/* -------------------------------------------------------- the bill bar */

test('the bill bar stays down until there is a bill', async ({ page }) => {
  /*
   * A bar saying "0 items - ₹0.00 - View bill" spends a strip of a small
   * screen saying nothing, and teaches people to ignore the place the total
   * will eventually appear.
   */
  await atTheMenu(page);
  await expect(page.locator('#bill-bar')).not.toHaveClass(/is-up/);

  await page.locator('.dish[data-id="p-1"] .dish-add').click();
  await expect(page.locator('#bill-bar')).toHaveClass(/is-up/);
  await expect(page.locator('#bill-count')).toHaveText('1 item');
  await expect(page.locator('#bill-total')).toHaveText('₹220.00');
});

test('the bill bar counts what is on it', async ({ page }) => {
  await atTheMenu(page);
  await page.locator('.dish[data-id="p-1"] .dish-add').click();
  await page.locator('.dish[data-id="p-6"] .dish-add').click();

  await expect(page.locator('#bill-count')).toHaveText('2 items');
  await expect(page.locator('#bill-total')).toHaveText('₹260.00');
});

/* ------------------------------------------------------- the whole index */

test('the MENU button opens every category with counts', async ({ page }) => {
  /* The rail is fine for six categories and useless for twenty-five, where the
     one you want is always off the right-hand edge. */
  await atTheMenu(page);

  await page.locator('#menu-index-btn').click();
  const rows = page.locator('.menu-index-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText('Drinks');
  await expect(rows.nth(2)).toContainText('3');
});

test('choosing from the index closes it and goes there', async ({ page }) => {
  await atTheMenu(page);

  await page.locator('#menu-index-btn').click();
  await page.locator('.menu-index-row', { hasText: 'Drinks' }).click();

  await expect(page.locator('#menu-index')).toBeHidden();
  await expect(page.locator('#sec-drinks')).toBeInViewport();
});

test('one category is not an index, so there is no button for it', async ({ page }) => {
  /* A button that scrolls to where you already are. */
  await onTheMenu(page, 'coffee', {
    menu: [{ category_name: 'Food', items: [item('p-1', 'Coffee', 40)] }],
  });
  await expect(page.locator('#menu-index-btn')).toBeHidden();
});

/* ------------------------------------------------------------ searching */

test('a search shows results, not sections', async ({ page }) => {
  /*
   * The menu is sectioned because somebody browsing it is looking for a KIND
   * of thing. Somebody who has typed four letters is looking for ONE thing,
   * and a heading over each result buries the best match under a category.
   */
  await atTheMenu(page);
  await page.locator('#product-search-input').fill('biry');

  await expect(page.locator('.menu-section-head')).toHaveCount(0);
  await expect(page.locator('.dish')).toHaveCount(3);
  await expect(page.locator('.fixed-categories')).toBeHidden();
});

test('clearing the search gives the whole menu back', async ({ page }) => {
  await atTheMenu(page);
  await page.locator('#product-search-input').fill('biry');
  await expect(page.locator('.dish')).toHaveCount(3);

  await page.locator('#product-search-clear').click();
  await expect(page.locator('.dish')).toHaveCount(8);
  await expect(page.locator('.menu-section')).toHaveCount(3);
});

test('what was already added survives a search and comes back', async ({ page }) => {
  await atTheMenu(page);
  await page.locator('.dish[data-id="p-1"] .dish-add').click();

  await page.locator('#product-search-input').fill('biry');
  await expect(page.locator('.dish[data-id="p-1"] .dish-qty')).toHaveText('1');

  await page.locator('#product-search-clear').click();
  await expect(page.locator('.dish[data-id="p-1"] .dish-qty')).toHaveText('1');
  await expect(page.locator('#bill-count')).toHaveText('1 item');
});

test('the initials of a dish find it', async ({ page }) => {
  /* "cb" is what somebody selling two hundred a day actually types, and it is
     not a substring of anything. */
  await atTheMenu(page);
  await page.locator('#product-search-input').fill('cb');
  await expect(page.locator('.dish').first().locator('.dish-name')).toHaveText('Chicken Biryani');
});

test('a quantity typed in front of it carries into the add', async ({ page }) => {
  /* "2 cb" is two Chicken Biryani. Dropping the space is PR #36, and its own
     tests live with it - this one pins that the quantity reaches the button
     at all, which is the part the new rows had to keep working. */
  await atTheMenu(page);
  await page.locator('#product-search-input').fill('2 cb');

  const first = page.locator('.dish').first();
  await expect(first.locator('.dish-name')).toHaveText('Chicken Biryani');
  await first.locator('.dish-add').click();
  await expect(first.locator('.dish-qty')).toHaveText('2');
});

/* ------------------------------------------------------------ it responds */

test('the row answers where the finger was', async ({ page }) => {
  /*
   * Adding a dish changed a button into a stepper and a number at the bottom
   * of the screen, both instantly and both silently. Correct, and inert: the
   * eye is on the row that was touched and the confirmation is 600px away, so
   * "did that register?" gets asked by pressing again - and now there are two.
   */
  await atTheMenu(page);
  const row = page.locator('.dish[data-id="p-1"]');

  await row.locator('.dish-add').click();
  await expect(row).toHaveClass(/is-taking/);
  await expect(row.locator('.dish-step')).toBeVisible();

  /* And it lets go again, rather than staying lit. */
  await expect(row).not.toHaveClass(/is-taking/, { timeout: 2000 });
});

test('the count itself moves when the stepper is already there', async ({ page }) => {
  /* The second and third taps on the same dish are the ones somebody is least
     sure registered, and nothing new arrives on those to be noticed. */
  await atTheMenu(page);
  const row = page.locator('.dish[data-id="p-1"]');
  await row.locator('.dish-add').click();
  await expect(row.locator('.dish-qty')).toHaveText('1');

  await row.locator('.btn-increase').click();
  await expect(row.locator('.dish-qty')).toHaveClass(/is-bumped/);
  await expect(row.locator('.dish-qty')).toHaveText('2');
});

test('the bill bar nudges when the total moves, and not when it does not', async ({ page }) => {
  /*
   * updateCart runs on every render, including ones that change nothing. A bar
   * that jumps when nothing happened is worse than one that never jumps,
   * because it stops meaning anything.
   */
  await atTheMenu(page);
  await page.locator('.dish[data-id="p-1"] .dish-add').click();
  await expect(page.locator('#bill-bar')).toHaveClass(/is-bumped/);
  await expect(page.locator('#bill-bar')).not.toHaveClass(/is-bumped/, { timeout: 2000 });

  /* A redraw that changes no total leaves it alone. */
  await page.evaluate(() => updateCart());
  await expect(page.locator('#bill-bar')).not.toHaveClass(/is-bumped/);
});

test('nothing moves for somebody who asked their phone to stop', async ({ page, browser }) => {
  /* prefers-reduced-motion is an accessibility setting, not a preference to
     be overridden by a design somebody liked. */
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const quiet = await context.newPage();
  await onTheMenu(quiet, 'two chicken biryani', { menu: MENU });

  const moving = await quiet.evaluate(() => {
    const row = document.querySelector('.dish');
    row.classList.add('is-taking');
    const name = getComputedStyle(row).animationName;
    row.classList.remove('is-taking');
    return name;
  });
  expect(moving).toBe('none');
  await context.close();
});
