'use strict';

/*
 * A PHONE SAYS WHAT IT IS, AND CAN BE TOLD TO STOP.
 *
 * Owner: "once logged in use jwt or proper app authendication system. map
 * device to cloud account."
 *
 * The first half was already true: the app posts a username and a password
 * once, is handed a bearer token, and presents that from then on. The
 * password is never stored on the phone.
 *
 * The second was not. This phone described itself on every ORDER it sent and
 * nowhere else, so the shop had a record of what a phone had DONE and no
 * record of the phone. Now the sign-in says it once, the till writes it down
 * against the account, and the shop can stop one handset without stopping the
 * other four.
 *
 * Which is the thing that makes a thirty day token safe to hand a part-time
 * waiter. A long credential is fine when it can be revoked and dangerous when
 * the only control is an expiry, because an expiry does nothing tonight.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const BOOT = read('assets', 'index', 'script.js');
const CONFIG = read('config.js');
const PAGE = read('index.html');

test('THE SIGN-IN SAYS WHAT THIS PHONE IS', () => {
  /*
   * At the one moment the shop can be sure whose phone it is. Anywhere else
   * and the till would be writing down a phone that has not proved anything.
   */
  const at = BOOT.indexOf('kioskMobileLogin');
  assert.ok(at > -1, 'the sign-in is gone');

  const call = BOOT.slice(at - 900, at + 300);
  assert.match(call, /POSNIC\.thisDevice && POSNIC\.thisDevice\.facts\(\)/);
  assert.match(call, /device,/, 'the facts are collected and then not sent');
});

test('and the page it signs in from actually loads that module', () => {
  /* A module nothing loads is the shape of half the faults found this week. */
  assert.match(PAGE, /assets\/common\/this-device\.js/);
});

test('A PHONE THAT CANNOT SAY STILL SIGNS IN', () => {
  /*
   * An older app sends nothing at all and the server treats both the same.
   * Nothing about signing in may depend on this: a waiter at a table with an
   * order to take does not care that the shop's handset list is a row short.
   */
  const at = BOOT.indexOf('POSNIC.thisDevice && POSNIC.thisDevice.facts()');
  assert.ok(at > -1);

  const around = BOOT.slice(at - 200, at + 200);
  assert.match(around, /try \{/, 'a phone that cannot describe itself cannot sign in');
  assert.match(around, /catch \(e\) \{/);
});

/* ------------------------------------------------------- turned off, not full */

test('A PHONE THE SHOP TURNED OFF IS TOLD THAT, not that the shop is full', () => {
  /*
   * Two different nos that send somebody to different places. Out of handset
   * slots is a licence and the shop fixes it on the till. A phone that has
   * been stopped is a decision somebody made about this handset, and the way
   * back is the shop's password. Telling a waiter holding a revoked phone to
   * free a slot sends them to a screen that cannot help them.
   */
  const at = CONFIG.indexOf("error.status === 403 && !path.includes('kioskMobileLogin')");
  assert.ok(at > -1, 'nothing reads a refusal any more');

  const handler = CONFIG.slice(at, at + 1800);
  assert.match(handler, /DEVICE_REVOKED/, 'both refusals still read as a full shop');
  assert.match(handler, /TILL_REFUSED/, 'the older, commoner refusal has been lost');
  assert.match(handler, /Sign in again with the shop password/);
});

test('the outage screen says which of the two it is', () => {
  const at = CONFIG.indexOf('if (refusedBy) {');
  assert.ok(at > -1, 'a refusal no longer reaches the screen');

  const screen = CONFIG.slice(at, at + 1200);
  assert.match(screen, /refusedBy\.code === 'DEVICE_REVOKED'/);
  assert.match(screen, /The shop has turned this phone off/);
  assert.match(screen, /run out of handset slots/, 'the slot wording was dropped');
});

test('and the code travels with the refusal, or the screen cannot tell them apart', () => {
  const at = CONFIG.indexOf("new CustomEvent('posnic:refused'");
  assert.ok(at > -1);
  assert.match(CONFIG.slice(at, at + 220), /code: error\.code/);
});

test('a refusal still does not sign anybody out', () => {
  /*
   * A 401 means the credential is no good and signing in again is the answer.
   * A 403 means the credential is fine, so throwing the waiter back to a
   * sign-in makes them type a password in order to be refused a second time.
   * This is the tempting wrong fix, and it stays wrong for DEVICE_REVOKED:
   * the phone is stopped at the till, not by its token.
   */
  const at = CONFIG.indexOf("error.status === 403 && !path.includes('kioskMobileLogin')");
  const handler = CONFIG.slice(at, at + 1800);
  assert.doesNotMatch(handler, /session\.end\(\)/);
});

/* ------------------------------------------------- the finding, behind the pad */

test('THE MENU LOADS WHILE THE PAD IS UP', () => {
  /*
   * Owner: "while doing this lock first background do all finding server
   * stuff."
   *
   * Four digits take a couple of seconds and the menu takes longer, and they
   * used to happen one after the other.
   */
  const at = BOOT.indexOf('let prefetch = null;');
  assert.ok(at > -1, 'nothing starts loading behind the lock');

  const started = BOOT.slice(at, at + 700);
  assert.match(started, /if \(locked && savedBranch/, 'it loads when there is no lock to hide behind');
  assert.match(started, /fetchAndStoreBranch\(savedBranch, false\)/);
});

test('WITHOUT THE REDIRECT, so nothing carries anybody past the pad', () => {
  /*
   * The whole point of the lock. A menu that arrives while somebody is still
   * proving they may hold this phone must not take them to the floor, so the
   * prefetch is told not to navigate and the trip happens after the unlock.
   */
  const at = BOOT.indexOf('let prefetch = null;');
  const started = BOOT.slice(at, at + 700);
  assert.doesNotMatch(
    started,
    /fetchAndStoreBranch\(savedBranch, true\)/,
    'the prefetch navigates, which walks straight past the lock it is hiding behind'
  );

  /* And the trip is downstream of the unlock. */
  const unlocked = BOOT.indexOf('await POSNIC.lock.unlock(');
  const trip = BOOT.indexOf("window.location.href = 'kot-management.html'");
  assert.ok(trip > unlocked, 'the floor is reached before the PIN is answered');
});

test('a prefetch that failed is not swallowed', () => {
  /*
   * It is caught where it starts, because nothing is awaiting it yet and an
   * unhandled rejection behind a lock screen is a red console on a phone
   * nobody is looking at. The failure is carried and thrown where somebody
   * can act on it, which is the same catch that handled it before.
   */
  const at = BOOT.indexOf('const failed = await prefetch;');
  assert.ok(at > -1, 'the prefetch result is never looked at');
  assert.match(BOOT.slice(at, at + 160), /if \(failed\) throw failed;/);
});
