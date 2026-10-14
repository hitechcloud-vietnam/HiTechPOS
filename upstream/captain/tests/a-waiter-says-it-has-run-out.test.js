'use strict';

/*
 * "NO MORE FISH." SAID BY THE PERSON WHO HEARD IT.
 *
 * The kitchen tells the floor before it tells anybody with a keyboard. A
 * waiter who heard it had to find whoever runs the till, and in the minutes
 * that took, three more tables ordered it, three more tickets printed, and
 * three tables were told no after they had already chosen.
 *
 * This half sat written and unshipped for a while, and it is worth being
 * precise about why, because it is the same shape as the faults that cost a
 * shop its evening today: the handset code called `POSNIC.askRunOut(product)`
 * and **that function did not exist**. The guard above the call meant it
 * returned early and did nothing at all. A long press that silently does
 * nothing is worse than no long press, because the waiter believes they have
 * told the shop and stops looking for somebody who can.
 *
 * So the sheet is tested here before any of it ships: what it asks, what it
 * answers, and the one distinction the caller cannot get wrong.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SHEET = fs.readFileSync(path.join(ROOT, 'assets', 'common', 'ask-run-out.js'), 'utf8');
const HANDSET = fs.readFileSync(path.join(ROOT, 'assets', 'products', 'script.js'), 'utf8');

/* ------------------------------------------------------- a fake little DOM */

function element(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    classes: new Set(),
    listeners: {},
    style: {},
    _text: '',
    id: '',
    set textContent(value) {
      this._text = String(value);
    },
    get textContent() {
      return this._text;
    },
    set innerHTML(html) {
      this._html = html;
      /* Enough of a parse for this sheet: it builds by id, and the test only
         ever asks for those. */
      (html.match(/id="([a-z-]+)"/g) || []).forEach((found) => {
        const id = found.slice(4, -1);
        const child = element('div');
        child.id = id;
        node.children.push(child);
      });
    },
    get innerHTML() {
      return this._html || '';
    },
    appendChild(child) {
      node.children.push(child);
      return child;
    },
    addEventListener(name, fn) {
      node.listeners[name] = fn;
    },
    classList: {
      add: (c) => node.classes.add(c),
      remove: (c) => node.classes.delete(c),
      contains: (c) => node.classes.has(c),
      toggle: (c, on) => (on ? node.classes.add(c) : node.classes.delete(c)),
    },
    querySelector(selector) {
      const id = String(selector).replace('#', '');
      return node.children.find((c) => c.id === id) || null;
    },
  };
  return node;
}

/** The sheet, loaded into a fake page, with a handle on what it drew. */
function openSheet() {
  const byId = new Map();
  const head = element('head');
  const body = element('body');

  const document = {
    createElement: element,
    head,
    body,
    getElementById: (id) => byId.get(id) || null,
  };

  /* Whatever the sheet appends becomes findable, ids and all, the way a real
     document would make it. */
  const remember = (node) => {
    if (node.id) byId.set(node.id, node);
    node.children.forEach(remember);
  };
  const realAppend = body.appendChild;
  body.appendChild = (child) => {
    realAppend(child);
    remember(child);
    return child;
  };
  head.appendChild = (child) => {
    if (child.id) byId.set(child.id, child);
    return child;
  };

  const sandbox = { document, Promise, String, Boolean, Object, console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(SHEET, sandbox);

  return {
    ask: sandbox.POSNIC.askRunOut,
    at: (id) => byId.get(id),
    press: (id) => byId.get(id).listeners.click({ target: byId.get(id) }),
    tapOutside: () => {
      const scrim = byId.get('ask-run-out-scrim');
      scrim.listeners.click({ target: scrim });
    },
  };
}

const FISH = { name: 'Seer Fish', sold_out_today: false };
const GONE = { name: 'Seer Fish', sold_out_today: true };

/* ------------------------------------------------------------- it exists */

test('THE SHEET THE HANDSET CALLS ACTUALLY EXISTS', () => {
  /*
   * The whole reason this was not shipped. The handset guards on
   * `!POSNIC.askRunOut` and returns, so a missing sheet is a long press that
   * silently does nothing - and the waiter believes they have told the shop.
   */
  assert.match(HANDSET, /POSNIC\.askRunOut\(/, 'the handset no longer asks');

  const sheet = openSheet();
  assert.strictEqual(typeof sheet.ask, 'function', 'POSNIC.askRunOut is not defined');
});

test('and every screen that can long press has loaded it', () => {
  for (const page of ['products.html', 'kot-management.html', 'order-history.html']) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    assert.match(
      html,
      /assets\/common\/ask-run-out\.js/,
      `${page} offers the gesture without the sheet that answers it`
    );
  }
});

/* ---------------------------------------------------------- what it asks */

test('IT NAMES THE DISH, because the risk is taking the wrong one off', () => {
  const sheet = openSheet();
  sheet.ask(FISH);

  assert.strictEqual(sheet.at('ask-run-out-dish').textContent, 'Seer Fish');
});

test('the button says what will happen, not OK', () => {
  const sheet = openSheet();
  sheet.ask(FISH);

  assert.strictEqual(sheet.at('ask-run-out-ok').textContent, 'It has run out');
});

test('IT SAYS FOR HOW LONG, because sold out with no horizon is never used', () => {
  /*
   * The till records the day, not a stock level, so tomorrow starts clean
   * without anybody remembering to undo this. A shop that does not know that
   * is a shop afraid to touch the button.
   */
  const sheet = openSheet();
  sheet.ask(FISH);

  assert.match(sheet.at('ask-run-out-why').textContent, /rest of today/);
  assert.match(sheet.at('ask-run-out-why').textContent, /tomorrow/);
});

test('A DISH ALREADY OFF IS ASKED THE OPPOSITE QUESTION', () => {
  /*
   * Same gesture, because a waiter who took the wrong dish off needs the way
   * back to be the thing they already know.
   */
  const sheet = openSheet();
  sheet.ask(GONE);

  assert.strictEqual(sheet.at('ask-run-out-ok').textContent, 'Put back on');
  assert.match(sheet.at('ask-run-out-why').textContent, /order it again/);
});

test('a dish with no name is still something you can answer about', () => {
  const sheet = openSheet();
  sheet.ask({});

  assert.strictEqual(sheet.at('ask-run-out-dish').textContent, 'This dish');
});

/* -------------------------------------------------------- what it answers */

test('SAYING IT HAS RUN OUT ANSWERS TRUE', async () => {
  const sheet = openSheet();
  const answer = sheet.ask(FISH);
  sheet.press('ask-run-out-ok');

  assert.strictEqual(await answer, true);
});

test('AND PUTTING IT BACK ANSWERS FALSE, which is not the same as backing out', async () => {
  /*
   * The one distinction the caller cannot get wrong. `false` is a real answer
   * here and `null` means they changed their mind, so nothing downstream may
   * test this for truthiness.
   */
  const sheet = openSheet();
  const answer = sheet.ask(GONE);
  sheet.press('ask-run-out-ok');

  assert.strictEqual(await answer, false);
});

test('backing out answers null, and changes nothing', async () => {
  const sheet = openSheet();
  const answer = sheet.ask(FISH);
  sheet.press('ask-run-out-cancel');

  assert.strictEqual(await answer, null);
});

test('tapping the dark outside backs out too', async () => {
  const sheet = openSheet();
  const answer = sheet.ask(FISH);
  sheet.tapOutside();

  assert.strictEqual(await answer, null);
});

test('the handset treats null as "they said nothing", not as "put it back"', () => {
  /*
   * `if (!answer) return` would turn every "put it back on" into a cancel and
   * the dish would stay off the menu for ever, which is the bug this shape
   * invites.
   */
  const asked = HANDSET.slice(HANDSET.indexOf('POSNIC.askRunOut('));
  const guard = asked.slice(0, 200);

  assert.match(guard, /answer === null/, 'the handset tests the answer for truthiness');
});

test('A SECOND QUESTION DOES NOT STRAND THE FIRST', async () => {
  /*
   * Two long presses in a row. Without this the first promise is never
   * settled, and whatever was awaiting it waits for the rest of the shift.
   */
  const sheet = openSheet();
  const first = sheet.ask(FISH);
  sheet.ask(GONE);

  assert.strictEqual(await first, null);
});

test('the sheet closes itself once it has an answer', async () => {
  const sheet = openSheet();
  const answer = sheet.ask(FISH);
  assert.ok(sheet.at('ask-run-out-scrim').classList.contains('is-open'), 'it never opened');

  sheet.press('ask-run-out-ok');
  await answer;

  assert.ok(!sheet.at('ask-run-out-scrim').classList.contains('is-open'), 'it stayed open');
});

/* ------------------------------------------------------------ the gesture */

test('THE LONG PRESS DOES NOT FIGHT THE TAP THAT ADDS A DISH', () => {
  /*
   * Held on the row, and never while a thumb is aimed at a control: the
   * stepper and ADD are taps, and a slow tap on them is still a tap.
   */
  assert.match(HANDSET, /closest\('button, input, a'\)/, 'a slow tap on ADD would open the sheet');
  assert.match(HANDSET, /held\s*=\s*true/, 'nothing records that a press became a hold');
});

test('and a press that became the sheet is not also a tap', () => {
  const normalized = HANDSET.replace(/\r\n/g, "\n");
  const click = normalized.slice(normalized.indexOf("document.addEventListener(\n        'click'"));

  assert.match(click.slice(0, 400), /stopPropagation/, 'the dish would be added as well');
});

test('the shop sees it immediately, not at the next sync', () => {
  /*
   * Every screen here draws from the cached menu, so it is updated before
   * anything is redrawn. The till confirms it on the next sync; this is so the
   * waiter who just said it sees it.
   */
  assert.match(HANDSET, /sold_out_today = answer/, 'the cached menu is not updated');
  /* saveOne, not saveData. saveData clears the store first, so this used to
     store the change by deleting every other dish on the handset. */
  assert.match(HANDSET, /saveOne\(STORE_NAME/, 'the change is not stored');
  assert.ok(
    !/saveData\(STORE_NAME,\s*\[stored\]/.test(HANDSET),
    'marking one dish sold out still wipes the menu'
  );
});

test('a refusal from the till is shown, not swallowed', () => {
  const asked = HANDSET.slice(HANDSET.indexOf('offerToTakeItOff'));

  assert.match(asked.slice(0, 2000), /showErrorPopup/, 'a failure would be silent');
});
