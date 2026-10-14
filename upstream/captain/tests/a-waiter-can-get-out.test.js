'use strict';

/*
 * A WAITER CAN GET OUT, AND CHANGING THE SERVER DOES NOT WALK OFF.
 *
 * Owner: "no way to change my password or logout? is the way to develop app?
 * no general stuff?" And, separately: "i clicked change server, and choose
 * another way. suddenly screen gone."
 *
 * Both are the same shape of fault: something ordinary that was almost there.
 *
 * SIGNING OUT existed and was reachable only on a shop with exactly ONE
 * branch, because the floor button is Change Branch otherwise and becomes Sign
 * Out only when there is nothing to change to. On a two-branch shop there was
 * no way out at all. It also cleared the menu, the tables and the cart and
 * left the bearer token in place - which now lasts thirty days.
 *
 * CHANGING THE SERVER sent the phone to the sign-in screen with a flag, the
 * editor opened sixty milliseconds later, and the branch auto-load underneath
 * finished and navigated straight back to the floor, behind a loader. From the
 * outside the screen vanished.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const FLOOR = read('kot-management.html');
const FLOOR_JS = read('assets', 'kot', 'script.js');
const BOOT = read('assets', 'index', 'script.js');

test('THERE IS A WAY OUT THAT DOES NOT DEPEND ON THE NUMBER OF BRANCHES', () => {
  assert.match(FLOOR, /id="sign-out"/, 'the only sign out is the one-branch button');
  assert.match(FLOOR_JS, /closest\('#sign-out'\)/, 'the button reaches nothing');
});

test('and it says whose account is on this phone', () => {
  /* A handset gets passed around; the first question is whose account it is
     carrying before somebody signs out of it. */
  assert.match(FLOOR, /id="signed-in-as"/);
  assert.match(FLOOR_JS, /Signed in as/);
});

test('SIGNING OUT DROPS THE CREDENTIAL, not just the menu', () => {
  /*
   * It cleared the branch, the cart and the cached menu and kept the token, so
   * the phone looked signed out and was not. With a thirty day credential that
   * is a phone anybody can pick up and carry on with.
   */
  const at = FLOOR_JS.indexOf('async function signOut()');
  assert.ok(at > -1, 'nothing signs out');

  assert.match(FLOOR_JS.slice(at,at+100), /CaptainAccount.change/);
  const body = fs.readFileSync(path.join(ROOT,'assets/common/account.js'),'utf8');
  assert.match(body,/await POSNIC\.session\.end\(\)/);
  assert.ok(body.indexOf('POSNIC.session.end()') < body.indexOf('clearKioskLocalCache('));

});

test('CHANGING THE SERVER IS NOT INTERRUPTED BY THE MENU LOADING', () => {
  /*
   * The auto-load has to stand aside for somebody who came here to change the
   * server, or it finishes, navigates to the floor, and takes the editor with
   * it.
   */
  assert.match(BOOT, /let changingServer = false;/, 'the boot never asks');
  assert.match(BOOT, /POSNIC\.net\.choosingServer\(\)/);

  const guards = BOOT.match(/&& !changingServer\) \{/g) || [];
  assert.strictEqual(
    guards.length,
    3,
    'both the prefetch and the auto-load must stand aside, found ' + guards.length
  );
});

test('and it reads a flag that is set in both places', () => {
  /*
   * The floor sets `posnic_change_server` and the editor sets
   * `posnic_editing_server` when it opens, and the first is cleared as soon as
   * it is read. Asking choosingServer() rather than one key means this does
   * not depend on which DOMContentLoaded handler ran first.
   */
  const config = read('config.js');
  const at = config.indexOf('function choosingServer()');
  assert.ok(at > -1);

  const body = config.slice(at, at + 400);
  assert.match(body, /posnic_change_server/);
  assert.match(body, /posnic_editing_server/);
});
