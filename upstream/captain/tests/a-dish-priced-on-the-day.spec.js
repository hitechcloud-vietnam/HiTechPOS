import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';

/*
 * A DISH THE SHOP PRICES ON THE DAY.
 *
 * Owner, from a live table at a client: two fish went to the kitchen worth
 * nothing. "zero price items are actually dyanmic pricing. its based current
 * price. so if you find that kind of item we need to allow captain to update
 * the price and give order."
 *
 * A whole fish, a crab, a lobster: the shop cannot print a number on the card
 * because it does not know one until the morning's market. The catalogue
 * carries no selling price, the row showed 0.00, and every layer below took
 * that literally - including the bill.
 *
 * So the waiter is asked. These are the rules about when, and about what
 * happens if they do not answer.
 */

/*
 * THE FLAG CONTRACT: daily_price says the rate comes from the morning's
 * market, price_set_on says when somebody last entered it. A shop that has
 * set neither still says the same thing by leaving the price at zero, which
 * is how these dishes are set up today - so both shapes are on this menu.
 */
const hoursAgo = (n) => new Date(Date.now() - n * 60 * 60 * 1000).toISOString();

const MENU = [
  {
    category_name: 'From the sea',
    items: [
      /* No price on the card: this is the shape that caused it. */
      item('p-fish', 'Tandoori Pomfret', 0, {}),
      /* Marked, and priced this morning: an ordinary dish all day. */
      /*
       * Priced NOW, not "two hours ago". A suite that runs at one in the
       * morning made two hours ago yesterday, and this went red for a reason
       * that had nothing to do with the app. The real question is only ever
       * "was it priced today", so ask it that way.
       */
      item('p-crab', 'Pepper Crab', 900, { daily_price: true, price_set_on: new Date().toISOString() }),
      /* Marked, and last priced yesterday: not a price, a leftover. */
      item('p-lobster', 'Butter Lobster', 1200, { daily_price: true, price_set_on: hoursAgo(26) }),
      item('p-biryani', 'Chicken Biryani', 220, {}),
    ],
  },
];

async function atTheMenu(page) {
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.waitForFunction(() => typeof updateQuantity === 'function');
}

test('a dish with no price says so, instead of showing nothing', async ({ page }) => {
  /*
   * A 0.00 on a menu row reads as free, and a waiter who believes it sends a
   * table a fish for nothing - which is exactly what happened.
   */
  await atTheMenu(page);

  const fish = page.locator('.dish[data-id="p-fish"]');
  await expect(fish.locator('.dish-ask')).toHaveText(/today's price/i);
  await expect(fish).not.toContainText('0.00');

  /* And an ordinary dish is untouched. */
  const biryani = page.locator('.dish[data-id="p-biryani"]');
  await expect(biryani.locator('.dish-price')).toContainText('220');
  await expect(biryani.locator('.dish-ask')).toHaveCount(0);
});

test('adding it asks for the price', async ({ page }) => {
  await atTheMenu(page);

  await page.locator('.dish[data-id="p-fish"] .btn-add').click();
  await expect(page.locator('#ask-price-scrim')).toBeVisible();
  await expect(page.locator('#ask-price-dish')).toHaveText('Tandoori Pomfret');
});

test('an ordinary dish is never asked about', async ({ page }) => {
  await atTheMenu(page);

  await page.locator('.dish[data-id="p-biryani"] .btn-add').click();
  await expect(page.locator('#ask-price-scrim')).toBeHidden();
  await expect(page.locator('.dish[data-id="p-biryani"] .dish-qty')).toHaveText('1');
});

test('the price entered lands on the cart line', async ({ page }) => {
  await atTheMenu(page);

  await page.locator('.dish[data-id="p-fish"] .btn-add').click();
  await page.locator('#ask-price-input').fill('850');
  await page.locator('#ask-price-ok').click();

  await expect(page.locator('.dish[data-id="p-fish"] .dish-qty')).toHaveText('1');

  const line = await page.evaluate(async () => {
    const cart = await getCartData();
    return cart.find((i) => i.id === 'p-fish');
  });
  expect(line.askedPrice).toBe(850);
});

test('backing out adds nothing at all', async ({ page }) => {
  /*
   * Asked BEFORE the quantity moves, so Cancel leaves the order exactly as it
   * was - rather than adding a free dish and then taking it off again.
   */
  await atTheMenu(page);

  await page.locator('.dish[data-id="p-fish"] .btn-add').click();
  await page.locator('#ask-price-cancel').click();

  await expect(page.locator('#ask-price-scrim')).toBeHidden();
  await expect(page.locator('.dish[data-id="p-fish"] .btn-add')).toHaveCount(1);
  await expect(page.locator('.dish[data-id="p-fish"] .dish-qty')).toHaveCount(0);

  const cart = await page.evaluate(() => getCartData());
  expect(cart.find((i) => i.id === 'p-fish')).toBeUndefined();
});

test('nothing, zero or a silly number is refused at the table', async ({ page }) => {
  /* Told here rather than after the order has travelled to the server. */
  await atTheMenu(page);
  await page.locator('.dish[data-id="p-fish"] .btn-add').click();

  await page.locator('#ask-price-ok').click();
  await expect(page.locator('#ask-price-warn')).toHaveText(/enter a price/i);
  await expect(page.locator('#ask-price-scrim')).toBeVisible();

  await page.locator('#ask-price-input').fill('0');
  await page.locator('#ask-price-ok').click();
  await expect(page.locator('#ask-price-warn')).toHaveText(/enter a price/i);

  await page.locator('#ask-price-input').fill('9999999');
  await page.locator('#ask-price-ok').click();
  await expect(page.locator('#ask-price-warn')).toHaveText(/too high/i);

  await page.locator('#ask-price-input').fill('850');
  await page.locator('#ask-price-ok').click();
  await expect(page.locator('#ask-price-scrim')).toBeHidden();
});

test('the order sends the price the waiter entered', async ({ page }) => {
  /*
   * The end of the chain, and the half that could not be fixed in the app
   * alone: the server prices from its own catalogue and ignores the client,
   * so it had to be taught to accept a price for a dish it has none for. This
   * checks our side of that bargain - that the number actually travels.
   */
  await atTheMenu(page);

  await page.locator('.dish[data-id="p-fish"] .btn-add').click();
  await page.locator('#ask-price-input').fill('850');
  await page.locator('#ask-price-ok').click();
  await expect(page.locator('.dish[data-id="p-fish"] .dish-qty')).toHaveText('1');

  const line = await page.evaluate(async () => {
    const cart = await getCartData();
    const i = cart.find((x) => x.id === 'p-fish');
    /* Built the way indexedDB.js builds the order payload. */
    return { item_price: i.askedPrice || i.final_price || i.price || 0, quantity: i.quantity };
  });

  expect(line.item_price).toBe(850);
  expect(line.quantity).toBe(1);
});

test('a second one costs the same as the first, without asking again', async ({ page }) => {
  /* The waiter was quoted once for that fish. Asking per tap would be a
     question between every plate. */
  await atTheMenu(page);

  await page.locator('.dish[data-id="p-fish"] .btn-add').click();
  await page.locator('#ask-price-input').fill('850');
  await page.locator('#ask-price-ok').click();

  await page.locator('.dish[data-id="p-fish"] .btn-increase').click();
  await expect(page.locator('#ask-price-scrim')).toBeHidden();
  await expect(page.locator('.dish[data-id="p-fish"] .dish-qty')).toHaveText('2');

  const line = await page.evaluate(async () => {
    const cart = await getCartData();
    return cart.find((i) => i.id === 'p-fish');
  });
  expect(line.askedPrice).toBe(850);
  expect(line.quantity).toBe(2);
});

test("a dish priced this morning is ordinary, and the waiter is asked nothing", async ({ page }) => {
  /*
   * The whole point of the shop setting these when they open. A handset that
   * asks anyway, for a number already on the screen, is a handset that gets
   * ignored - and then the question that matters gets ignored too.
   */
  await atTheMenu(page);

  const crab = page.locator('.dish[data-id="p-crab"]');
  await expect(crab.locator('.dish-price')).toContainText('900');
  await expect(crab.locator('.dish-ask')).toHaveCount(0);

  await crab.locator('.btn-add').click();
  await expect(page.locator('#ask-price-scrim')).toBeHidden();
  await expect(crab.locator('.dish-qty')).toHaveText('1');

  const line = await page.evaluate(async () => (await getCartData()).find((i) => i.id === 'p-crab'));
  expect(line.askedPrice).toBeFalsy();
});

test("yesterday's price is not today's, so the waiter is asked again", async ({ page }) => {
  /*
   * The quiet failure this flag exists to catch. A stale number is worse than
   * the zero that started all this: zero is obviously wrong and somebody
   * shouts, while 1200 for a lobster looks right and reaches the bill.
   */
  await atTheMenu(page);

  const lobster = page.locator('.dish[data-id="p-lobster"]');
  await expect(lobster.locator('.dish-ask')).toHaveText(/today's price/i);
  await expect(lobster).not.toContainText('1200');

  await lobster.locator('.btn-add').click();
  await expect(page.locator('#ask-price-scrim')).toBeVisible();
  await expect(page.locator('#ask-price-dish')).toHaveText('Butter Lobster');

  await page.locator('#ask-price-input').fill('1400');
  await page.locator('#ask-price-ok').click();

  /* Wait for the line to EXIST before reading it. The click and the write to
     storage are not the same tick, and on a slow runner the read wins. */
  await expect(lobster.locator('.dish-qty')).toHaveText('1');

  const line = await page.evaluate(async () => (await getCartData()).find((i) => i.id === 'p-lobster'));
  expect(line.askedPrice).toBe(1400);
});

test('a dish marked for the market but never priced is asked about', async ({ page }) => {
  /* Flag set in the morning, price not entered yet: the same question, and
     the card price it still carries is not offered as an answer. */
  await onTheMenu(page, 'nothing', {
    menu: [{ category_name: 'From the sea', items: [item('p-prawn', 'Tiger Prawn', 700, { daily_price: true })] }],
  });
  await page.waitForFunction(() => typeof updateQuantity === 'function');

  const prawn = page.locator('.dish[data-id="p-prawn"]');
  await expect(prawn.locator('.dish-ask')).toHaveText(/today's price/i);
  await prawn.locator('.btn-add').click();
  await expect(page.locator('#ask-price-scrim')).toBeVisible();
});

test('an unreadable date is treated as not today, never as today', async ({ page }) => {
  /* The safe way round: a question costs a waiter five seconds, a stale price
     costs the shop its word. */
  await onTheMenu(page, 'nothing', {
    menu: [{ category_name: 'From the sea', items: [
      item('p-squid', 'Salt Squid', 500, { daily_price: true, price_set_on: 'before the boat came in' }),
    ] }],
  });
  await page.waitForFunction(() => typeof updateQuantity === 'function');

  await expect(page.locator('.dish[data-id="p-squid"] .dish-ask')).toHaveText(/today's price/i);
});

test('a shop that has set no flag at all is exactly as it was', async ({ page }) => {
  /*
   * Every shop until the flag reaches them, which is why this shipped ahead
   * of the schema: no daily_price anywhere, and the handset still asks for
   * the dish with no price and stays quiet about the one that has one.
   */
  await atTheMenu(page);

  await expect(page.locator('.dish[data-id="p-fish"] .dish-ask')).toHaveText(/today's price/i);
  await expect(page.locator('.dish[data-id="p-biryani"] .dish-ask')).toHaveCount(0);
});

test('a dish the shop marks open_price is always asked about', async ({ page }) => {
  /*
   * Different from the morning's market: the shop is saying the price is
   * settled at the counter, every single time, so a card price is not an
   * answer and today's date is not either.
   *
   * This flag was read by the menu row for MONTHS and never once arrived: the
   * loop that stores the menu names the fields it keeps, and anything it does
   * not name is dropped before a screen sees it. See indexedDB.js.
   */
  await onTheMenu(page, 'nothing', {
    menu: [{ category_name: 'From the sea', items: [
      item('p-oyster', 'Oysters', 600, { open_price: true, daily_price: true, price_set_on: hoursAgo(1) }),
    ] }],
  });
  await page.waitForFunction(() => typeof updateQuantity === 'function');

  await expect(page.locator('.dish[data-id="p-oyster"] .dish-ask')).toHaveText(/today's price/i);
  await page.locator('.dish[data-id="p-oyster"] .btn-add').click();
  await expect(page.locator('#ask-price-scrim')).toBeVisible();
});

/* ------------------------------------------------------- and on the bill */

test("the bill shows the price the waiter entered, not zero", async ({ page }) => {
  /*
   * THE SHOCK, ONE SCREEN LATER. The waiter is asked, types 850, and the bill
   * screen - the last thing before the kitchen, and the thing read out to a
   * customer - still totals the line from the catalogue, which has nothing.
   *
   * "i see total as 0 and shocked" was about a printed bill. This is the same
   * zero on the handset the waiter is holding.
   */
  await atTheMenu(page);

  await page.locator('.dish[data-id="p-fish"] .btn-add').click();
  await page.locator('#ask-price-input').fill('850');
  await page.locator('#ask-price-ok').click();
  await expect(page.locator('.dish[data-id="p-fish"] .dish-qty')).toHaveText('1');

  await page.locator('#next-btn').click();
  await expect(page).toHaveURL(/cart\.html$/);

  const line = page.locator('.bill-line').first();
  await expect(line.locator('.bill-each')).toHaveText(/850\.00/);
  await expect(page.locator('.bill-row.is-total span').last()).toHaveText('₹850.00');
});

test("two of them add up, and the total is not the catalogue's nothing", async ({ page }) => {
  await atTheMenu(page);

  await page.locator('.dish[data-id="p-fish"] .btn-add').click();
  await page.locator('#ask-price-input').fill('850');
  await page.locator('#ask-price-ok').click();
  await expect(page.locator('.dish[data-id="p-fish"] .dish-qty')).toHaveText('1');
  await page.locator('.dish[data-id="p-fish"] .btn-increase').click();
  await expect(page.locator('.dish[data-id="p-fish"] .dish-qty')).toHaveText('2');

  await page.locator('#next-btn').click();
  await expect(page).toHaveURL(/cart\.html$/);
  await expect(page.locator('.bill-row.is-total span').last()).toHaveText('₹1,700.00');
});

test("an ordinary dish alongside it still totals the way it always did", async ({ page }) => {
  /* The line that says this change is safe: the biryani is priced on the card
     and nothing about it goes through today's-price at all. */
  await atTheMenu(page);

  await page.locator('.dish[data-id="p-biryani"] .btn-add').click();
  await page.locator('.dish[data-id="p-fish"] .btn-add').click();
  await page.locator('#ask-price-input').fill('850');
  await page.locator('#ask-price-ok').click();
  await expect(page.locator('.dish[data-id="p-fish"] .dish-qty')).toHaveText('1');

  await page.locator('#next-btn').click();
  await expect(page).toHaveURL(/cart\.html$/);
  await expect(page.locator('.bill-row.is-total span').last()).toHaveText('₹1,070.00');
});

/* ------------------------------------------- correcting a mistyped price */

test("a price typed wrong can be typed again from the bill", async ({ page }) => {
  /*
   * 850 for a lobster that costs 8500 is one missed key, and the menu screen
   * deliberately does not ask again when a second plate is added - the table
   * was quoted once. So without this the only way back is to strike the line
   * off and start it again, on the screen the waiter reads out to the table.
   */
  await atTheMenu(page);

  await page.locator('.dish[data-id="p-fish"] .btn-add').click();
  await page.locator('#ask-price-input').fill('850');
  await page.locator('#ask-price-ok').click();
  await expect(page.locator('.dish[data-id="p-fish"] .dish-qty')).toHaveText('1');

  await page.locator('#next-btn').click();
  await expect(page).toHaveURL(/cart\.html$/);
  await expect(page.locator('.bill-row.is-total span').last()).toHaveText('₹850.00');

  /* The question opens with the number already in it: a correction is an edit,
     not a retype. */
  await page.locator('.bill-each.is-askable').first().click();
  await expect(page.locator('#ask-price-input')).toHaveValue('850');
  await page.locator('#ask-price-input').fill('8500');
  await page.locator('#ask-price-ok').click();

  await expect(page.locator('.bill-each.is-askable').first()).toContainText('8,500.00');
  await expect(page.locator('.bill-row.is-total span').last()).toHaveText('₹8,500.00');
});

test('the count is not touched by a correction', async ({ page }) => {
  await atTheMenu(page);

  await page.locator('.dish[data-id="p-fish"] .btn-add').click();
  await page.locator('#ask-price-input').fill('850');
  await page.locator('#ask-price-ok').click();
  await expect(page.locator('.dish[data-id="p-fish"] .dish-qty')).toHaveText('1');
  await page.locator('.dish[data-id="p-fish"] .btn-increase').click();
  await expect(page.locator('.dish[data-id="p-fish"] .dish-qty')).toHaveText('2');

  await page.locator('#next-btn').click();
  await page.locator('.bill-each.is-askable').first().click();
  await page.locator('#ask-price-input').fill('900');
  await page.locator('#ask-price-ok').click();

  await expect(page.locator('.bill-qty').first()).toHaveText('2');
  await expect(page.locator('.bill-row.is-total span').last()).toHaveText('₹1,800.00');
});

test('backing out of the correction leaves the price alone', async ({ page }) => {
  await atTheMenu(page);

  await page.locator('.dish[data-id="p-fish"] .btn-add').click();
  await page.locator('#ask-price-input').fill('850');
  await page.locator('#ask-price-ok').click();
  await expect(page.locator('.dish[data-id="p-fish"] .dish-qty')).toHaveText('1');

  await page.locator('#next-btn').click();
  await page.locator('.bill-each.is-askable').first().click();
  await page.locator('#ask-price-cancel').click();

  await expect(page.locator('.bill-row.is-total span').last()).toHaveText('₹850.00');
});

test("an ordinary dish's price cannot be retyped on the bill", async ({ page }) => {
  /*
   * The shop prices a biryani, not the waiter. A bill screen where any price
   * can be overwritten is a way to give a discount nobody approved.
   */
  await atTheMenu(page);

  await page.locator('.dish[data-id="p-biryani"] .btn-add').click();
  await page.locator('#next-btn').click();
  await expect(page).toHaveURL(/cart\.html$/);

  await expect(page.locator('.bill-line').first()).toBeVisible();
  await expect(page.locator('.bill-each.is-askable')).toHaveCount(0);
  await expect(page.locator('.bill-each').first()).toContainText('220.00');
});

/* ------------------------------ the trading day, which starts at seven */

test('a price set this morning still stands at half past midnight', async ({ page }) => {
  /*
   * Owner: "daily price starts in the morning only. means 7am. not midnight
   * coz up to 1am restaurant might open."
   *
   * On a calendar day a kitchen's own prices expire in the middle of its
   * service: at midnight every fish reads as yesterday's, the handset starts
   * asking waiters for numbers they were given at eleven that morning, and the
   * till refuses the dishes until somebody retypes the lot - during the last
   * push of the night.
   *
   * The phone's clock is moved rather than the fixture, because that is the
   * thing that actually changes on a floor.
   */
  const MORNING = new Date('2026-09-14T11:00:00').toISOString();

  await page.clock.install({ time: new Date('2026-09-15T00:30:00') });
  await onTheMenu(page, 'nothing', {
    menu: [{ category_name: 'From the sea', items: [
      item('p-tuna', 'Seer Fish', 900, { daily_price: true, price_set_on: MORNING }),
    ] }],
  });
  await page.waitForFunction(() => typeof updateQuantity === 'function');

  const tuna = page.locator('.dish[data-id="p-tuna"]');
  await expect(tuna.locator('.dish-price')).toContainText('900');
  await expect(tuna.locator('.dish-ask')).toHaveCount(0);

  await tuna.locator('.btn-add').click();
  await expect(page.locator('#ask-price-scrim')).toBeHidden();
});

test('at seven in the morning the price must be set again', async ({ page }) => {
  /* The shop is opening. This is the moment the question helps rather than
     interrupts. */
  const YESTERDAY_MORNING = new Date('2026-09-14T11:00:00').toISOString();

  await page.clock.install({ time: new Date('2026-09-15T07:05:00') });
  await onTheMenu(page, 'nothing', {
    menu: [{ category_name: 'From the sea', items: [
      item('p-tuna', 'Seer Fish', 900, { daily_price: true, price_set_on: YESTERDAY_MORNING }),
    ] }],
  });
  await page.waitForFunction(() => typeof updateQuantity === 'function');

  await expect(page.locator('.dish[data-id="p-tuna"] .dish-ask')).toHaveText(/today's price/i);
});

test('the handset turns its day at the same hour as the till', async ({ page }) => {
  /* Four surfaces answer this separately. Two disagreeing means a waiter is
     asked for a price the bill already knows, or worse, the other way round. */
  await onTheMenu(page, 'nothing', {});
  const hour = await page.evaluate(() => MenuView.dayStartsAtHour());
  expect(hour).toBe(7);
});

for(const theme of ['light','dark'])test(`market price dialog and Quick sale fit a narrow phone in ${theme}`,async({page})=>{
 await page.setViewportSize({width:320,height:640});
 await page.emulateMedia({colorScheme:theme});
 await atTheMenu(page);
 await expect(page.locator('#product-quick-sale')).toContainText('Quick sale');
 await expect(page.locator('#product-quick-sale')).toBeInViewport();
 await page.locator('.dish[data-id="p-fish"] .btn-add').click();
 const card=page.locator('#ask-price-card');
 await expect(card).toBeVisible();
 const bounds=await card.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(320);
 await expect(page.locator('#ask-price-ok')).toBeInViewport();
 await page.screenshot({path:`test-artifacts/market-price-${theme}.png`});
 await page.locator('#ask-price-input').fill('850');
 await page.locator('#ask-price-ok').click();
 await expect(page.locator('.dish[data-id="p-fish"] .dish-qty')).toHaveText('1');
});
