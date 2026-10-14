/*
 * ADDING TO AN EXISTING ORDER IS THE ORDERING SCREEN, NOT A LIST.
 *
 * Owner: "after order modify and add item from menu. its just showing only
 * menu. actually i want whole UI as same in new order search box, center menu
 * button with categories, efective search and list of items. so properly full
 * fledged add new item stuff."
 *
 * The first version of this sheet gave a category rail and rows and stopped
 * there. A waiter adding a second round to table four got no way to search and
 * no way past twenty-five categories except swiping the rail - while the
 * screen they use for a NEW order has both, two taps away.
 *
 * What makes it the same screen rather than a lookalike is that the rows are
 * drawn by MenuView and the results are ranked by ItemSearch - the two modules
 * the ordering screen itself uses. This file pins that, because a copy would
 * pass a screenshot review on the day it was written and drift by the month.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...bits) => fs.readFileSync(path.join(ROOT, ...bits), 'utf8');

const SCRIPT = read('assets', 'order-history', 'script.js');
const CSS = read('assets', 'order-history', 'style.css');
const PAGES = ['kot-management.html', 'order-history.html'];

/* ------------------------------------------------- the four parts exist */

for (const page of PAGES) {
  test(`${page}: the add-item sheet has a search box, a rail, a menu index and rows`, () => {
    const html = read(page);
    const at = html.indexOf('id="item-picker"');
    assert.notStrictEqual(at, -1, 'the sheet is gone');
    /* Scoped to the sheet: order-history.html still has the OLD hidden search
       box elsewhere for renderProductSuggestions, and matching that instead
       would make this test pass while the sheet had nothing in it. */
    const sheet = html.slice(at, html.indexOf('</div>\n\n    <!--', at) + 1 || html.length);

    assert.ok(sheet.includes('id="picker-search-input"'), 'no search box');
    assert.ok(sheet.includes('id="picker-search-clear"'), 'no way to clear the search');
    assert.ok(sheet.includes('id="item-picker-rail"'), 'no category rail');
    assert.ok(sheet.includes('id="picker-index-btn"'), 'no MENU button');
    assert.ok(sheet.includes('id="picker-index-list"'), 'the MENU button opens nothing');
    assert.ok(sheet.includes('id="item-picker-body"'), 'nowhere for the items');
  });

  test(`${page}: the sheet can reach the modules that draw and rank it`, () => {
    /* A sheet that calls MenuView on a page that never loaded it is a blank
       screen with an error in a console nobody has open. */
    const html = read(page);
    assert.match(html, /assets\/common\/menu-view\.js/, 'MenuView is not loaded');
    assert.match(html, /assets\/common\/item-search\.js/, 'ItemSearch is not loaded');
    assert.match(html, /assets\/products\/menu\.css/, 'the menu stylesheet is not loaded');
  });
}

/* ------------------------------------------------------ the same search */

test('the search is ItemSearch, the ordering screen’s own ranking', () => {
  /*
   * Not `includes`. ItemSearch ranks exact, prefix, word-start and initials,
   * so "cb" finds Chicken Biryani and "chick biry" finds it too - which is
   * what a waiter who sells it two hundred times a day actually types.
   */
  assert.match(SCRIPT, /ItemSearch\.search\(pickerIndex, term/,
    'the sheet has its own search instead of the one the ordering screen uses');
  assert.match(SCRIPT, /ItemSearch\.index\(products\)/,
    'the rows are handed to search unprepared, which throws the moment somebody types');
});

test('the ranking really does find a dish from its initials', () => {
  /* Through the real module, so this fails if the ranking is ever changed in
     a way that breaks the case this sheet was built for. */
  const ItemSearch = require(path.join(ROOT, 'assets', 'common', 'item-search.js'));
  const menu = [
    { id: '1', name: 'Chicken Biryani' },
    { id: '2', name: 'Chilli Bajji' },
    { id: '3', name: 'Plain Rice' },
  ];

  const indexed = ItemSearch.index(menu);
  const byInitials = ItemSearch.search(indexed, 'cb').map((i) => i.name);
  assert.ok(byInitials.includes('Chicken Biryani'), '"cb" does not find Chicken Biryani');
  assert.ok(!byInitials.includes('Plain Rice'), 'an unrelated dish came back');

  const byTwoWords = ItemSearch.search(indexed, 'chick biry').map((i) => i.name);
  assert.deepEqual(byTwoWords, ['Chicken Biryani'], '"chick biry" does not narrow to one');
});

test('typing is debounced, so the keyboard does not lag behind the thumb', () => {
  assert.match(SCRIPT, /clearTimeout\(pickerTyping\)/, 'every keystroke redraws the whole menu');
  assert.match(SCRIPT, /picker-search-input/, 'nothing listens to the box');
});

/* ------------------------------------------ what the two states look like */

test('searching hides the rail and the MENU button', () => {
  /*
   * A jump index over a result list is a lie about what you are moving
   * through. The ordering screen hides both while searching; so does this.
   */
  const from = SCRIPT.indexOf('function drawPicker(');
  assert.notStrictEqual(from, -1, 'drawPicker is gone');
  const body = SCRIPT.slice(from, SCRIPT.indexOf('\n}', from));

  assert.match(body, /rail\.hidden = true/, 'the rail stays up over search results');
  assert.match(body, /indexBtn\.hidden = true/, 'the MENU button stays up over search results');
  assert.match(CSS, /\.item-picker-rail\[hidden\]/, 'hiding the rail does nothing without the css');
});

test('an empty search is the whole menu again, in the shop’s own order', () => {
  const from = SCRIPT.indexOf('function drawPicker(');
  const body = SCRIPT.slice(from, SCRIPT.indexOf('\n}', from));
  assert.match(body, /if \(!term\)/, 'clearing the box does not bring the menu back');
  /*
   * The whole menu is still drawn - now after the shortcut strips rather than
   * on its own. The strips are a faster way in, not a replacement: somebody who
   * wants to read the card from the top must still be able to.
   */
  assert.match(body, /\.\.\.pickerMenu\]/, 'the sections are not redrawn under the shortcuts');
  assert.match(body, /pickerShortcuts\(pickerMenu, onTable\)/, 'the shortcuts are gone');
});

test('a search that finds nothing says so, rather than showing an empty screen', () => {
  const from = SCRIPT.indexOf('function drawPicker(');
  const body = SCRIPT.slice(from, SCRIPT.indexOf('\n}', from));
  assert.match(body, /MenuView\.nothing\(/, 'no result is a blank sheet');
  assert.match(body, /Nothing matches/, 'it does not say what found nothing');
});

/* ----------------------------------------------------------- the index */

test('the MENU sheet lists every category with a count', () => {
  assert.match(SCRIPT, /function pickerIndexRows\(/, 'there is no index to open');
  const from = SCRIPT.indexOf('function pickerIndexRows(');
  const body = SCRIPT.slice(from, SCRIPT.indexOf('\n}', from));
  assert.match(body, /section\.items\.length/, 'the categories carry no counts');
  assert.match(body, /data-category="/, 'tapping a row could not know where to go');
});

test('choosing a category from the index scrolls to it', () => {
  assert.match(SCRIPT, /function pickerGoTo\(/, 'nothing moves the sheet to a section');
  assert.match(SCRIPT, /pickerGoTo\(indexRow\.dataset\.category\)/,
    'the index rows are drawn but do nothing');
  assert.match(SCRIPT, /pickerGoTo\(chip\.dataset\.category\)/,
    'the rail and the index move the screen in two different ways');
});

/* -------------------------------------------------- and it still adds */

test('a dish tapped in a search result is added, not just in the full menu', () => {
  /*
   * The bug this would have had: items are looked up by id out of the drawn
   * menu, and a search result is drawn from the flat list. Both have to
   * resolve, or adding from a search silently does nothing.
   */
  assert.match(SCRIPT, /function pickerItem\(/, 'there is no lookup at all');
  const from = SCRIPT.indexOf('function pickerItem(');
  const body = SCRIPT.slice(from, SCRIPT.indexOf('\n}', from));
  assert.ok(/pickerAll|pickerMenu/.test(body), 'the lookup reads neither list');
});
