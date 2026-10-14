/*
 * A REQUEST THAT ARRIVES MAKES A NOISE.
 *
 * Owner: "then desktop app and captain mobile apps getting notification...
 * coz everytime its annoying people see waiters to turn back."
 *
 * The panel drew the call and counted it on a button, and said nothing. A
 * phone in an apron pocket showing a silent badge is the problem the call
 * button was built to solve, moved onto a smaller screen: somebody still has
 * to think to look, and the customer is still waiting while nobody does.
 *
 * The buzz matters more than the tone here. A handset lives in a pocket, in a
 * room with a blender running, and vibration is the half of this that gets
 * through cloth.
 */

const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Requests = require('../assets/common/requests.js');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'common', 'requests-ui.js'),
  'utf8'
);

/**
 * The panel, with an ear and a hand on it.
 *
 * `notes` counts oscillators, which is how the two patterns are told apart:
 * two notes is the brief chime, three is the longer one. `buzzes` collects
 * whatever was handed to navigator.vibrate.
 */
function load({ stored = {}, canBuzz = true, canHear = true } = {}) {
  const notes = [];
  const buzzes = [];
  // These tests exercise notifications after the user has enabled them.
  const store = { 'posnic.phone.sound': 'on', 'posnic.phone.vibration': 'on', ...stored };

  const context = {
    Requests,
    console,
    setInterval: () => 0,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
    },
    document: {
      readyState: 'loading',
      addEventListener() {},
      body: { appendChild() {} },
      createElement: () => ({ addEventListener() {}, style: {}, classList: { add() {} } }),
      getElementById: () => null,
    },
  };

  if (canBuzz) context.navigator = { vibrate: (pattern) => buzzes.push(pattern) };
  else context.navigator = {};

  if (canHear) {
    context.AudioContext = function () {
      this.currentTime = 0;
      this.state = 'running';
      this.destination = {};
      this.createOscillator = () => {
        notes.push(1);
        return { frequency: {}, connect() {}, start() {}, stop() {}, set type(v) {} };
      };
      this.createGain = () => ({
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
      });
    };
  }

  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/common/phone-preferences.js'), 'utf8'), context);
  vm.runInContext(SOURCE, context);
  return { ui: context.PosnicRequests, notes, buzzes, store };
}

const call = (over) => ({
  sale_id: 'c1',
  call_id: 'c1',
  destination: '7',
  created_date: new Date().toISOString(),
  items: [],
  ...over,
});

const cancellation = (over) => ({
  sale_id: 's1',
  cancel_requested: true,
  created_date: new Date().toISOString(),
  items: [{ name: 'Dosa', quantity: 1 }],
  ...over,
});

const newOrder = (over) => ({
  sale_id: 'n1',
  order_state: 'pending',
  created_date: new Date().toISOString(),
  items: [{ name: 'Dosa', quantity: 1 }],
  ...over,
});

/* -------------------------------------------------- something arrives */

test('a table calling makes a sound and a buzz', () => {
  const handset = load();
  handset.ui.saw([call()]);
  assert.ok(handset.notes.length > 0, 'the handset was silent');
  assert.strictEqual(handset.buzzes.length, 1, 'nothing was felt');
});

test('a call is the insistent pattern, a new order the brief one', () => {
  /*
   * A new order is information: the kitchen has it. A call is a person at a
   * table waiting for somebody, and one sound for both is how staff learn to
   * ignore the one that matters.
   */
  const ringing = load();
  ringing.ui.saw([call()]);
  const forACall = ringing.notes.length;

  const arriving = load();
  arriving.ui.saw([newOrder()]);
  const forAnOrder = arriving.notes.length;

  assert.ok(forACall > forAnOrder, 'a call sounds exactly like an ordinary new order');
  assert.ok(Array.isArray(ringing.buzzes[0]), 'a call buzzes once, like an order');
  assert.ok(!Array.isArray(arriving.buzzes[0]), 'an ordinary order buzzes three times');
});

test('said once, however many times the panel is redrawn', () => {
  const handset = load();
  handset.ui.saw([call()]);
  assert.strictEqual(handset.buzzes.length, 1);

  handset.ui.saw([call()]);
  handset.ui.saw([call()]);
  assert.strictEqual(handset.buzzes.length, 1, 'the same request was announced again');
});

test('the same table calling again later is news again', () => {
  /* Somebody went, the call left the queue, and table seven wants something
     else. Remembering it for ever would lose the second call. */
  const handset = load();
  handset.ui.saw([call()]);
  handset.ui.saw([]);
  handset.ui.saw([call({ sale_id: 'c2', call_id: 'c2' })]);
  assert.strictEqual(handset.buzzes.length, 2, 'the second call was swallowed');
});

test('one ring for a poll, however much arrived in it', () => {
  /* Three buzzes at once is not three times the information; it is a phone
     somebody silences for the shift. */
  const handset = load();
  handset.ui.saw([call(), cancellation(), newOrder()]);
  assert.strictEqual(handset.buzzes.length, 1);
});

/* ---------------------------------------- a waiter not taking calls */

test('muting silences the call and nothing else', () => {
  /*
   * THE LINE THAT MATTERS, and it now has a second half. A muted handset must
   * not buzz about a table; it must still buzz about a customer asking to
   * cancel, because that is a decision somebody has to make.
   */
  const quiet = load({ stored: { 'posnic.calls-muted': 'yes' } });
  quiet.ui.saw([call()]);
  assert.strictEqual(quiet.buzzes.length, 0, 'a muted handset buzzed about a table');
  assert.strictEqual(quiet.notes.length, 0, 'a muted handset rang about a table');

  quiet.ui.saw([call(), cancellation()]);
  assert.strictEqual(quiet.buzzes.length, 1, 'muting took the cancellation down with the call');
});

test('turning calls back on does not buzz about one that was already standing', () => {
  /*
   * Somebody un-muting has chosen to start hearing calls, not to be startled
   * by an old one. What is waiting is remembered even while it is hidden,
   * which is what makes the switch safe to flick.
   */
  const handset = load({ stored: { 'posnic.calls-muted': 'yes' } });
  handset.ui.saw([call()]);
  assert.strictEqual(handset.buzzes.length, 0);

  handset.ui.mute(false);
  assert.strictEqual(handset.buzzes.length, 0, 'un-muting buzzed about an old call');

  /* And a NEW call, now that it is listening again, is heard. */
  handset.ui.saw([call(), call({ sale_id: 'c9', call_id: 'c9', destination: '9' })]);
  assert.strictEqual(handset.buzzes.length, 1);
});

/* ------------------------------------------ devices that cannot do both */

test('a handset that cannot vibrate still rings', () => {
  /* iOS gives a WebView no navigator.vibrate. Half a notification beats none,
     and neither half may throw on the floor view. */
  const handset = load({ canBuzz: false });
  handset.ui.saw([call()]);
  assert.strictEqual(handset.buzzes.length, 0);
  assert.ok(handset.notes.length > 0, 'a device with no vibration went completely silent');
});

test('a handset with no audio still buzzes', () => {
  const handset = load({ canHear: false });
  handset.ui.saw([call()]);
  assert.strictEqual(handset.notes.length, 0);
  assert.strictEqual(handset.buzzes.length, 1, 'a device with no audio went completely silent');
});

test('the panel is still drawn when neither can be done', () => {
  const handset = load({ canBuzz: false, canHear: false });
  assert.doesNotThrow(() => handset.ui.saw([call()]));
});

/* --------------------------------------------------- and it is not an alarm */

test('the handset never repeats, because the till is the one that does', () => {
  /*
   * The till's alarm repeats because it stands on a counter nobody is facing.
   * A phone that keeps buzzing in a pocket is a phone somebody silences for
   * the shift - and the switch in this panel would then be taking the
   * cancellations down with the calls, which is exactly what it was written
   * not to do.
   */
  assert.ok(
    !/setInterval\([^)]*(buzz|tone|announce)/.test(SOURCE),
    'the handset was given a repeating alarm'
  );
  assert.match(SOURCE, /ONCE PER REQUEST, NEVER REPEATED/);
});

test('phone sound and vibration preferences silence alerts independently without dropping requests', () => {
  for (const [sound, vibration] of [[true,false],[false,true],[false,false]]) {
    const handset = load({stored:{'posnic.phone.sound':sound?'on':'off','posnic.phone.vibration':vibration?'on':'off'}});
    handset.ui.saw([call()]);
    assert.equal(handset.notes.length > 0, sound);
    assert.equal(handset.buzzes.length > 0, vibration);
    handset.store['posnic.phone.sound'] = 'on';
    handset.store['posnic.phone.vibration'] = 'on';
    const previous = [handset.notes.length, handset.buzzes.length];
    handset.ui.saw([call()]);
    assert.deepEqual([handset.notes.length, handset.buzzes.length], previous, 'unmuting must not replay old alerts');
    handset.ui.saw([call({sale_id:'new-call',call_id:'new-call'})]);
    assert.ok(handset.notes.length > previous[0]);
    assert.ok(handset.buzzes.length > previous[1]);
  }
});
