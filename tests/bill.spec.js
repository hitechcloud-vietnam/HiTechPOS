import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';

/*
 * The bill, in a real browser.
 *
 * This screen had no coverage at all, which is how it kept a name truncated at
 * twenty-five characters and twelve accordions nobody opened. It is also the
 * last screen before food reaches a kitchen, so what it says has to be what
 * gets cooked.
 */

const MENU = [
  {
    category_name: 'Biryani',
    items: [
      item('p-1', 'Chicken Biryani (Boneless) Family Pack', 220, { diet: 'non-veg', icon: '🍛' }),
      item('p-2', 'Mutton Biryani', 320, {
        diet: 'non-veg',
        icon: '🍛',
        /* A discount and a tax, so the totals block has something to say. */
        discount_price: 20,
        tax_price: 15,
        final_price: 315,
      }),
    ],
  },
  { category_name: 'Drinks', items: [item('p-3', 'Filter Coffee', 40, { icon: '☕' })] },
];

/** At the bill, with something on it. */
async function atTheBill(page, { say = 'two chicken biryani' } = {}) {
  await onTheMenu(page, say, { menu: MENU });
  await page.locator('.dish[data-id="p-1"] .dish-add').click();
  await expect(page.locator('#bill-bar')).toHaveClass(/is-up/);
  await page.locator('#next-btn').click();
  await expect(page).toHaveURL(/cart\.html$/);
  await expect(page.locator('.bill-line').first()).toBeVisible();
}

/* ------------------------------------------------------------- the lines */

test('the name is whole, not cut at twenty-five characters', async ({ page }) => {
  /*
   * THE BUG THIS SCREEN SHIPPED WITH. Names were truncated in JavaScript with
   * an ellipsis - on the one screen that gets read out loud to a customer.
   */
  await atTheBill(page);
  await expect(page.locator('.bill-name').first()).toHaveText('Chicken Biryani (Boneless) Family Pack');
  await expect(page.locator('.bill-name').first()).not.toContainText('...');
});

test('a dish with no photograph shows its icon, as on the menu', async ({ page }) => {
  /* The same fallback both sides of the journey, so a shop with no pictures
     looks deliberate rather than broken on one screen and not the other. */
  await atTheBill(page);
  await expect(page.locator('.bill-line').first().locator('.bill-thumb')).toContainText('🍛');
});

test('the stepper works, and removing the last one empties the bill', async ({ page }) => {
  await atTheBill(page);
  const line = page.locator('.bill-line').first();

  await line.locator('[data-bill="more"]').click();
  await expect(line.locator('.bill-qty')).toHaveText('2');
  await expect(page.locator('.bill-row.is-total span').last()).toHaveText('₹440.00');

  await line.locator('[data-bill="less"]').click();
  await line.locator('[data-bill="less"]').click();
  await expect(page.locator('.bill-empty')).toBeVisible();
});

test('an emptied bill stays put rather than throwing you somewhere', async ({ page }) => {
  /*
   * It used to redirect to the table list two seconds after the last line
   * came off - the app deciding you had finished. Somebody who takes an item
   * off is usually about to add a different one.
   */
  await atTheBill(page);
  const line = page.locator('.bill-line').first();
  await line.locator('[data-bill="less"]').click();
  await expect(page.locator('.bill-empty')).toBeVisible();

  await page.waitForTimeout(3000);
  await expect(page).toHaveURL(/cart\.html$/);
  await expect(page.locator('.bill-empty a')).toBeVisible();
});

/* ------------------------------------------------------ what it comes to */

test('the totals are one block, not twelve accordions', async ({ page }) => {
  await atTheBill(page);
  await expect(page.locator('#bill-totals')).toBeVisible();
  await expect(page.locator('.expand-toggle')).toHaveCount(0);
  await expect(page.locator('.cart-item-extra')).toHaveCount(0);
});

test('a row appears only when it has something to say', async ({ page }) => {
  /*
   * A shop that charges no tax does not need a line reading "Tax ₹0.00", and
   * a bill with no discount does not need to be told so. Every row that is
   * always there is a row nobody reads.
   */
  await atTheBill(page);
  await expect(page.locator('.bill-row')).toHaveCount(1); // just the total
  await expect(page.locator('.bill-row.is-total span').last()).toHaveText('₹220.00');
});

test('and appears when it does', async ({ page }) => {
  await atTheBill(page);
  await page.goto('/products.html');
  await page.locator('.dish[data-id="p-2"] .dish-add').click();
  await page.locator('#next-btn').click();

  await expect(page.locator('.bill-row')).toHaveCount(4); // subtotal, discount, tax, total
  await expect(page.locator('#bill-totals')).toContainText('Discount');
  await expect(page.locator('#bill-totals')).toContainText('Tax');
});

test('the amount is on the button that commits it', async ({ page }) => {
  /* The old footer put the total in the middle and the action on the right,
     so confirming meant looking in two places. */
  await atTheBill(page);
  await expect(page.locator('#bill-send-amount')).toHaveText('₹220.00');
  await expect(page.locator('.bill-send')).toContainText('Send to kitchen');
});

test('the button that throws it away does not look like the one that sends it', async ({ page }) => {
  await atTheBill(page);
  const send = await page.locator('.bill-send').evaluate((el) => getComputedStyle(el).backgroundColor);
  const clear = await page.locator('.bill-clear').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(send).not.toBe(clear);
});

/* ------------------------------------------------------------- the table */

test('the bill says which table it is for', async ({ page }) => {
  /* The waiter chose it two screens ago and has taken an order since. */
  await atTheBill(page);
  await expect(page.locator('#bill-where')).toContainText('Table T1');
});

/* -------------------------------------------------------------- the note */

test('a spoken requirement is on the bill, where the kitchen reads it', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani without onion', { menu: MENU });
  const mic = page.locator('#posnic-voice-mic');
  await mic.hover();
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.locator('#posnic-voice-panel')).toBeVisible();

  /*
   * AGREED TO FIRST. Nothing reaches the cart until somebody presses the
   * button saying how many items it will add - so the requirement cannot be
   * on a cart row before this, and the wait below has to come after it. The
   * merge that brought these two changes together briefly had the wait first,
   * where it could never have been satisfied.
   */
  await page.locator('#posnic-voice-panel [data-act="confirm"]').click();

  /*
   * WAIT FOR THE NOTE, NOT FOR THE PANEL.
   *
   * The panel appears as soon as the words are understood; the requirement is
   * written to the cart AFTER that, through an IndexedDB write nothing here
   * was waiting on. Navigating on the panel alone is a race the test wins on a
   * fast desk and loses on a CI runner - which is exactly how it behaved: 115
   * green locally, this one red in Actions.
   *
   * The note showing in the panel is proof the write path ran, so there is
   * something real to wait for rather than a sleep to lengthen.
   */
  await expect(page.locator('#posnic-voice-panel .vp-want')).toHaveText('Without onion');

  await page.goto('/cart.html');
  await expect(page.locator('.bill-note')).toHaveText('Without onion');
});

test('a name that looks like markup is text, not markup', async ({ page }) => {
  /*
   * Dish names come from the shop's own database and notes from a recogniser,
   * and both went into innerHTML raw. Not a stranger's input, which is why it
   * never broke - but "never broke" is not the same as safe.
   */
  await onTheMenu(page, 'coffee', {
    menu: [{ category_name: 'Food', items: [item('p-x', '<img src=x onerror=alert(1)>', 50)] }],
  });
  await page.locator('.dish[data-id="p-x"] .dish-add').click();
  await page.locator('#next-btn').click();

  await expect(page.locator('.bill-name')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.bill-name img')).toHaveCount(0);
});

/* ----------------------------------------------- saying it is working on it */

/*
 * Owner: "view bill took few seconds. if its api call and waiting show some
 * anitmation or progress bar. dont confuse user few seconds."
 *
 * renderCart reads the cart, prices every line, applies the discount and lays
 * the bill out - and cart/style.css started #page-loader HIDDEN while only
 * ever hiding it again afterwards. So on the one screen where the wait is
 * longest there was nothing on screen for the length of it: the menu goes, and
 * a blank white page sits there.
 *
 * The menu screen has had it the right way round all along, which is why the
 * same wait there has never been reported.
 */

test('the bill screen says it is working, rather than going blank', async ({ page }) => {
  const loader = page.locator('#page-loader');

  await onTheMenu(page, 'two chicken biryani', { menu: MENU });
  await page.locator('.btn-add[data-id="p-1"]').click();
  /*
   * WAIT FOR THE CART, NOT FOR THE TAP.
   *
   * The row becomes a stepper the moment it is pressed; the line is written to
   * IndexedDB after that. Leaving for the bill on the tap alone is a race that
   * is won on a desk and lost on a CI runner, which is exactly how it
   * behaved - green here, red in Actions. The bill bar showing the count is
   * proof the write path ran.
   */
  await expect(page.locator('#cart-qty')).toHaveText('1');

  await page.goto('/cart.html');
  await expect(page.locator('.bill-line').first()).toBeVisible();

  /* And it gets out of the way once there is a bill to read. */
  await expect(loader).toBeHidden();
});

test('the loader starts up, so nothing has to race to show it', async ({ page }) => {
  /*
   * The property that matters and the one that was wrong. A loader summoned by
   * script is only ever as early as the script; one that starts visible is
   * there from the first paint, which is where the blank was.
   */
  await onTheMenu(page, 'two chicken biryani', { menu: MENU });
  const starts = await page.evaluate(async () => {
    const css = await fetch('/assets/cart/style.css').then((r) => r.text());
    const block = css.slice(css.indexOf('#page-loader'), css.indexOf('#page-loader') + 300);
    return /display:\s*flex/.test(block);
  });
  expect(starts, 'the bill loader is hidden until something shows it').toBe(true);
});

test('tapping View bill covers the gap before the bill page loads', async ({ page }) => {
  /* A bare location.href leaves the menu on screen and apparently
     unresponsive, so the first thing a second tap earns is a second
     navigation. */
  await onTheMenu(page, 'two chicken biryani', { menu: MENU });
  await page.locator('.btn-add[data-id="p-1"]').click();
  await expect(page.locator('#cart-qty')).toHaveText('1');

  const shown = await page.evaluate(() => {
    goToBill();
    return document.getElementById('page-loader').style.display;
  });
  expect(shown).toBe('flex');
});
