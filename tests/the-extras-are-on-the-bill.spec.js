import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';

/*
 * EXTRA CHEESE THAT SOMEBODY CHARGES FOR.
 *
 * A waiter could not offer the shop's own extras, so they typed "extra cheese"
 * into the notes box. The kitchen made it, the bill said nothing, and the shop
 * gave it away.
 *
 * The till has always had the option sets; the handset could not see them. Now
 * it asks, and sends WHAT was chosen - never what it costs. The till prices
 * them from the shop's own documents, because a client that could name the
 * price of cheese could also name a discount nobody agreed to.
 *
 * So what these hold is: the question gets asked, a required one cannot be
 * skipped, the names travel, and no price does.
 */

const WITH_OPTIONS = item('p-pbm', 'Paneer Butter Masala', 220, {
  modifier_groups: [
    {
      name: 'Extras',
      min: 0,
      max: 2,
      options: [
        { name: 'Extra cheese', price_delta: 20 },
        { name: 'Extra butter', price_delta: 15 },
      ],
    },
    {
      name: 'How spicy',
      min: 1,
      max: 1,
      options: [
        { name: 'Medium', price_delta: 0 },
        { name: 'Extra spicy', price_delta: 5 },
      ],
    },
  ],
});

const PLAIN = item('p-naan', 'Butter Naan', 40);

const MENU = [{ category_name: 'Mains', items: [WITH_OPTIONS, PLAIN] }];

const sheet = (page) => page.locator('#ask-options-scrim');
const option = (page, name) => page.locator(`.ask-options-opt[data-name="${name}"]`);

test('a dish with options asks before it goes on the order', async ({ page }) => {
  await onTheMenu(page, 'nothing', { menu: MENU });

  await page.locator('.dish[data-id="p-pbm"] .dish-add').click();

  await expect(sheet(page)).toBeVisible();
  await expect(page.locator('#ask-options-dish')).toHaveText('Paneer Butter Masala');
});

test('a dish with none is not asked anything', async ({ page }) => {
  /* A sheet with nothing in it is one more tap between a waiter and an order. */
  await onTheMenu(page, 'nothing', { menu: MENU });

  await page.locator('.dish[data-id="p-naan"] .dish-add').click();

  await expect(sheet(page)).toBeHidden();
  await expect(page.locator('.dish[data-id="p-naan"] .dish-qty')).toHaveText('1');
});

test('the price of each option is on it, and the running total is on the button', async ({
  page,
}) => {
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.locator('.dish[data-id="p-pbm"] .dish-add').click();

  await expect(option(page, 'Extra cheese')).toContainText('20');

  await option(page, 'Extra cheese').click();
  await expect(page.locator('#ask-options-go')).toContainText('20');

  await option(page, 'Extra butter').click();
  await expect(page.locator('#ask-options-go')).toContainText('35');
});

test('a question the kitchen needs answered cannot be skipped, and says which', async ({
  page,
}) => {
  /*
   * "How spicy" with min 1 is not a preference, it is something the pass will
   * otherwise have to ask. Named rather than greyed out: a disabled button
   * with no reason on it is a waiter tapping harder.
   */
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.locator('.dish[data-id="p-pbm"] .dish-add').click();

  await page.locator('#ask-options-go').click();

  await expect(page.locator('#ask-options-warn')).toContainText('How spicy');
  await expect(sheet(page)).toBeVisible();
  await expect(page.locator('.dish[data-id="p-pbm"] .dish-qty')).toHaveCount(0);
});

test('a group that takes one answer replaces rather than refusing', async ({ page }) => {
  /* Tapping Extra spicy after Medium means they changed their mind, not that
     they want both and should be told off for it. */
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.locator('.dish[data-id="p-pbm"] .dish-add').click();

  await option(page, 'Medium').click();
  await expect(option(page, 'Medium')).toHaveClass(/is-on/);

  await option(page, 'Extra spicy').click();
  await expect(option(page, 'Extra spicy')).toHaveClass(/is-on/);
  await expect(option(page, 'Medium')).not.toHaveClass(/is-on/);
});

test('backing out leaves the order exactly as it was', async ({ page }) => {
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.locator('.dish[data-id="p-pbm"] .dish-add').click();

  await page.locator('#ask-options-back').click();

  await expect(sheet(page)).toBeHidden();
  await expect(page.locator('.dish[data-id="p-pbm"] .dish-qty')).toHaveCount(0);
});

test('what was chosen is on the line, where a waiter reads it back', async ({ page }) => {
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.locator('.dish[data-id="p-pbm"] .dish-add').click();
  await option(page, 'Extra cheese').click();
  await option(page, 'Medium').click();
  await page.locator('#ask-options-go').click();

  await page.goto('/cart.html');

  await expect(page.locator('.bill-extras').first()).toContainText('Extra cheese');
  await expect(page.locator('.bill-extras').first()).toContainText('Medium');
});

test('the order carries the NAMES and no price at all', async ({ page }) => {
  /*
   * The heart of it. The till prices these from the shop's own option
   * documents; a phone that sent a price would be a phone that could send a
   * discount.
   */
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.locator('.dish[data-id="p-pbm"] .dish-add').click();
  await option(page, 'Extra cheese').click();
  await option(page, 'Medium').click();
  await page.locator('#ask-options-go').click();

  let sent = null;
  await page.route('**/sales/qrOrder', (route) => {
    sent = route.request().postDataJSON();
    route.fulfill({ json: { type: 'success', message: 'ok', data: { order_id: 'o1' } } });
  });

  await page.goto('/cart.html');
  await page.locator('#next-btn').click();

  await expect.poll(() => sent).not.toBeNull();

  const line = sent.items.find((one) => one.item_id === 'p-pbm');
  expect(line.modifiers).toEqual([
    { group: 'Extras', name: 'Extra cheese' },
    { group: 'How spicy', name: 'Medium' },
  ]);
  for (const chosen of line.modifiers) {
    expect(chosen.price_delta).toBeUndefined();
  }
});

test('an ordinary dish sends exactly what it always did', async ({ page }) => {
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.locator('.dish[data-id="p-naan"] .dish-add').click();

  let sent = null;
  await page.route('**/sales/qrOrder', (route) => {
    sent = route.request().postDataJSON();
    route.fulfill({ json: { type: 'success', message: 'ok', data: { order_id: 'o1' } } });
  });

  await page.goto('/cart.html');
  await page.locator('#next-btn').click();

  await expect.poll(() => sent).not.toBeNull();

  const line = sent.items.find((one) => one.item_id === 'p-naan');
  expect(line.modifiers).toBeUndefined();
});
