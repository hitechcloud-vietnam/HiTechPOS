/*
 * The check a handset runs on itself - and the scoping mistake that made the
 * first emulator run silent.
 *
 * `root` is the UMD WRAPPER's parameter. The factory below it is called with
 * no arguments, so a reference to `root` inside the factory throws
 * ReferenceError. It did, on line 42, inside an uncaught promise - so the app
 * printed nothing at all and looked exactly like an app that had never
 * started. A whole round went into telling those apart.
 *
 * Every other file in assets/common uses globalThis inside its factory. This
 * one did not, and nothing said so until a real Android ran it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const commonDir = path.join(root, 'assets', 'common');

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const SelfTest = require(path.join(commonDir, 'self-test.js'));

/** A probe that answers however the test wants. */
function withProbe({ hit = null, failure = null, road = null, transport = 'node' } = {}) {
  const probe = async () => hit;
  probe.transport = () => transport;
  probe.lastFailure = failure;
  probe.usedRoad = road;
  globalThis.POSNIC = { discovery: { probe } };
  return probe;
}

test('the factory runs at all', async () => {
  /*
   * The regression. A ReferenceError in here is invisible: it throws inside a
   * promise, the app carries on looking normal, and the one line the whole
   * harness exists to produce is never printed.
   */
  withProbe({ hit: { base: 'https://shop.test/api', info: { edition: 'cloud' } } });
  await assert.doesNotReject(() => SelfTest.run('https://shop.test/api'));
});

test('UMD factories do not reference their sibling wrapper root parameter', () => {
  const {parse} = require('acorn');
  function walk(node, visit) {
    if (!node || typeof node !== 'object') return;
    if (node.type) visit(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => walk(child, visit));
      else if (value && typeof value === 'object') walk(value, visit);
    }
  }
  for (const name of fs.readdirSync(commonDir).filter(f => f.endsWith('.js'))) {
    const ast = parse(fs.readFileSync(path.join(commonDir,name),'utf8'), {ecmaVersion:'latest'});
    walk(ast, call => {
      if (call.type !== 'CallExpression' || call.callee.type !== 'FunctionExpression' ||
          !call.callee.params.some(p => p.name === 'factory')) return;
      for (const factory of call.arguments.filter(arg => arg.type === 'FunctionExpression' && !arg.params.some(p => p.name === 'root'))) {
        walk(factory.body, node => {
          assert.ok(!(node.type === 'MemberExpression' && node.object.type === 'Identifier' && node.object.name === 'root'), `${name} factory references wrapper-only root`);
        });
      }
    });
  }
});

test('the report carries the environment, not only the verdict', async () => {
  /* "It failed" and "it failed on this build, in this WebView, through this
     transport" are different reports, and only the second ends anything. */
  globalThis.POSNIC_BUILD = { version: '9.9.9', commit: 'deadbee' };
  withProbe({ failure: { reason: 'TIMED_OUT', message: 'hung' }, transport: 'native+patched-fetch' });

  const report = await SelfTest.run('https://shop.test/api');
  assert.equal(report.ok, false);
  assert.equal(report.build, '9.9.9');
  assert.equal(report.commit, 'deadbee');
  assert.equal(report.transport, 'native+patched-fetch');
  assert.equal(report.why.reason, 'TIMED_OUT');
  assert.equal(typeof report.seconds, 'number');
  delete globalThis.POSNIC_BUILD;
});

test('a success says which road carried it', async () => {
  withProbe({
    hit: { base: 'https://shop.test/api', info: { edition: 'cloud' } },
    road: 'clean-fetch',
  });
  const report = await SelfTest.run('https://shop.test/api');
  assert.equal(report.ok, true);
  assert.equal(report.edition, 'cloud');
  assert.equal(report.road, 'clean-fetch');
});

test('the answer is left where native code can read it back', async () => {
  /*
   * A WebView's console.log reaches logcat only if Capacitor's WebChromeClient
   * chooses to forward it. Leaving the report on the window lets the host pull
   * it with evaluateJavascript, which nothing can filter.
   */
  delete globalThis.__selftest;
  withProbe({ hit: { base: 'https://shop.test/api', info: { edition: 'cloud' } } });
  await SelfTest.run('https://shop.test/api');
  assert.equal(globalThis.__selftest.ok, true);
});

test('a probe that throws is still a report, not a silence', async () => {
  const probe = async () => {
    throw new Error('the bridge fell over');
  };
  probe.transport = () => 'node';
  globalThis.POSNIC = { discovery: { probe } };

  const report = await SelfTest.run('https://shop.test/api');
  assert.equal(report.ok, false);
  assert.match(report.threw, /bridge fell over/);
});

test('nothing runs unless the URL asks for it', async () => {
  /* It probes an address it was handed and changes nothing, but it should
     still not run on a waiter's phone because a page happened to load. */
  globalThis.location = { search: '', origin: 'http://localhost' };
  assert.equal(await SelfTest.fromLocation(), null);

  globalThis.location = { search: '?selftest=https://shop.test/api', origin: 'http://localhost' };
  withProbe({ hit: { base: 'https://shop.test/api', info: { edition: 'cloud' } } });
  const report = await SelfTest.fromLocation();
  assert.equal(report.ok, true);
  delete globalThis.location;
});

test('the tag is the one the device check greps for', () => {
  /*
   * This used to read the CI workflow. The workflow is gone - the device check
   * runs on a phone plugged into whoever is working, not on a server - so the
   * question moved with it: the script that reads the log has to grep for the
   * tag the app actually prints, or it waits forty times three seconds and
   * reports a silence that never happened.
   */
  const script = fs.readFileSync(path.join(root, 'scripts', 'device-check.js'), 'utf8');
  assert.ok(script.includes(SelfTest.TAG), 'the device check greps for a different tag');

  const activity = fs.readFileSync(
    path.join(root, 'android-templates', 'MainActivity.java'),
    'utf8'
  );
  assert.ok(activity.includes(SelfTest.TAG), 'the host logs under a different tag');
});
