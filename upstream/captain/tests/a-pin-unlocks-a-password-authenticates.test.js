'use strict';

/*
 * A PIN UNLOCKS, A PASSWORD AUTHENTICATES.
 *
 * Owner: "username password not saved already. everytime i need to enter...
 * may we can register like one more native auth like face, fignerprint pincode
 * as per handset." Then, once the token was fixed: "remember the password and
 * have simple auth. i think we already have module of lock i think find that
 * re use."
 *
 * The till has one, called Till PIN Lock, and its rule is the line above. Its
 * PIN could not be shared: it lives in `pin-lock.json` on that machine,
 * encrypted with an install secret, and never leaves the main process. That is
 * the right call for a till and it means a handset needs its own.
 *
 * What it is NOT for is the typing. That was the token: a handset credential
 * lasted 24 hours, so a waiter who does not know the shop password needed a
 * manager at the start of every service. Fixed on the server; a phone now
 * stays signed in for thirty days.
 *
 * WHICH CREATES THE PROBLEM THIS SOLVES. A phone signed in for a month is a
 * phone anybody who picks it up can take orders on. The answer is not to ask
 * for the password again - that is where we started - it is four digits.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'assets', 'common', 'lock.js'), 'utf8');
const BOOT = fs.readFileSync(path.join(ROOT, 'assets', 'index', 'script.js'), 'utf8');

/** lock.js with a real hash and a real store, and no page. */
function load(storage) {
  const held = new Map(Object.entries(storage || {}));
  const sandbox = {
    console,
    crypto: require('crypto').webcrypto,
    TextEncoder,
    Uint8Array,
    Array,
    Math,
    Date,
    String,
    Number,
    JSON,
    RegExp,
    Promise,
    Object,
    setTimeout,
    localStorage: {
      getItem: (k) => (held.has(k) ? held.get(k) : null),
      setItem: (k, v) => held.set(k, String(v)),
      removeItem: (k) => held.delete(k),
    },
    document: {
      getElementById: () => null,
      createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }),
      head: { appendChild() {} },
      body: { appendChild() {} },
      querySelectorAll: () => [],
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return { lock: sandbox.POSNIC.lock, held };
}

test('A PHONE WITH NO PIN BEHAVES EXACTLY AS IT DID', async () => {
  /*
   * Off unless somebody turns it on. An update must never start demanding a
   * number nobody has been given, on a phone somebody is holding mid-service.
   */
  const { lock } = load();

  assert.strictEqual(lock.isSet(), false);
  assert.strictEqual(await lock.unlock('Anita'), true, 'a phone with no PIN was locked');
});

test('SETTING ONE STORES A HASH, never the number', async () => {
  /*
   * localStorage on a handset is not a secret store and this does not pretend
   * to be one. What it stops is the PIN being legible to anybody who glances
   * at the storage panel, and it costs four lines.
   */
  const { lock, held } = load();

  assert.strictEqual(await lock.set('1234'), true);

  const raw = held.get('posnic.lock');
  assert.ok(raw, 'nothing was stored');
  assert.ok(!raw.includes('1234'), 'the PIN itself is in storage');
  assert.match(raw, /"salt"/, 'no salt, so the same PIN hashes the same on every phone');
});

test('the right PIN opens it and a wrong one does not', async () => {
  const { lock } = load();
  await lock.set('1234');

  assert.strictEqual((await lock.check('1234')).ok, true);
  assert.strictEqual((await lock.check('9999')).ok, false);
});

test('a PIN that is not four digits is refused rather than stored', async () => {
  const { lock } = load();

  assert.strictEqual(await lock.set('123'), false);
  assert.strictEqual(await lock.set('12345'), false);
  assert.strictEqual(await lock.set('abcd'), false);
  assert.strictEqual(lock.isSet(), false, 'something was locked with a PIN nobody can type');
});

test('A GOOD TRY RESTORES THE COUNT', async () => {
  /* Somebody who fat-fingers one digit on Monday must not arrive at Friday
     with one try left. */
  const { lock } = load();
  await lock.set('1234');

  await lock.check('0000');
  await lock.check('0000');
  assert.strictEqual(lock.triesLeft(), 3);

  await lock.check('1234');
  assert.strictEqual(lock.triesLeft(), lock.TRIES);
});

test('RUNNING OUT FORGETS THE PIN rather than locking somebody out', async () => {
  /*
   * Not a lockout, which strands a waiter mid-service with a queue in front of
   * them. The PIN is forgotten and the password is asked for instead, which is
   * the thing that can actually get them back in.
   */
  const { lock } = load();
  await lock.set('1234');

  let said;
  for (let i = 0; i < lock.TRIES; i += 1) said = await lock.check('0000');

  assert.strictEqual(said.forgotten, true, 'it did not give up on the PIN');
  assert.strictEqual(lock.isSet(), false, 'the PIN survived being exhausted');
  assert.strictEqual(await lock.unlock('Anita'), true, 'the phone is still locked with no PIN');
});

test('and a phone that cannot store anything is not locked by accident', async () => {
  /* Private mode, or storage full. A lock that cannot be stored is not a lock,
     and pretending otherwise locks somebody out of a phone that was never
     really locked. */
  const { lock } = load();
  const sandboxStorageBroken = load();
  assert.strictEqual(typeof lock.set, 'function');
  assert.strictEqual(sandboxStorageBroken.lock.isSet(), false);
});

/* --------------------------------------------------------------- the boot */

test('THE LOCK ONLY ASKS WHEN THERE IS A SESSION TO RESUME', () => {
  /*
   * A PIN can only resume a session a password already established on this
   * phone. Asking with no session would be a gate in front of a sign-in
   * rather than a shortcut past it, and four digits cannot authenticate
   * anybody.
   *
   * Asserted as the rule and not as one line of source: this went red when
   * the same condition was given a name so that the menu could start loading
   * behind the pad, which changed nothing it protects.
   */
  const at = BOOT.indexOf('const locked =');
  assert.ok(at > -1, 'the boot never works out whether this phone is locked');

  const decided = BOOT.slice(at, at + 300);
  assert.match(decided, /POSNIC\.lock\.isSet\(\)/, 'it asks without a PIN being set');
  assert.match(decided, /POSNIC\.session\.active/, 'it asks without a session to resume');

  /* And the pad is only opened behind that decision. */
  const asks = BOOT.indexOf('await POSNIC.lock.unlock(');
  assert.ok(asks > at, 'the pad opens before anything has decided it should');
  assert.match(BOOT.slice(asks - 160, asks), /if \(locked && !changingServer\)/);
});

test('BACKING OUT DROPS TO THE PASSWORD, which is the thing that works', () => {
  const at = BOOT.indexOf('const opened = await POSNIC.lock.unlock');
  assert.ok(at > -1, 'the boot never asks');

  const after = BOOT.slice(at, at + 400);
  assert.match(after, /session\.end\(\)/, 'it leaves a session nobody unlocked');
  assert.match(after, /password/i, 'it does not say what to do instead');
});

test('NOTHING STANDS BETWEEN A SIGN-IN AND THE FLOOR', () => {
  /*
   * The offer to set a PIN used to be made here, after a sign-in that worked,
   * on the reasoning that it is the only moment somebody has proved they may
   * set one. The reasoning was sound and the placement was not: the pad is a
   * full screen that waits for an answer, so the sign-in waited too.
   *
   * 246 specs stopped at a keypad instead of reaching the floor, which is
   * exactly what a waiter would have done - signed in, been handed four
   * digits to think about, and not got to their table. It is offered from the
   * sheet on the floor screen instead, where somebody goes to it.
   */
  const at = BOOT.indexOf('kioskMobileLogin');
  assert.ok(at > -1, 'the sign-in is gone');

  const after = BOOT.slice(at, at + 3000);
  assert.doesNotMatch(
    after,
    /await POSNIC\.lock\.choose\(\)/,
    'the sign-in waits for a PIN pad again: nothing may stand between signing ' +
      'in and the floor, see the sheet on kot-management.html'
  );
});

test('the sign-in screen actually loads it', () => {
  /* A module nothing loads is the shape of half the faults found this week. */
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(page, /assets\/common\/lock\.js/);
});
/* ------------------------------------------------- reaching it afterwards */

const FLOOR = fs.readFileSync(path.join(ROOT, 'kot-management.html'), 'utf8');
const FLOOR_JS = fs.readFileSync(path.join(ROOT, 'assets', 'kot', 'script.js'), 'utf8');

test('THE PHONES ALREADY IN SERVICE CAN STILL GET ONE', () => {
  /*
   * The offer comes after a sign-in, because that is the only moment somebody
   * has proved they may set one. A handset now stays signed in for thirty
   * days, so on every phone in a shop today that offer is a month away.
   *
   * Without somewhere to go and ask, the feature would ship switched off for
   * a month, which is exactly how the kitchen announcement spent its life.
   */
  assert.match(FLOOR, /assets\/common\/lock\.js/, 'the floor screen cannot reach the lock');
  assert.match(FLOOR, /id="lock-set"/, 'nowhere to set a PIN from a phone that is already in');
  assert.match(FLOOR_JS, /POSNIC\.lock\.choose\(\)/, 'the button does not open the pad');
});

test('and the button says which of the two things it will do', () => {
  /* One button, two states. A waiter reading it at speed must not have to
     work out whether this phone is locked already. */
  assert.match(FLOOR_JS, /'Change the PIN' : 'Set a PIN'/);
  assert.match(FLOOR_JS, /paintLock\(\);\s*\n\s*sheet\.hidden = false;/, 'it never repaints');
});

test('TURNING IT OFF ASKS FOR THE PIN FIRST', () => {
  /*
   * Not to keep the holder out, since they are already past it, but so that a
   * phone cannot be handed back with the lock quietly gone.
   */
  const at = FLOOR_JS.indexOf("event.target.closest('#lock-off')");
  assert.ok(at > -1, 'the lock cannot be turned off');

  const handler = FLOOR_JS.slice(at, at + 800);
  assert.match(handler, /POSNIC\.lock\s*\n?\s*\.unlock\(/, 'it removes the PIN without asking');
  assert.match(handler, /if \(ok\) POSNIC\.lock\.clear\(\)/, 'a wrong PIN still removes the lock');
});

test('THE PAD SAYS WHICH QUESTION IT IS ASKING', () => {
  /*
   * One pad, three questions: open the app, choose a PIN, prove you may turn
   * it off. It used to keep whatever choose() had written on it, so a phone
   * that had just set a PIN was met with "Enter it again" the next morning,
   * and the way out of it always offered a password nobody had asked for.
   */
  const at = SOURCE.indexOf('function unlock(who, options)');
  assert.ok(at > -1, 'unlock cannot be told what it is asking for');

  const body = SOURCE.slice(at, at + 1400);
  assert.match(body, /posnic-lock-why'\)\.textContent =\s*\n?\s*\(options && options\.why\) \|\| 'Enter your PIN'/);
  assert.match(body, /posnic-lock-password'\)\.textContent =\s*\n?\s*\(options && options\.escape\)/);
});
