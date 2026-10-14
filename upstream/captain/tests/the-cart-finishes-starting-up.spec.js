import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';

/*
 * A SCREEN THAT STOPS ON ITS FIRST LINE STILL LOOKS FINE.
 *
 * products/script.js is shared: the menu screen loads it, and so do the cart
 * and the discount screen, for the add-item flow the three have in common.
 * Its DOMContentLoaded handler opens with MenuScreen.start(), and MenuScreen
 * comes from products/menu.js, which ONLY the menu screen loads.
 *
 * So since "Make the menu read like a menu" the cart and the discount screen
 * have thrown
 *
 *     ReferenceError: MenuScreen is not defined
 *
 * on the first line of their startup and skipped everything under it:
 * loadProducts, loadFrequentItems, renderRepeatLastOrder, openDB,
 * setKioskImagesFromIndexedDB and every listener below them. The handler is
 * async, so the throw became an unhandled rejection nobody was shown, and the
 * screens went on working on their fallbacks: the cart draws itself from its
 * own store, and getDB() reopens the database on demand for anything that
 * asks. A page can run for months on its fallbacks without looking ill.
 *
 * These test the handler REACHING THE END on a page without the menu rail,
 * rather than testing the guard, because the next line somebody appends to it
 * has to run on all three screens too.
 */

/** Everything the shared startup does after the line that was throwing. */
const startedUp = (page) =>
  page.waitForFunction(() => typeof products === 'object' && Object.keys(products).length > 0, null, {
    timeout: 7000,
  });

test('the cart screen finishes its startup, menu in hand', async ({ page }) => {
  const thrown = [];
  page.on('pageerror', (e) => thrown.push(String(e)));

  await onTheMenu(page, 'nothing');
  await page.goto('/cart.html');

  await startedUp(page);
  expect(thrown.join('\n')).not.toContain('MenuScreen');
});

test('the discount screen finishes its startup too', async ({ page }) => {
  const thrown = [];
  page.on('pageerror', (e) => thrown.push(String(e)));

  await onTheMenu(page, 'nothing');
  await page.goto('/discount.html');

  await startedUp(page);
  expect(thrown.join('\n')).not.toContain('MenuScreen');
});

test('the menu screen still gets its rail, which is what MenuScreen is for', async ({ page }) => {
  /*
   * The guard must not become "the rail is optional everywhere". On the one
   * screen that loads products/menu.js, it still starts.
   */
  await onTheMenu(page, 'nothing');

  expect(await page.evaluate(() => typeof MenuScreen)).toBe('object');
  await expect(page.locator('#category-list')).toBeAttached();
});
