'use strict';

/*
 * SAVING ONE DISH MUST NOT DELETE THE MENU.
 *
 * Owner: "i added one item and try to search other items add nothing listed.
 * some bug there."
 *
 * He was not describing a search bug. `saveData` clears the store before it
 * writes - which is exactly right for the door the whole menu arrives through,
 * "here is everything the API has" - and two callers were using it to save a
 * single dish.
 *
 * So adding a one-off item deleted every dish on the handset and left the one
 * row behind. Search was reporting that honestly: there was nothing else left
 * to find. The menu came back only on the next full sync, which is why it
 * looked intermittent.
 *
 * The second caller was worse and it was mine: the sold-out long press, which
 * shipped in v1.2.30. A waiter marking one dish as finished wiped every dish
 * on their handset, mid-service.
 *
 * Both are one word apart from correct, which is the whole problem: `saveData`
 * and `saveOne` do opposite things to everything you did not mention, and the
 * only sign of using the wrong one is a menu quietly going empty.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'indexedDB.js'), 'utf8');
const MENU = fs.readFileSync(path.join(ROOT, 'assets', 'products', 'script.js'), 'utf8');

/**
 * Just enough IndexedDB to tell a replace from a put.
 *
 * A real store, a real clear, a real put and a real delete. Nothing here cares
 * about indexes or cursors, because nothing under test does.
 */
function fakeDb(rows) {
  const store = new Map(rows.map((r) => [r.id, r]));

  const objectStore = {
    getAll() {
      const request = {};
      setTimeout(() => {
        request.result = [...store.values()];
        if (request.onsuccess) request.onsuccess();
      }, 0);
      return request;
    },
    put: (row) => store.set(row.id, row),
    delete: (id) => store.delete(id),
    clear: () => store.clear(),
  };

  return {
    store,
    transaction() {
      const tx = { objectStore: () => objectStore };
      setTimeout(() => {
        if (tx.oncomplete) tx.oncomplete();
      }, 5);
      return tx;
    },
  };
}

/** indexedDB.js far enough in to reach saveData and saveOne. */
function load(rows) {
  const db = fakeDb(rows);
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout,
    clearTimeout,
    Promise,
    Array,
    Object,
    JSON,
    Map,
    Set,
    String,
    Number,
    Boolean,
    Date,
    Math,
    Error,
    document: { getElementById: () => null, createElement: () => ({ style: {} }) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {},
    getDB: async () => db,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  /* Only the two functions are needed, and running the whole file would want a
     page. Lifted by name, which is how the rest of this suite does it. */
  const lift = (name) => {
    const at = SOURCE.indexOf(`async function ${name}(`);
    assert.ok(at > -1, `${name} is gone`);
    let depth = 0;
    let i = SOURCE.indexOf('{', at);
    const start = i;
    for (; i < SOURCE.length; i += 1) {
      if (SOURCE[i] === '{') depth += 1;
      else if (SOURCE[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    return SOURCE.slice(at, i + 1) + `\n;globalThis.${name} = ${name};`;
  };

  vm.runInContext(lift('saveOne'), sandbox);
  vm.runInContext(lift('saveData'), sandbox);
  return { db, sandbox };
}

const MENU_ROWS = [
  { id: 'a', name: 'Fish Curry' },
  { id: 'b', name: 'Chicken Biryani' },
  { id: 'c', name: 'Butter Naan' },
];

test('SAVING ONE DISH LEAVES THE REST OF THE MENU ALONE', async () => {
  const { db, sandbox } = load(MENU_ROWS);

  await sandbox.saveOne('products', [{ id: 'z', name: 'Fish' }]);

  assert.strictEqual(db.store.size, 4, 'the menu was not kept');
  assert.ok(db.store.has('a') && db.store.has('b') && db.store.has('c'), 'dishes were deleted');
  assert.strictEqual(db.store.get('z').name, 'Fish', 'the new dish was not saved');
});

test('and saving one that already exists updates it in place', () => {
  /* The sold-out long press: the same row back with one field changed. */
  const { db, sandbox } = load(MENU_ROWS);

  return sandbox.saveOne('products', [{ id: 'a', name: 'Fish Curry', sold_out_today: true }]).then(() => {
    assert.strictEqual(db.store.size, 3, 'a dish was added or lost');
    assert.strictEqual(db.store.get('a').sold_out_today, true);
    assert.ok(db.store.has('b'), 'the rest of the menu went with it');
  });
});

test('THE WHOLE-MENU DOOR STILL REPLACES, because that is what it is for', async () => {
  /*
   * saveData is not wrong, it is the sync. A dish the shop deleted has to
   * disappear from the handset, and that only works if the arriving list is
   * the whole truth.
   */
  const { db, sandbox } = load(MENU_ROWS);

  await sandbox.saveData('products', [{ id: 'a', name: 'Fish Curry' }]);

  assert.strictEqual(db.store.size, 1, 'the sync stopped replacing');
  assert.ok(!db.store.has('b'), 'a dish the shop removed survived');
});

test('NOTHING SAVES A SINGLE DISH THROUGH THE WHOLE-MENU DOOR', () => {
  /*
   * The actual regression guard. Both callers were one word from correct, and
   * the only sign of the wrong one is a menu quietly going empty - which a
   * waiter reports as "search is broken", three steps from the cause.
   */
  const wrong = [...MENU.matchAll(/saveData\(STORE_NAME,\s*\[/g)];

  assert.deepStrictEqual(
    wrong.map((m) => MENU.slice(Math.max(0, m.index - 60), m.index + 40).trim()),
    [],
    'saveData clears the store first. Use saveOne to save a dish without ' +
      'deleting the menu around it.'
  );
});

test('and the two doors are told apart by name, not by a flag', () => {
  /* A boolean argument would be forgotten in exactly the same way, and read as
     noise at the call site. */
  assert.match(SOURCE, /async function saveOne\(storeName, rows\)/);
  assert.ok(
    !/saveData\(storeName, newData, \w+\)/.test(SOURCE),
    'saveData grew an option instead of a second door'
  );
});
