import { test, expect } from '@playwright/test';
import { onTheMenu, item, API_BASE, SHOP_ORIGIN } from './support/shop.js';

/*
 * THE PAGE HAS TO MOVE WHEN A FINGER MOVES IT.
 *
 * Owner, from a handset: "still items not scrollable. menu(category) i can
 * able to scroll but items not able to scroll in app."
 *
 * products/style.css says `html, body { height: 100%; overflow: hidden }`.
 * menu.css was written to undo that and undid it on `body` only, so the
 * document element stayed hidden and one viewport tall. Nine thousand pixels
 * of dishes in an 844px window, and a thumb could not move any of it.
 *
 * WHY EVERY TEST WE HAD SAID IT WAS FINE. `overflow: hidden` blocks USER
 * scrolling and still permits PROGRAMMATIC scrolling. Every scroll assertion in
 * this suite moved the page by calling window.scrollTo - the chip jump, the
 * index sheet, "the page really moved" - and scrollTo is the one way of moving
 * a document that overflow:hidden does not refuse. 136 browser tests passed
 * over a menu nobody could scroll.
 *
 * So these use a GESTURE. A wheel is what Playwright can send that goes
 * through the same path a touch drag does: the browser's own scrolling, not
 * the page's API. If the document is locked, it returns 0.
 *
 * The category rail was never affected, because it is its own overflow-x box
 * and never asks the document for anything - which is exactly why the report
 * separates the two.
 */

const LONG = ['Biryani', 'Starters', 'Breads', 'Curries', 'Rice', 'Drinks', 'Desserts'].map(
  (name, ci) => ({
    category_name: name,
    items: Array.from({ length: 8 }, (_, i) =>
      item(`p-${ci}-${i}`, `${name} dish ${i + 1}`, 100 + i, { diet: 'veg' })
    ),
  })
);

/** How far a gesture moved the page. */
async function dragged(page, by = 1200) {
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.waitForTimeout(250);
  await page.mouse.move(200, 500);
  await page.mouse.wheel(0, by);
  await page.waitForTimeout(600);
  return page.evaluate(() => Math.round(window.scrollY));
}

test('a finger can scroll the dishes', async ({ page }) => {
  await onTheMenu(page, 'nothing', { menu: LONG });

  /* There is more menu than window, or the rest of this proves nothing. */
  const room = await page.evaluate(() => ({
    content: document.documentElement.scrollHeight,
    window: window.innerHeight,
  }));
  expect(room.content).toBeGreaterThan(room.window + 500);

  expect(await dragged(page)).toBeGreaterThan(300);
});

test('the document element is not the thing holding it still', async ({ page }) => {
  /*
   * Named directly, because this is the whole defect and it is one word. A
   * later stylesheet that resets `body` and forgets `html` puts it straight
   * back, and nothing else on screen changes when it does.
   */
  await onTheMenu(page, 'nothing', { menu: LONG });
  const overflow = await page.evaluate(
    () => getComputedStyle(document.documentElement).overflow
  );
  expect(overflow).not.toBe('hidden');
});

test('the category rail still scrolls sideways on its own', async ({ page }) => {
  /* It always did - it is its own box. The fix must not have cost it. */
  await onTheMenu(page, 'nothing', { menu: LONG });
  const rail = await page.locator('.menu-rail').evaluate((el) => ({
    overflowX: getComputedStyle(el).overflowX,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));

  /* Its own scroll container, with more chips than fit. That is the whole
     reason it kept working while the document was locked, and the reason the
     report could tell the two apart. */
  expect(rail.overflowX).toBe('auto');
  expect(rail.scrollWidth).toBeGreaterThan(rail.clientWidth);
});

test('a finger can scroll the table screen too', async ({ page }) => {
  /*
   * table/style.css carries the identical `html, body { overflow: hidden }`,
   * and seat.css replaced everything about that screen except those two
   * declarations. A shop with more tables than fit could not reach the ones
   * below the fold, and on a short phone neither the pax stepper nor Next was
   * reachable - with no error and nothing on screen to say why.
   */
  const many = Array.from({ length: 40 }, (_, i) => `T${i + 1}`);

  await page.addInitScript(
    ({ url, tables }) => {
      localStorage.setItem('posnic.server', JSON.stringify({ pinned: url, active: url }));
      localStorage.setItem('kiosk_tableorders', JSON.stringify(tables.map((t) => ({ id: t, table_no: t }))));
    },
    { url: API_BASE, tables: many }
  );
  await page.route(`${SHOP_ORIGIN}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ type: 'success', data: {} }),
    })
  );

  await page.goto('/discount.html');
  await expect(page.locator('body')).toBeVisible();

  const overflow = await page.evaluate(
    () => getComputedStyle(document.documentElement).overflow
  );
  expect(overflow).not.toBe('hidden');
});

test('a finger can scroll a long bill', async ({ page }) => {
  /*
   * Found by the static guard rather than reported: cart/style.css locks the
   * document with "prevent whole page scroll", and bill.css - which gave that
   * screen a sticky head and padding-bottom for the action bar, both of which
   * mean THE PAGE SCROLLS - never released it. A bill longer than the screen
   * had lines nobody could reach, and it would not have looked broken.
   */
  await onTheMenu(page, 'nothing', { menu: LONG });

  /* Enough lines to overflow. */
  const ids = ['p-0-0', 'p-0-1', 'p-0-2', 'p-1-0', 'p-1-1', 'p-2-0', 'p-2-1', 'p-3-0'];
  for (const id of ids) {
    await page.locator(`.btn-add[data-id="${id}"]`).click();
  }
  /* Every line written, not merely every button pressed - the write to
     IndexedDB lands after the row turns into a stepper. */
  await expect(page.locator('#cart-qty')).toHaveText(String(ids.length));

  await page.goto('/cart.html');
  await expect(page.locator('.bill-line').first()).toBeVisible();

  const overflow = await page.evaluate(
    () => getComputedStyle(document.documentElement).overflow
  );
  expect(overflow).not.toBe('hidden');
});
