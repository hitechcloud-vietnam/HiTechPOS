import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';

/*
 * A KITCHEN TICKET IS NOT A MENU.
 *
 * Owner, holding a printed ticket: "why some details printed in KOT? actually
 * those are item details. not notes."
 *
 * The ticket read:
 *
 *   MIXED TANDOORI CHICKEN PLATTER                                  x1
 *     ** A platter of the tandoor's chicken: kebabs, tikka and wings,
 *     served sizzling with onion and lime. Built to share. **
 *
 * That is writing for a guest choosing dinner. A cook needs "no onion".
 *
 * It was not the printer and it was not data entry: the menu loader seeded
 * item_description - which is the NOTE field everywhere else in this app, the
 * one the till stores a waiter's words in - with the dish's own description,
 * and called it a default note. So every dish arrived carrying sales copy as a
 * note, and everything downstream faithfully printed it.
 *
 * A ticket that long for two dishes is one a cook stops reading, which is how
 * the one line that mattered gets missed.
 */

const DESCRIBED = item('p-platter', 'Mixed Tandoori Chicken Platter', 850, {
  description:
    "A platter of the tandoor's chicken: kebabs, tikka and wings, served sizzling with onion and lime. Built to share.",
});

const MENU = [{ category_name: 'Tandoor', items: [DESCRIBED] }];

/** The order this phone would send for what is in the cart. */
async function whatWouldBeSent(page) {
  let sent = null;
  await page.route('**/sales/qrOrder', (route) => {
    sent = route.request().postDataJSON();
    route.fulfill({ json: { type: 'success', message: 'ok', data: { order_id: 'o1' } } });
  });

  await page.goto('/cart.html');
  await page.locator('#next-btn').click();
  await expect.poll(() => sent).not.toBeNull();
  return sent;
}

test('THE DISH DESCRIPTION IS NOT SENT AS A NOTE', async ({ page }) => {
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.locator('.dish[data-id="p-platter"] .dish-add').click();

  const sent = await whatWouldBeSent(page);
  const line = sent.items.find((one) => one.item_id === 'p-platter');

  expect(line.item_description).toBe('');
  expect(JSON.stringify(sent)).not.toContain('Built to share');
});

test('what the waiter types IS sent, because that is what a note is', async ({ page }) => {
  /*
   * The fix must not take the notes box with it. A kitchen that stops being
   * told "no onion" is a worse outcome than one told too much.
   */
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.locator('.dish[data-id="p-platter"] .dish-add').click();

  await page.evaluate(async () => {
    const cart = await getCartData();
    const line = cart.find((one) => one.id === 'p-platter');
    line.notes = 'No onion';
    await saveData(CART_STORE, [line]);
  });

  const sent = await whatWouldBeSent(page);
  const line = sent.items.find((one) => one.item_id === 'p-platter');

  expect(line.item_description).toBe('No onion');
});

test('a dish added to an order already open carries no menu copy either', async ({ page }) => {
  /*
   * The other door into a kitchen ticket. linesForSave spreads the whole menu
   * row into the line it sends, so anything the loader put on a dish travels
   * with it - which is how a field meant for a waiter's words ends up holding
   * a paragraph nobody typed.
   */
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.goto('/order-history.html');
  await page.waitForFunction(() => typeof linesForSave === 'function');

  const lines = await page.evaluate(async () => {
    const dish = await getProductById('p-platter');
    return linesForSave([{ ...dish, quantity: 1 }]);
  });

  expect(lines).toHaveLength(1);
  expect(lines[0].item_description || '').toBe('');
});

test('the dish still describes itself where a waiter is choosing it', async ({ page }) => {
  /*
   * The description was not deleted, only stopped from pretending to be a
   * note. A waiter reading the card still needs to know what is on the
   * platter.
   */
  await onTheMenu(page, 'nothing', { menu: MENU });

  const kept = await page.evaluate(async () => {
    const dish = await getProductById('p-platter');
    return dish.description;
  });

  expect(kept).toContain('Built to share');
});
