import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';

/*
 * THE FLOOR SHOWS WHAT THE KITCHEN WAS TOLD.
 *
 * Owner: "i see notes inside kot print but inside app not showing note (ex.
 * medium spicy). need fix. its important captain know the customization."
 *
 * The note reached the paper and stopped there. A waiter opening a table saw
 * "Chicken Biryani x2" and nothing about the medium spicy - so the one screen
 * where a mistake is still cheap to catch was the one screen that did not show
 * it. By the time the plate is wrong, the dish is cooked.
 *
 * Driven through the real screen: a table on the floor, tapped, and the panel
 * read. Every test that existed for this screen checked names and quantities,
 * which is exactly why a missing note survived.
 */

const TABLE = '6A';

/** One open ticket on table 6A, with a note on one of its two lines. */
const AN_ORDER = (over = {}) => ({
  _id: 'k-1',
  sales_id: 'SB1D14-000051',
  table_number: TABLE,
  person_count: 4,
  sale_process: 'KOT',
  payment_status: 'Unpaid',
  sales_total: 660,
  created_date: new Date().toISOString(),
  items: [
    {
      item_id: 'p-1',
      item_name: 'Chicken Biryani',
      item_quantity: 2,
      item_price: 220,
      /* What the till stores, and what a saved order comes back with. */
      item_description: 'medium spicy',
    },
    { item_id: 'p-2', item_name: 'Filter Coffee', item_quantity: 1, item_price: 40 },
  ],
  ...over,
});

/** The floor, with that table open. */
async function atTheTable(page, order = AN_ORDER()) {
  await onTheMenu(page, 'nothing', {});

  await page.route('**/sales/getTablesWithActiveOrders', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'success',
        data: { tables: [{ table_number: TABLE, order_count: 1, total: 660 }] },
      }),
    })
  );

  await page.route('**/sales/getListKot**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      /* `data.list`, which is what the panel reads - not `orders`, which is
         what the order-history endpoint returns. Two endpoints, two shapes. */
      body: JSON.stringify({ type: 'success', data: { list: [order] } }),
    })
  );

  await page.goto('/kot-management.html');
  await page.waitForFunction(() => typeof selectTable === 'function');
  await page.evaluate((table) => selectTable(table, false), TABLE);
  await expect(page.locator('.order-legacy-line').first()).toBeVisible();
}

test('a note on a dish is on the screen, not only on the paper', async ({ page }) => {
  await atTheTable(page);

  const biryani = page.locator('.order-legacy-line', { hasText: 'Chicken Biryani' });
  await expect(biryani).toContainText('medium spicy');
});

test('the note reads as belonging to the dish, under it rather than beside the count', async ({
  page,
}) => {
  /*
   * A fourth cell after the quantity reads as another column. The note has to
   * sit under the dish name, which is what makes it obviously about that dish
   * when a waiter scans a card of six lines.
   */
  await atTheTable(page);

  /*
   * ALL THREE BOXES IN ONE FRAME.
   *
   * The panel slides in over four tenths of a second. Measuring the row, the
   * name and the note in three separate calls measures them at three different
   * moments of that slide, and the numbers disagree by however far the panel
   * moved in between - which passed when this file ran alone and failed in the
   * full suite, the shape of every flaky test ever written.
   */
  const at = await page
    .locator('.order-legacy-line', { hasText: 'Chicken Biryani' })
    .evaluate((row) => {
      const box = (el) => el.getBoundingClientRect();
      return {
        row: box(row).x,
        name: box(row.querySelector('strong')).x,
        nameY: box(row.querySelector('strong')).y,
        note: box(row.querySelector('.order-legacy-note')).x,
        noteY: box(row.querySelector('.order-legacy-note')).y,
      };
    });

  /* Below the dish, which is what makes it read as being about that dish. */
  expect(at.noteY).toBeGreaterThan(at.nameY);

  /* And indented past the number, roughly under the name. Within a few pixels
     rather than exactly: the row is flexbox and the last pixel is the
     browser's to round. */
  expect(at.note).toBeGreaterThanOrEqual(at.row);
  expect(Math.abs(at.note - at.name)).toBeLessThanOrEqual(6);
});

test('a dish with nothing said about it gains no empty line', async ({ page }) => {
  await atTheTable(page);

  const coffee = page.locator('.order-legacy-line', { hasText: 'Filter Coffee' });
  await expect(coffee.locator('.order-legacy-note')).toHaveCount(0);
});

test("a note typed in this phone's cart is read too", async ({ page }) => {
  /*
   * Two field names, both real: `item_description` is what the till returns,
   * `notes` is what a line carries while it is still in this phone's cart. A
   * screen that reads one of them is right half the time, which is worse than
   * being wrong - it works until somebody checks.
   */
  const order = AN_ORDER();
  order.items[0] = {
    item_id: 'p-1',
    item_name: 'Chicken Biryani',
    item_quantity: 2,
    notes: 'no onion',
  };

  await atTheTable(page, order);
  await expect(page.locator('.order-legacy-line', { hasText: 'Chicken Biryani' })).toContainText('no onion');
});

test('a note cannot smuggle markup onto the floor', async ({ page }) => {
  /*
   * A dish name comes from the shop's own catalogue. A NOTE is free text
   * somebody typed at a table, and this screen builds its markup by
   * interpolation - so an apostrophe in "don't" or a "<" for "less than
   * medium" would end an attribute or a tag.
   */
  const order = AN_ORDER();
  order.items[0].item_description = `don't <b>overcook</b> & "burn"`;

  await atTheTable(page, order);

  const note = page.locator('.order-legacy-line', { hasText: 'Chicken Biryani' }).locator('.order-legacy-note');
  await expect(note).toHaveText(`don't <b>overcook</b> & "burn"`);
  await expect(note.locator('b')).toHaveCount(0);
});

test('a cancelled dish strikes its note along with its name', async ({ page }) => {
  /* The note belongs to the dish. A struck dish with a live-looking
     instruction under it is the kind of thing a kitchen acts on. */
  const order = AN_ORDER();
  /* `cancelled: true` is what the floor reads - see itemIsCancelled. There is
     no `item_status` in that rule, and a fixture that invents one would test
     nothing. */
  order.items[0].cancelled = true;

  await atTheTable(page, order);

  const decoration = await page
    .locator('.order-legacy-line.is-cancelled .order-legacy-note')
    .first()
    .evaluate((el) => getComputedStyle(el).textDecorationLine);
  expect(decoration).toContain('line-through');
});
