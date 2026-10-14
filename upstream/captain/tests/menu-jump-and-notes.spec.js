import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';

/*
 * Three things the menu screen was getting wrong, all reported from a real
 * handset and none of them visible to the tests that already existed.
 *
 * THE JUMP LANDED SHORT. menu.spec.js asserts the section is `toBeInViewport()`
 * after a chip tap, and with eight dishes across three sections most of the
 * menu is in the viewport before anything is tapped - so the assertion passed
 * whether or not the page had moved at all. A long menu and a measured scroll
 * position is the only way to see it.
 *
 * THE HIGHLIGHT WAS INVISIBLE. #eef2ff against #ffffff.
 *
 * THE NOTE WAS PRE-WRITTEN. The box opened with the dish's own menu copy in
 * it, which a waiter then sent to the kitchen as an instruction.
 */

/* Long enough that a jump has to actually move the page, and with the target
   category at the far end of the rail - which is the case that was broken. */
const LONG = ['Biryani', 'Starters', 'Breads', 'Curries', 'Rice', 'Drinks', 'Desserts'].map(
  (name, ci) => ({
    category_name: name,
    items: Array.from({ length: 8 }, (_, i) =>
      item(`p-${ci}-${i}`, `${name} dish ${i + 1}`, 100 + i, { diet: 'veg' })
    ),
  })
);

const atALongMenu = (page) => onTheMenu(page, 'nothing', { menu: LONG });

/**
 * Wait for the smooth scroll to stop, rather than guessing how long it takes.
 *
 * A jump to the far end of a long menu is over seven thousand pixels, and
 * Chromium's smooth scroll takes longer than a second to cover it. Sampling on
 * a fixed timeout measured the scroll in flight and reported it as a landing
 * in the wrong place - which looks exactly like the bug this file is about.
 */
async function settled(page) {
  await page.evaluate(() => {
    window.__lastY = null;
  });
  await page.waitForFunction(
    () => {
      const y = Math.round(window.scrollY);
      const same = window.__lastY === y;
      window.__lastY = y;
      return same;
    },
    null,
    { timeout: 15000, polling: 150 }
  );
}

/** Where the section's heading has come to rest, and where it should be. */
const landing = (page, key) =>
  page.evaluate((section) => {
    const head = document.querySelector('#sec-' + section + ' .menu-section-head');
    const stick = getComputedStyle(document.documentElement).getPropertyValue('--menu-stick');
    return {
      top: Math.round(head.getBoundingClientRect().top),
      stick: Math.round(Number(String(stick).replace('px', '')) || 0),
    };
  }, key);

/* ------------------------------------------------------------- the jump */

test('a chip tap puts the heading under the chrome, not wherever it got to', async ({ page }) => {
  /*
   * THE BUG. point() brought the lit chip into view with scrollIntoView and
   * `inline: 'nearest'`, which looks like it only moves the rail and does not:
   * scrollIntoView walks every scrollable ancestor, the document included, and
   * animates it. goTo() had just started the page moving, and two smooth
   * scrolls on one scroller do not add up - the second replaces the first.
   *
   * Measured: the heading came to rest 264px down instead of 183. Tapping a
   * chip already on screen was fine, because then the rail had no reason to
   * move. That is the shape of "sometimes the category jump does nothing".
   */
  await atALongMenu(page);

  await page.locator('.menu-chip', { hasText: 'Desserts' }).click();
  await settled(page);

  const { top, stick } = await landing(page, 'desserts');
  expect(stick).toBeGreaterThan(0);
  /* Just below the stuck header, search pill and rail. Four pixels of air. */
  expect(Math.abs(top - (stick + 4))).toBeLessThanOrEqual(12);
});

test('the index sheet lands in the same place the rail does', async ({ page }) => {
  /* Two ways to the same section that stop in two different places is the
     screen disagreeing with itself. They were 297px apart. */
  await atALongMenu(page);

  await page.locator('.menu-chip', { hasText: 'Desserts' }).click();
  await settled(page);
  const byChip = await landing(page, 'desserts');

  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.waitForTimeout(400);
  await page.locator('#menu-index-btn').click();
  await page.locator('.menu-index-row', { hasText: 'Desserts' }).click();
  await settled(page);
  const bySheet = await landing(page, 'desserts');

  expect(Math.abs(byChip.top - bySheet.top)).toBeLessThanOrEqual(12);
});

test('the page really moved, rather than the section happening to be in view', async ({ page }) => {
  /* What menu.spec.js could not ask, because its menu fits on one screen. */
  await atALongMenu(page);
  const before = await page.evaluate(() => Math.round(window.scrollY));
  expect(before).toBe(0);

  await page.locator('.menu-chip', { hasText: 'Rice' }).click();
  await settled(page);

  const after = await page.evaluate(() => Math.round(window.scrollY));
  expect(after).toBeGreaterThan(500);
});

test('the rail still brings the lit chip into view', async ({ page }) => {
  /* The behaviour the broken call was there for, which the fix has to keep:
     a rail saying "you are in Desserts" while Desserts is off the right-hand
     edge has told you nothing. */
  await atALongMenu(page);
  await page.locator('.menu-chip', { hasText: 'Desserts' }).click();
  await settled(page);

  const chip = page.locator('.menu-chip.is-here');
  await expect(chip).toHaveText(/Desserts/);
  await expect(chip).toBeInViewport();
});

/* ----------------------------------------------- what is already on the order */

test('a dish on the order is marked down the whole list, not just at its stepper', async ({ page }) => {
  /* Owner: "if some items already added to that cart that menu need little
     highlight." The stepper says it too, but only once your eye is on that
     row - and the question is asked of the whole list at once. */
  await atALongMenu(page);
  const row = page.locator('.dish[data-id="p-0-0"]');

  await expect(row).not.toHaveClass(/is-in/);
  await page.locator('.btn-add[data-id="p-0-0"]').click();
  await expect(row).toHaveClass(/is-in/);

  const mark = await row.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(mark).not.toBe('none');
});

test('marking it does not change the row height', async ({ page }) => {
  /* A list that reflows as you add to it loses your place, which is the bug
     the whole screen was rebuilt around - so the mark is an inset shadow and
     never a border. */
  await atALongMenu(page);
  const row = page.locator('.dish[data-id="p-0-0"]');
  const before = (await row.boundingBox()).height;

  await page.locator('.btn-add[data-id="p-0-0"]').click();
  await expect(row).toHaveClass(/is-in/);
  await page.waitForTimeout(500);

  const after = (await row.boundingBox()).height;
  expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
});

/* ----------------------------------------------------------------- the note */

const WITH_COPY = [
  {
    category_name: 'Biryani',
    items: [
      item('p-1', 'Chicken Biryani', 220, {
        diet: 'non-veg',
        description: 'Long grain rice, slow cooked with whole spices',
      }),
    ],
  },
];

test('the note box opens empty, whatever the menu says about the dish', async ({ page }) => {
  /*
   * Owner: "why notes already filled with some text. it supposed enter by
   * waiter right?"
   *
   * It fell back to the dish's own description, so pressing Apply sent the
   * shop's marketing copy to the kitchen as an instruction, and writing a real
   * note meant noticing that and deleting it first.
   */
  await onTheMenu(page, 'nothing', { menu: WITH_COPY });
  await page.locator('.dish[data-id="p-1"] .dish-text').click();

  await expect(page.locator('#product-notes-modal')).toBeVisible();
  await expect(page.locator('#product-notes-text')).toHaveValue('');
});

test('but what is in the dish is still on screen, where nobody typed it', async ({ page }) => {
  /* Worth showing - it is the question a table actually asks - just not in
     the box somebody is about to write an instruction into. */
  await onTheMenu(page, 'nothing', { menu: WITH_COPY });
  await page.locator('.dish[data-id="p-1"] .dish-text').click();

  await expect(page.locator('#notes-about')).toContainText('Long grain rice');
});

test('a note already on the line comes back when the box is reopened', async ({ page }) => {
  /* The one case the old fallback got right, which must survive removing it. */
  await onTheMenu(page, 'nothing', { menu: WITH_COPY });
  await page.locator('.dish[data-id="p-1"] .dish-text').click();
  await page.locator('.notes-chip', { hasText: 'No onion' }).click();
  await page.locator('#notes-apply-btn').click();

  await page.locator('.dish[data-id="p-1"] .dish-text').click();
  await expect(page.locator('#product-notes-text')).toHaveValue('No onion');
});

test('the common requirements are one tap, and the same tap takes them off', async ({ page }) => {
  /* Owner: "when focus show some common template text like less medium, less
     sweet and etc." */
  await onTheMenu(page, 'nothing', { menu: WITH_COPY });
  await page.locator('.dish[data-id="p-1"] .dish-text').click();

  const spicy = page.locator('.notes-chip', { hasText: 'Less spicy' });
  const onion = page.locator('.notes-chip', { hasText: 'No onion' });

  await spicy.click();
  await expect(page.locator('#product-notes-text')).toHaveValue('Less spicy');
  await onion.click();
  await expect(page.locator('#product-notes-text')).toHaveValue('Less spicy, No onion');

  /* The commonest correction to a tap is the same tap. */
  await spicy.click();
  await expect(page.locator('#product-notes-text')).toHaveValue('No onion');
  await expect(spicy).not.toHaveClass(/is-on/);
  await expect(onion).toHaveClass(/is-on/);
});

test('a requirement typed by hand lights its chip too', async ({ page }) => {
  /* Or one of the two is lying about what is on the line. */
  await onTheMenu(page, 'nothing', { menu: WITH_COPY });
  await page.locator('.dish[data-id="p-1"] .dish-text').click();

  await page.locator('#product-notes-text').fill('No onion');
  await expect(page.locator('.notes-chip', { hasText: 'No onion' })).toHaveClass(/is-on/);
});

test('the chips are the words the microphone already understands', async ({ page }) => {
  /*
   * A ticket should not reveal whether the waiter's hands were full. These are
   * voice-order.js's own MARKERS crossed with its TASTE set, plus its
   * PORTIONS, so a tapped note and a spoken one are worded identically.
   */
  await onTheMenu(page, 'nothing', { menu: WITH_COPY });
  await page.locator('.dish[data-id="p-1"] .dish-text').click();

  for (const say of ['Less spicy', 'Less sweet', 'No onion', 'Half plate', 'One by two']) {
    await expect(page.locator('.notes-chip', { hasText: say })).toBeVisible();
  }
});
