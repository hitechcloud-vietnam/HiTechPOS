import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';

/*
 * HOW MANY COPIES OF A BILL COME OUT, DECIDED ON THE PHONE.
 *
 * Owner: "but if reqest come from pos then how many copies? hmm its better two
 * copies from captain itself... if its from desktop sometimes if print bill
 * not workin from app everytime all will be printed 2 and 2 times. then
 * configuration change reequired pos guy wont have permission. lets keep in
 * app itself."
 *
 * The person who wants a second copy is the one holding the phone. Sending
 * them to find whoever has access to the till's settings page is how a setting
 * stays wrong for a year.
 *
 * Empty means "as the shop is set", which is not the same as one: the till has
 * its own setting and a phone nobody has asked should not overrule it. Only a
 * number chosen here travels, and the server clamps whatever arrives.
 */

/** The floor screen, with the shop sheet open. */
async function atTheShopSheet(page) {
  await onTheMenu(page, 'nothing', {});
  await page.goto('/kot-management.html');
  await page.waitForFunction(() => typeof changeServer === 'function');
  await page.evaluate(() => changeServer());
  await expect(page.locator('#server-sheet')).toBeVisible();
}

test('the choice lives where the floor already looks, not on the till', async ({ page }) => {
  await atTheShopSheet(page);

  const copies = page.locator('#bill-copies');
  await expect(copies).toBeVisible();
  /* Unset by default, and saying so in words rather than showing a 1 that
     would quietly overrule the shop. */
  await expect(copies).toHaveValue('');
  await expect(page.locator('#server-sheet')).toContainText(/This phone only/i);
});

test('a number chosen here survives the sheet being closed', async ({ page }) => {
  await atTheShopSheet(page);

  await page.locator('#bill-copies').selectOption('2');
  await page.locator('#server-close').click();
  await expect(page.locator('#server-sheet')).toBeHidden();

  await page.evaluate(() => changeServer());
  await expect(page.locator('#bill-copies')).toHaveValue('2');

  const kept = await page.evaluate(() => localStorage.getItem('posnic.bill_copies'));
  expect(kept).toBe('2');
});

test('asking for the bill sends the number', async ({ page }) => {
  await atTheShopSheet(page);
  await page.locator('#bill-copies').selectOption('2');
  await page.locator('#server-close').click();

  let sent = null;
  await page.route('**/sales/requestBillPrint', (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ type: 'success', message: 'The bill is on its way' }),
    });
  });

  await page.evaluate(() => {
    /* The real button the floor card draws, by the id its handler listens
       for - a card needs a live table behind it, and this asks the same
       question the waiter's tap asks. */
    const button = document.createElement('button');
    button.id = 'ask-for-bill';
    button.setAttribute('data-table', '6A');
    document.body.appendChild(button);
    button.click();
  });

  await expect.poll(() => sent && sent.copies).toBe(2);
  expect(sent.table_number).toBe('6A');
});

test('a phone nobody has asked sends nothing, and the shop decides', async ({ page }) => {
  /*
   * The line that makes this safe to ship on its own: every handset in the
   * field today says nothing, so every till keeps printing exactly what it
   * prints now.
   */
  await atTheShopSheet(page);
  await page.locator('#server-close').click();

  let sent = null;
  await page.route('**/sales/requestBillPrint', (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ type: 'success', message: 'The bill is on its way' }),
    });
  });

  await page.evaluate(() => {
    /* The real button the floor card draws, by the id its handler listens
       for - a card needs a live table behind it, and this asks the same
       question the waiter's tap asks. */
    const button = document.createElement('button');
    button.id = 'ask-for-bill';
    button.setAttribute('data-table', '6A');
    document.body.appendChild(button);
    button.click();
  });

  await expect.poll(() => (sent ? 'sent' : null)).toBe('sent');
  expect(Object.prototype.hasOwnProperty.call(sent, 'copies')).toBe(false);
});

test('a stored value that is not 1, 2 or 3 is ignored', async ({ page }) => {
  /* Storage is a place other things write to, and a number nobody offered
     should fall back to the shop rather than travel. */
  await onTheMenu(page, 'nothing', {});
  await page.goto('/kot-management.html');
  await page.waitForFunction(() => typeof storedBillCopies === 'function');

  for (const bad of ['9', '0', 'two', '']) {
    const got = await page.evaluate((value) => {
      localStorage.setItem('posnic.bill_copies', value);
      return storedBillCopies();
    }, bad);
    expect(got).toBe('');
  }
});
