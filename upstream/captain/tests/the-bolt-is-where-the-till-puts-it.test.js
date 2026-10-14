'use strict';

/*
 * THE SAME MARK AS THE TILL, IN BOTH PLACES SOMEBODY SEARCHES.
 *
 * Owner: "inside menu pop up menu add + button or some symbol to do quick
 * sales. better use same icon as desktop app has. same icon in search box
 * better. near to that."
 *
 * Two faults in one sentence. The control existed on the menu screen and not
 * in the sheet that adds to an order already on a table - which is most of
 * them - and it was a bare `+`, which on a screen full of ADD buttons reads as
 * "add a row" rather than "sell something that is not on the menu". The till's
 * sale screen has used a lightning bolt for this for years.
 *
 * And the version. It was printed on the sign-in screen only, so the only way
 * to answer "which build am I on" was to sign out.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('THE MENU SEARCH CARRIES THE TILL S OWN MARK', () => {
  const page = read('products.html');
  const at = page.indexOf('id="product-quick-sale"');
  assert.ok(at > -1, 'the way in is gone from the menu screen');

  const button = page.slice(at, page.indexOf('</button>', at));
  assert.match(button, /fa-bolt/, 'it is not the mark the till uses');
  assert.doesNotMatch(button, />\+</, 'it is still a bare plus');
});

test('AND SO DOES THE SHEET THAT ADDS TO AN OPEN ORDER', () => {
  /* Both pages carry the picker, and a control on one of them is a control a
     waiter cannot rely on. */
  for (const page of ['kot-management.html', 'order-history.html']) {
    const html = read(page);
    assert.match(html, /id="picker-quick-sale"/, page + ' has no way in');
    const at = html.indexOf('id="picker-quick-sale"');
    assert.match(html.slice(at, html.indexOf('</button>', at)), /fa-bolt/, page + ' uses another mark');
  }
});

test('and it reaches the same till endpoint as the menu screen', () => {
  /*
   * Everything past the price is the ordinary add path, so the line, the
   * kitchen ticket and the bill know nothing unusual happened.
   */
  const js = read('assets', 'order-history', 'script.js');
  const at = js.indexOf("closest('#picker-quick-sale')");
  assert.ok(at > -1, 'the button in the sheet reaches nothing');

  const handler = js.slice(at, at + 2000);
  assert.match(handler, /POSNIC\.quickSale\.ask\(name\)/, 'it adds a line at no price');
  /* The name it ASKED for, not the box: with an empty box `said` is '' and the
     till is handed an item with no name. */
  assert.match(handler, /POSNIC\.quickSale\.createOneOff\(name, price, entry\.tax\)/);
  assert.match(handler, /addProductToOrder\(made\.id, made\.name, price\)/, 'it never joins the order');
});

test('it saves the new dish with saveOne, never saveData', () => {
  /*
   * saveData clears the store first - it is the door the whole menu arrives
   * through - so using it here would delete the menu and leave the one dish
   * just created. That shipped once and took a shop's menu with it.
   */
  const js = read('assets', 'order-history', 'script.js');
  const at = js.indexOf("closest('#picker-quick-sale')");
  const handler = js.slice(at, at + 2000);

  assert.match(handler, /saveOne\(STORE_NAME, \[made\]\)/);
  assert.doesNotMatch(handler, /saveData\(/);
});

test('a failure says so with the helper this screen has', () => {
  /* POSNIC.popup has no tell(); an error path that throws is an error nobody
     ever sees. */
  const js = read('assets', 'order-history', 'script.js');
  const at = js.indexOf("closest('#picker-quick-sale')");
  const handler = js.slice(at, at + 2000);

  assert.match(handler, /showErrorPopup/);
  assert.doesNotMatch(handler, /POSNIC\.popup\.tell/);
});

/* ------------------------------------------------------------- the version */

test('THE BUILD CAN BE READ WITHOUT SIGNING OUT', () => {
  const page = read('kot-management.html');
  assert.match(page, /id="app-version-line"/, 'the sheet does not say which build this is');
  assert.match(page, /app-build\.js/, 'the page never loads the stamp, so it can only say "dev"');

  const js = read('assets', 'kot', 'script.js');
  assert.match(js, /window\.POSNIC_BUILD/);
  assert.match(js, /'Captain ' \+ build\.version/);
});

test('and a desk build says dev rather than nothing', () => {
  /* app-build.js is written at build time and absent at a desk, where the
     honest answer is "dev". The onerror keeps a missing file from being a
     console error on every load. */
  assert.match(read('kot-management.html'), /onerror="this\.remove\(\)"/);
  assert.match(read('assets', 'kot', 'script.js'), /Captain dev build/);
});

test('the number card says what to do with it', () => {
  /*
   * Owner: "i add number card but no use? how to use it?" It said "The number
   * to type in Add item", which names a screen rather than an action.
   */
  const page = read('number-card.html');
  assert.match(page, /Stick it on the wall/);
  assert.match(page, /search box/, 'it still does not say where the number goes');
});
