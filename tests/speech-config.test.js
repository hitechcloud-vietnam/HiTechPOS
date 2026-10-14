/*
 * Where a transcription key is allowed to live.
 *
 * Not on a handset. A key in the app is a key on every waiter's phone, in a
 * file anybody can read, on devices that get lost and sold; it cannot be
 * rotated without reinstalling every one, and a leaked key is billed to the
 * shop until somebody notices.
 *
 * So the app refuses to hold one even if something hands it one. That is the
 * guard these tests exist for: a misconfigured or compromised server must not
 * be able to put a key into a pocket.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}
globalThis.localStorage = fakeStorage();

const Speech = require(path.join(__dirname, '..', 'assets', 'common', 'speech.js'));

test('a shop that configured nothing still gets something that works', () => {
  globalThis.localStorage.removeItem(Speech.STORE);
  const config = Speech.config();
  assert.equal(config.provider, 'device');
  assert.equal(config.language, 'en-IN');
});

test('the shop can choose the provider', () => {
  globalThis.localStorage.removeItem(Speech.STORE);
  assert.equal(Speech.config({ provider: 'server' }).provider, 'server');
  assert.equal(Speech.config({ provider: 'off' }).provider, 'off');
});

test('a key sent by a server is dropped, not stored', () => {
  globalThis.localStorage.removeItem(Speech.STORE);
  const config = Speech.config({ provider: 'server', apiKey: 'sk-secret', api_key: 'x', secret: 'y' });
  assert.equal(config.provider, 'server');
  assert.equal(config.apiKey, undefined, 'a key reached the handset');
  assert.equal(config.api_key, undefined);
  assert.equal(config.secret, undefined);
});

test('a key cannot be written into the device settings either', () => {
  globalThis.localStorage.removeItem(Speech.STORE);
  Speech.configure({ provider: 'server', apiKey: 'sk-secret' });
  const raw = globalThis.localStorage.getItem(Speech.STORE) || '';
  assert.ok(!raw.includes('sk-secret'), 'a key was written to device storage');
  assert.equal(Speech.config().apiKey, undefined);
});

test('this device overrides the shop, so one handset can be changed', () => {
  globalThis.localStorage.removeItem(Speech.STORE);
  Speech.configure({ provider: 'off' });
  assert.equal(Speech.config({ provider: 'server' }).provider, 'off');
});

test('voice turned off means no microphone at all', async () => {
  globalThis.localStorage.removeItem(Speech.STORE);
  assert.equal(await Speech.available({ provider: 'off' }), false);
});

test('asking whether this device can listen never throws', async () => {
  /* A screen has to be able to ask without a guard, and on a phone the answer
     needs a round trip to the native recogniser, which can fail. */
  globalThis.localStorage.removeItem(Speech.STORE);
  await assert.doesNotReject(() => Speech.available());
  assert.equal(typeof (await Speech.available()), 'boolean');
});

test('a browser with no recogniser is not offered the device path', async () => {
  /* The Web Speech API is NOT in the WebView an app is built on, on either
     platform. Answering yes on the strength of the setting alone draws a
     microphone button that a waiter discovers is dead at a table. */
  globalThis.localStorage.removeItem(Speech.STORE);
  assert.equal(Speech.deviceRecogniser(), null);
  assert.equal(Speech.nativeRecogniser(), null);
  assert.equal(await Speech.available({ provider: 'device' }), false);
});

test('the server path still needs a device that can RECORD', async () => {
  /*
   * The shop having configured a provider says nothing about this handset.
   * Answering yes on the strength of the setting alone draws a microphone
   * button on a device with no MediaRecorder, and the waiter finds that out
   * by pressing it at a table.
   */
  globalThis.localStorage.removeItem(Speech.STORE);
  assert.equal(Speech.canRecord(), false, 'node has no MediaRecorder; the test is meaningless');
  assert.equal(await Speech.available({ provider: 'server' }), false);

  /* defineProperty, not assignment: node exposes `navigator` as a read-only
     global, so `globalThis.navigator = ...` silently does nothing and the
     test would pass by measuring the wrong thing. */
  const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: {} },
  });
  globalThis.MediaRecorder = function () {};
  try {
    assert.equal(await Speech.available({ provider: 'server' }), true);
  } finally {
    if (real) Object.defineProperty(globalThis, 'navigator', real);
    else delete globalThis.navigator;
    delete globalThis.MediaRecorder;
  }
});

/*
 * THE RECOGNISER A PHONE ACTUALLY USES.
 *
 * The Web Speech API is not in the Android System WebView an app is built on,
 * and not in WKWebView either. A build that relies on it has a microphone
 * button at a desk and no microphone button on a single handset it ships to -
 * and worse on the half-supported device, where the call is accepted and the
 * promise never settles, which is a button held down for ever.
 *
 * So on a phone the recognition is native. These pin that it is reached, that
 * it is preferred over the browser API, and that nothing about it leaks into
 * the caller.
 */

/** A handset, with the Capacitor bridge and the plugin the way one has them. */
function onAPhone(plugin) {
  globalThis.Capacitor = {
    isNativePlatform: () => true,
    Plugins: { SpeechRecognition: plugin },
  };
}

const fakePlugin = (overrides = {}) => ({
  available: async () => ({ available: true }),
  requestPermissions: async () => ({ speechRecognition: 'granted' }),
  addListener: async () => ({ remove: async () => {} }),
  start: async () => ({}),
  stop: async () => {},
  ...overrides,
});

test('on a phone, the native recogniser is found through the bridge', async () => {
  onAPhone(fakePlugin());
  try {
    assert.notEqual(Speech.nativeRecogniser(), null);
    globalThis.localStorage.removeItem(Speech.STORE);
    assert.equal(await Speech.available({ provider: 'device' }), true);
  } finally {
    delete globalThis.Capacitor;
  }
});

test('a phone whose recogniser is missing says so, rather than pretending', async () => {
  /* A stripped Android build with no Google app has the plugin and nothing
     behind it. The plugin is the wrong thing to ask; its recogniser is. */
  onAPhone(fakePlugin({ available: async () => ({ available: false }) }));
  try {
    globalThis.localStorage.removeItem(Speech.STORE);
    assert.equal(await Speech.available({ provider: 'device' }), false);
  } finally {
    delete globalThis.Capacitor;
  }
});

test('a bridge that throws reads as "cannot listen", not as a crash', async () => {
  onAPhone(fakePlugin({ available: async () => { throw new Error('bridge gone'); } }));
  try {
    globalThis.localStorage.removeItem(Speech.STORE);
    assert.equal(await Speech.available({ provider: 'device' }), false);
  } finally {
    delete globalThis.Capacitor;
  }
});

test('registerPlugin is the other door in, for a classic script', async () => {
  /* These files are loaded by the page directly and cannot import the plugin
     package, so both ways the bridge exposes a native plugin are tried. */
  let asked = '';
  globalThis.Capacitor = {
    isNativePlatform: () => true,
    registerPlugin: (name) => {
      asked = name;
      return fakePlugin();
    },
  };
  try {
    assert.notEqual(Speech.nativeRecogniser(), null);
    assert.equal(asked, 'SpeechRecognition');
  } finally {
    delete globalThis.Capacitor;
  }
});

test('a browser is NOT a phone, whatever else is on the page', () => {
  globalThis.Capacitor = { isNativePlatform: () => false, Plugins: { SpeechRecognition: {} } };
  try {
    assert.equal(Speech.nativeRecogniser(), null);
  } finally {
    delete globalThis.Capacitor;
  }
});

test('the phone recogniser is held open and answers with what was said', async () => {
  const calls = [];
  let emit = null;
  onAPhone(
    fakePlugin({
      /* BY NAME. The session listens for two things now - the words, and the
         moment Android gives up on its own - and a fake that kept only the
         last handler silently delivered every partial to the wrong one. */
      addListener: async (name, fn) => {
        calls.push(`listen:${name}`);
        if (name === 'partialResults') emit = fn;
        return { remove: async () => calls.push('removed') };
      },
      start: async (options) => {
        calls.push(`start:${options.language}:${options.partialResults}:${options.popup}`);
        return {};
      },
      stop: async () => calls.push('stop'),
    })
  );
  try {
    globalThis.localStorage.removeItem(Speech.STORE);
    const partials = [];
    const session = Speech.start({ onPartial: (text) => partials.push(text) });

    /* Held open: nothing has been stopped just because start() returned. */
    await new Promise((resolve) => setTimeout(resolve, 0));
    emit({ matches: ['two chicken'] });
    emit({ matches: ['two chicken biryani and three coffee'] });

    assert.equal(await session.stop(), 'two chicken biryani and three coffee');
    /* Partials REPLACE rather than append - appending them would give
       "two chicken two chicken biryani and three coffee". */
    assert.deepEqual(partials, ['two chicken', 'two chicken biryani and three coffee']);
    assert.ok(calls.includes('start:en-IN:true:false'), calls.join(' '));
    assert.ok(calls.includes('stop'));
  } finally {
    delete globalThis.Capacitor;
  }
});

test('a cancelled phone recording answers with nothing', async () => {
  onAPhone(fakePlugin());
  try {
    globalThis.localStorage.removeItem(Speech.STORE);
    const session = Speech.start({});
    session.cancel();
    assert.equal(await session.stop(), '');
  } finally {
    delete globalThis.Capacitor;
  }
});

test('a refused microphone is named, so somebody can act on it', async () => {
  onAPhone(
    fakePlugin({ requestPermissions: async () => ({ speechRecognition: 'denied' }) })
  );
  try {
    globalThis.localStorage.removeItem(Speech.STORE);
    const session = Speech.start({});
    await assert.rejects(() => session.stop(), /blocked|Settings/i);
  } finally {
    delete globalThis.Capacitor;
  }
});

/*
 * WHAT THE SHOP DECIDED, AND WHAT THIS DEVICE DECIDED.
 *
 * Two different decisions with a deliberate precedence. A handset with a
 * broken microphone must be switchable off without touching the shop, and a
 * shop that moves to a paid provider must not have to visit every phone.
 *
 * The shop's answer is saved when the menu loads, so a handset that has gone
 * offline since still honours it - which is the whole reason it is read from
 * storage rather than passed in by whichever page happens to remember.
 */

test('the shop setting is honoured without anybody passing it in', () => {
  globalThis.localStorage.removeItem(Speech.STORE);
  globalThis.localStorage.setItem(
    Speech.SHOP_STORE,
    JSON.stringify({ provider: 'server', language: 'ta-IN' })
  );
  try {
    const config = Speech.config();
    assert.equal(config.provider, 'server');
    assert.equal(config.language, 'ta-IN');
  } finally {
    globalThis.localStorage.removeItem(Speech.SHOP_STORE);
  }
});

test('this device overrules the shop, so one handset can be switched off', () => {
  globalThis.localStorage.setItem(Speech.SHOP_STORE, JSON.stringify({ provider: 'server' }));
  Speech.configure({ provider: 'off' });
  try {
    assert.equal(Speech.config().provider, 'off');
  } finally {
    globalThis.localStorage.removeItem(Speech.SHOP_STORE);
    globalThis.localStorage.removeItem(Speech.STORE);
  }
});

test('a fresher answer passed in beats the one last saved', () => {
  globalThis.localStorage.removeItem(Speech.STORE);
  globalThis.localStorage.setItem(Speech.SHOP_STORE, JSON.stringify({ provider: 'device' }));
  try {
    assert.equal(Speech.config({ provider: 'server' }).provider, 'server');
  } finally {
    globalThis.localStorage.removeItem(Speech.SHOP_STORE);
  }
});

test('a shop that has said nothing still gets something that works', () => {
  globalThis.localStorage.removeItem(Speech.STORE);
  globalThis.localStorage.removeItem(Speech.SHOP_STORE);
  const config = Speech.config();
  assert.equal(config.provider, 'device');
  assert.equal(config.language, 'en-IN');
});

test('corrupt stored settings are ignored, not fatal', () => {
  globalThis.localStorage.removeItem(Speech.STORE);
  globalThis.localStorage.setItem(Speech.SHOP_STORE, 'not json at all');
  try {
    assert.equal(Speech.config().provider, 'device');
  } finally {
    globalThis.localStorage.removeItem(Speech.SHOP_STORE);
  }
});

test('a server cannot name its VENDOR to a handset either', () => {
  /*
   * Not just the key. A phone told which company transcribes for this shop is
   * a phone that will eventually be asked to hold the key for that company,
   * and telling one phone tells every phone in the building.
   */
  globalThis.localStorage.removeItem(Speech.STORE);
  const config = Speech.config({
    provider: 'server',
    vendor: 'openai',
    voice_provider: 'openai',
    apiKey: 'sk-secret',
  });
  assert.equal(config.provider, 'server');
  assert.equal(config.vendor, undefined, 'a vendor name reached the handset');
  assert.equal(config.voice_provider, undefined);
  assert.equal(config.apiKey, undefined);
});

test('a key in the SHOP store is dropped too, not only one passed in', () => {
  globalThis.localStorage.removeItem(Speech.STORE);
  globalThis.localStorage.setItem(
    Speech.SHOP_STORE,
    JSON.stringify({ provider: 'server', apiKey: 'sk-secret', api_key: 'x', secret: 'y' })
  );
  try {
    const config = Speech.config();
    assert.equal(config.apiKey, undefined, 'a key reached the handset from storage');
    assert.equal(config.api_key, undefined);
    assert.equal(config.secret, undefined);
  } finally {
    globalThis.localStorage.removeItem(Speech.SHOP_STORE);
  }
});

/* ------------------------------ a pause in the middle is not the end */

/*
 * Owner, from a handset: "first time talk it worked. after gap i talked second
 * time its not coverted. bottom stop button not worked."
 *
 * Android's SpeechRecognizer ENDS ITSELF after a pause in speech. That is its
 * normal behaviour, not a fault - and this session carried on believing it was
 * live, so a waiter who said a few dishes, thought, and carried on lost
 * everything after the pause. Then Stop appeared to do nothing, because
 * stopping an already-stopped recogniser is exactly the call that hangs and
 * there was no timeout anywhere on this path.
 */

/** A plugin that keeps its listeners apart and can be told to give up. */
function talkingPlugin(over = {}) {
  const listeners = {};
  const calls = [];
  const plugin = {
    calls,
    listeners,
    available: async () => ({ available: true }),
    requestPermissions: async () => ({ speechRecognition: 'granted' }),
    addListener: async (name, fn) => {
      listeners[name] = fn;
      return { remove: async () => calls.push(`removed:${name}`) };
    },
    start: async () => {
      calls.push('start');
    },
    stop: async () => {
      calls.push('stop');
    },
    ...over,
  };
  return plugin;
}

test('what was said before a pause is kept, and listening starts again', async () => {
  const plugin = talkingPlugin();
  onAPhone(plugin);
  try {
    globalThis.localStorage.removeItem(Speech.STORE);
    const session = Speech.start({});
    await new Promise((resolve) => setTimeout(resolve, 0));

    plugin.listeners.partialResults({ matches: ['two chicken biryani'] });
    /* Android gives up on the silence. */
    plugin.listeners.listeningState({ status: 'stopped' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    /* It opened again rather than sitting there believing it was live. */
    assert.equal(plugin.calls.filter((c) => c === 'start').length, 2, plugin.calls.join(' '));

    /* And the second half appends rather than replacing the first, because
       after a restart the partials begin again from nothing. */
    plugin.listeners.partialResults({ matches: ['and three coffee'] });
    assert.equal(await session.stop(), 'two chicken biryani and three coffee');
  } finally {
    delete globalThis.Capacitor;
  }
});

test('stop answers even when the recogniser never does', async () => {
  /*
   * THE STOP BUTTON THAT DID NOTHING. stop() on a recogniser that has already
   * ended itself can simply never come back, and this path had no timeout at
   * all - the browser path has had one since it was written. A waiter pressed
   * Stop and the screen sat there.
   */
  const plugin = talkingPlugin({
    stop: () => new Promise(() => {}),
  });
  onAPhone(plugin);
  try {
    globalThis.localStorage.removeItem(Speech.STORE);
    const session = Speech.start({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    plugin.listeners.partialResults({ matches: ['two coffee'] });

    const answered = await Promise.race([
      session.stop(),
      new Promise((resolve) => setTimeout(() => resolve('HUNG'), 4000)),
    ]);
    assert.equal(answered, 'two coffee', 'stop() hung on a plugin that never answers');
  } finally {
    delete globalThis.Capacitor;
  }
});

test('a recogniser that will not reopen is not restarted for ever', async () => {
  /* A restart loop on a handset is a flat battery and a hot phone. */
  let started = 0;
  const plugin = talkingPlugin({
    start: async () => {
      started += 1;
      if (started > 1) throw new Error('no');
    },
  });
  onAPhone(plugin);
  try {
    globalThis.localStorage.removeItem(Speech.STORE);
    const session = Speech.start({});
    await new Promise((resolve) => setTimeout(resolve, 0));

    for (let i = 0; i < 30; i++) {
      plugin.listeners.listeningState({ status: 'stopped' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.ok(started <= 12, `it tried to reopen ${started} times`);
    await session.stop();
  } finally {
    delete globalThis.Capacitor;
  }
});
