/*
 * The permissions a handset needs, and the merge that puts them there.
 *
 * Both platform projects are generated and gitignored: `cap add ios` and
 * `cap add android` rewrite them, so anything edited into a generated file is
 * lost on the next run. The declarations live in the repo and the build
 * scripts apply them, which is the only arrangement that survives.
 *
 * The failure mode is what makes this worth a test. A missing declaration is
 * NOT a build error. On iOS the app installs, launches, and is terminated by
 * the system the moment it reaches for the microphone; on Android the page
 * gets a bare permission denial. Both read as a bug in the voice code.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const IPA = read('build-ipa.js').replace(/\r\n/g, '\n');
const APK = read('build-apk.js');
const ADDITIONS = read('ios-templates', 'Info.plist.additions.xml');

/* splitPlistKeys, lifted out of the build script rather than copied, so this
   tests the function that actually runs. */
const splitPlistKeys = (() => {
  const start = IPA.indexOf('function splitPlistKeys');
  const source = IPA.slice(start, IPA.indexOf('\n}\n', start) + 3);
  return new Function(`${source}; return splitPlistKeys;`)();
})();

const body = ADDITIONS.slice(
  ADDITIONS.indexOf('<dict>') + '<dict>'.length,
  ADDITIONS.lastIndexOf('</dict>')
);

/** The merge as build-ipa.js performs it. */
function merge(plist, chunks) {
  const missing = chunks.filter(({ key }) => !plist.includes(`<key>${key}</key>`));
  if (!missing.length) return { plist, added: [] };
  const at = plist.indexOf('<dict>') + '<dict>'.length;
  return {
    plist: plist.slice(0, at) + missing.map((c) => c.text).join('') + plist.slice(at),
    added: missing.map((c) => c.key),
  };
}

const FRESH = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<plist version="1.0">',
  '<dict>',
  '\t<key>CFBundleName</key>',
  '\t<string>App</string>',
  '</dict>',
  '</plist>',
  '',
].join('\n');

/* ------------------------------------------------------------------ iOS */

test('iOS is told about every device the app touches', () => {
  for (const key of [
    'NSLocalNetworkUsageDescription', // finding the till on the Wi-Fi
    'NSCameraUsageDescription', // scanning the shop's code
    'NSMicrophoneUsageDescription', // saying the order
    'NSSpeechRecognitionUsageDescription', // and the handset transcribing it
  ]) {
    assert.ok(ADDITIONS.includes(`<key>${key}</key>`), `${key} is not declared`);
  }
});

test('every declaration carries a sentence, because the user is shown it', () => {
  for (const chunk of splitPlistKeys(body)) {
    if (!chunk.key.endsWith('UsageDescription')) continue;
    const sentence = chunk.text.match(/<string>([^<]+)<\/string>/);
    assert.ok(sentence, `${chunk.key} has no explanation`);
    assert.ok(sentence[1].length > 40, `${chunk.key} explains too little to be useful`);
  }
});

test('splitting keeps a dict or array value with the key that owns it', () => {
  /* NSAppTransportSecurity and NSBonjourServices are both key-then-container.
     Splitting on every <key> tears their contents loose and produces a plist
     Xcode refuses to read. */
  const chunks = splitPlistKeys(body);
  const ats = chunks.find((c) => c.key === 'NSAppTransportSecurity');
  assert.ok(ats.text.includes('NSAllowsLocalNetworking'));
  const bonjour = chunks.find((c) => c.key === 'NSBonjourServices');
  assert.ok(bonjour.text.includes('_http._tcp'));
});

test('splitting loses nothing', () => {
  const chunks = splitPlistKeys(body);
  assert.equal(chunks.map((c) => c.text).join('').trim(), body.trim());
});

test('a fresh project gets all of it', () => {
  const { added } = merge(FRESH, splitPlistKeys(body));
  assert.equal(added.length, splitPlistKeys(body).length);
});

test('a project built BEFORE a key existed still gets that key', () => {
  /*
   * The bug this replaced: the merge returned early if ONE sentinel key was
   * already present, so a machine with an ios/ folder from an earlier build
   * kept its old plist and silently missed every declaration added since.
   * `cap add ios` only runs when ios/ is absent, so that machine never
   * recovers on its own.
   */
  const chunks = splitPlistKeys(body);
  const beforeVoice = chunks.filter((c) => !/^(NSMicrophone|NSSpeech)/.test(c.key));
  const old = merge(FRESH, beforeVoice).plist;

  const { added } = merge(old, chunks);
  assert.deepEqual(added, ['NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription']);
});

test('merging twice changes nothing', () => {
  const chunks = splitPlistKeys(body);
  const once = merge(FRESH, chunks).plist;
  assert.deepEqual(merge(once, chunks).added, []);
  assert.equal(merge(once, chunks).plist, once);
});

/* -------------------------------------------------------------- Android */

test('Android is told about the microphone, and about its companion', () => {
  /* Capacitor's WebView launches RECORD_AUDIO and MODIFY_AUDIO_SETTINGS
     together for getUserMedia({audio}); an undeclared one fails the whole
     request, and the page sees a plain denial with nothing to explain it. */
  assert.match(APK, /android\.permission\.RECORD_AUDIO/);
  assert.match(APK, /android\.permission\.MODIFY_AUDIO_SETTINGS/);
});

test('neither camera nor microphone is REQUIRED to install', () => {
  /* A handset without one still takes orders by hand; the button is absent. */
  for (const feature of ['android.hardware.camera', 'android.hardware.microphone']) {
    const line = APK.split('\n').find((l) => l.includes(feature));
    assert.ok(line, `${feature} is not declared`);
    assert.match(line, /required="false"/);
  }
});

test('the net stack can see the network it is using', () => {
  /* Chromium's NetworkChangeNotifier watches connectivity through this. Not
     required to open a socket, and its absence is quiet - the WebView simply
     never learns what kind of connection the device has. */
  assert.match(APK, /ACCESS_NETWORK_STATE/);
});

test('the native HTTP bridge is OFF', () => {
  /*
   * Capacitor's HTTP plugin does not merely patch window.fetch - it
   * intercepts at the native WebViewClient, which reaches every frame and
   * every transport. On a real handset against a real server, fetch, an
   * unpatched fetch from a fresh iframe, and XMLHttpRequest ALL timed out on
   * an address Chrome on the same phone loaded instantly. Three independent
   * transports do not fail together by coincidence; something underneath all
   * three was holding them.
   *
   * It is not needed. The server sends CORS headers for the app's own origins
   * - http://localhost, capacitor://localhost, https://localhost - which is
   * the only thing the bridge was buying.
   */
  const config = JSON.parse(
    fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8')
  );
  assert.equal(config.plugins.CapacitorHttp.enabled, false);
});

test('the keyboard can appear, and the page moves out of its way', () => {
  /*
   * Capacitor's generated manifest sets no windowSoftInputMode, which leaves
   * the system to choose for a full-screen WebView - and what it chooses does
   * not reliably raise the IME or resize around it. A waiter taps the address
   * box, nothing happens, and the app looks broken. That was reported from a
   * real handset after scanning a pairing code.
   */
  assert.match(APK, /windowSoftInputMode/);
  assert.match(APK, /adjustResize/);
});

test('the Android permissions are added only when absent', () => {
  /* Run on a project that already has them, the injection must not double
     them: two identical <uses-permission> lines is a manifest merger error. */
  assert.match(APK, /if \(!manifest\.includes\('android\.permission\.RECORD_AUDIO'\)\)/);
  assert.match(APK, /if \(!manifest\.includes\('android\.permission\.CAMERA'\)\)/);
});
