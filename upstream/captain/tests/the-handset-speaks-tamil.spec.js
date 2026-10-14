import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';

/*
 * THE WAITER'S LANGUAGE.
 *
 * The till beside this app has spoken Tamil for a long time. The phone in the
 * waiter's hand did not, and the staff least likely to be comfortable in
 * English are exactly the ones holding it.
 *
 * What these hold is not "the words changed". It is the two boundaries that
 * decide whether a translated screen is usable at all:
 *
 *   what a shop typed is never touched  - dish names, prices, table numbers
 *   what a script draws later IS touched - which is most of this app
 *
 * The second is why this is a walker and an observer rather than tagged
 * markup: nearly every word a waiter reads here is drawn after the first
 * paint.
 */

const MENU = [
  {
    category_name: 'Starters',
    items: [item('p-65', 'Chicken 65', 180), item('p-gobi', 'Gobi Manchurian', 160)],
  },
];

/** The app, in a given language, with the menu loaded. */
async function inLanguage(page, code) {
  await page.addInitScript((chosen) => {
    try {
      localStorage.setItem('posnic.language', chosen);
    } catch (e) {
      /* the test still runs */
    }
  }, code);
  await onTheMenu(page, 'nothing', { menu: MENU });
}

/** A line of the app's own furniture, which is what this feature changes. */
const searchBox = (page) => page.locator('#picker-search-input');

test('the screen a waiter opens is in Tamil', async ({ page }) => {
  await inLanguage(page, 'ta');
  await page.goto('/order-history.html');

  await expect(searchBox(page)).toHaveAttribute('placeholder', 'மெனுவில் தேடு');
});

test('English is what an untouched phone shows', async ({ page }) => {
  /* Nothing stored and a phone that is not set to Tamil: the app must not
     decide on somebody's behalf. */
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.goto('/order-history.html');

  await expect(searchBox(page)).toHaveAttribute('placeholder', 'Search the menu');
});

test("a dish keeps the name the shop typed, and so does its price", async ({ page }) => {
  /*
   * The whole reason this is keyed by whole sentences. A menu is a shop's own
   * writing: translating "Chicken 65" would be inventing a dish, and a waiter
   * calling it out to a kitchen needs the name on the ticket.
   */
  await inLanguage(page, 'ta');

  const row = page.locator('.dish[data-id="p-65"]');
  await expect(row).toBeVisible();
  await expect(row.locator('.dish-name')).toContainText('Chicken 65');
  await expect(row.locator('.dish-price')).toContainText('180');
});

test('what a script draws after the page loads is translated too', async ({ page }) => {
  /*
   * The add-item sheet is built when it is opened, long after the first paint.
   * A translation that only ran once would leave a waiter reading English
   * everywhere that matters, since almost everything here is drawn late.
   */
  await inLanguage(page, 'ta');
  await page.goto('/order-history.html');
  await page.waitForFunction(() => typeof openItemPicker === 'function');

  await page.evaluate(() => {
    window.setOrderBeingModified({ items: [] });
    new window.bootstrap.Modal(document.getElementById('editOrderModal')).show();
    openItemPicker();
  });

  await expect(page.locator('#item-picker .dish').first()).toBeVisible();
  await expect(page.locator('#picker-search-input')).toHaveAttribute(
    'placeholder',
    /மெனுவில் தேடு|தேடு/
  );
});

test('changing it changes the screen under your thumb, and changing back is exact', async ({
  page,
}) => {
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.goto('/order-history.html');

  await page.waitForFunction(() => typeof window.I18N === 'object');

  const said = () => page.locator('body').innerText();
  const inEnglish = await said();

  await page.evaluate(() => I18N.use('ta'));
  await expect(searchBox(page)).toHaveAttribute('placeholder', 'மெனுவில் தேடு');

  await page.evaluate(() => I18N.use('en'));

  /*
   * Exact, because the English of every line is remembered per node. A
   * round trip that translated a translation would come back subtly wrong and
   * nobody would be able to say when it started.
   */
  expect(await said()).toBe(inEnglish);
});

test('the choice is remembered for next time', async ({ page }) => {
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.goto('/order-history.html');

  await page.waitForFunction(() => typeof window.I18N === 'object');
  await page.evaluate(() => I18N.use('ta'));
  await page.reload();

  await expect(searchBox(page)).toHaveAttribute('placeholder', 'மெனுவில் தேடு');
});

test('a sentence with no translation shows English, never a key', async ({ page }) => {
  await inLanguage(page, 'ta');
  await page.goto('/order-history.html');

  const shown = await page.evaluate(() => I18N.t('Something nobody has translated yet'));
  expect(shown).toBe('Something nobody has translated yet');
});

test('a language nobody has a pack for falls back rather than blanking the screen', async ({
  page,
}) => {
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.goto('/order-history.html');

  await page.waitForFunction(() => typeof window.I18N === 'object');

  const landed = await page.evaluate(() => I18N.use('zz'));
  expect(landed).toBe('en');
  await expect(searchBox(page)).toHaveAttribute('placeholder', 'Search the menu');
});

test('what somebody typed is left alone', async ({ page }) => {
  /*
   * A note in a textarea is the waiter's own words. Translating the contents
   * of an input would rewrite what a person wrote while they were writing it.
   */
  await inLanguage(page, 'ta');
  await page.goto('/order-history.html');

  const kept = await page.evaluate(() => {
    const box = document.createElement('textarea');
    box.value = 'Close';
    document.body.appendChild(box);
    I18N.apply(document.body);
    const said = box.value;
    box.remove();
    return said;
  });

  expect(kept).toBe('Close');
});

test('a placeholder set by script later is translated too', async ({ page }) => {
  /*
   * Watching added nodes covers markup and anything built with innerHTML, and
   * misses `box.placeholder = '...'` completely: that element is not new, so
   * nothing is added. A waiter would see one box in English among Tamil ones
   * and have no idea why.
   */
  await inLanguage(page, 'ta');
  await page.goto('/order-history.html');
  await page.waitForFunction(() => typeof window.I18N === 'object');

  const said = await page.evaluate(async () => {
    const box = document.createElement('input');
    document.body.appendChild(box);
    box.setAttribute('placeholder', 'Select Table');

    /* The observer runs on a microtask, so this asks after it has. */
    await new Promise((done) => setTimeout(done, 50));

    const now = box.getAttribute('placeholder');
    box.remove();
    return now;
  });

  expect(said).toBe('டேபிளை தேர்ந்தெடு');
});
