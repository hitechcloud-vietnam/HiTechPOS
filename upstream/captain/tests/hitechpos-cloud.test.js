const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const hitechpos = require('../scripts/hitechpos-config');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('config.js ships the HiTechPOS cloud defaults the build script knows', () => {
  const source = read('config.js');
  assert.match(source, /^\s*const CLOUD_SUFFIX = '\.hitechpos\.vn';$/m);
  assert.match(source, /^\s*const ACCOUNT_ORIGIN = 'https:\/\/app\.hitechpos\.vn';$/m);
  assert.deepEqual(hitechpos.resolve({}), { cloudSuffix: '.hitechpos.vn', accountOrigin: 'https://app.hitechpos.vn' });
  assert.equal(hitechpos.applyToConfig(source, hitechpos.resolve({})), source);
});

test('a build can point the app at another HiTechPOS cloud', () => {
  const settings = hitechpos.resolve({
    HITECHPOS_CLOUD_SUFFIX: '.Staging.HiTechPOS.vn',
    HITECHPOS_ACCOUNT_ORIGIN: 'https://app.staging.hitechpos.vn/',
  });
  assert.deepEqual(settings, { cloudSuffix: '.staging.hitechpos.vn', accountOrigin: 'https://app.staging.hitechpos.vn' });
  const built = hitechpos.applyToConfig(read('config.js'), settings);
  assert.match(built, /const CLOUD_SUFFIX = '\.staging\.hitechpos\.vn';/);
  assert.match(built, /const ACCOUNT_ORIGIN = 'https:\/\/app\.staging\.hitechpos\.vn';/);
  for (const file of ['android-templates/SecureSessionPlugin.java', 'ios-templates/CaptainPlugins.swift']) {
    const native = hitechpos.applyToNative(read(file), settings);
    assert.ok(native.includes('"app.staging.hitechpos.vn"'), file);
    assert.ok(!native.includes('"app.hitechpos.vn"'), file);
  }
});

test('nonsense cloud settings stop the build instead of shipping', () => {
  for (const env of [
    { HITECHPOS_CLOUD_SUFFIX: 'hitechpos.vn' },
    { HITECHPOS_CLOUD_SUFFIX: '.vn' },
    { HITECHPOS_CLOUD_SUFFIX: ".x.vn'; alert(1); '" },
    { HITECHPOS_ACCOUNT_ORIGIN: 'http://app.hitechpos.vn' },
    { HITECHPOS_ACCOUNT_ORIGIN: 'https://app.hitechpos.vn/login' },
    { HITECHPOS_ACCOUNT_ORIGIN: 'https://app.hitechpos.vn:8443' },
  ]) assert.throws(() => hitechpos.resolve(env), undefined, JSON.stringify(env));
});

test('the app identity is HiTechPOS Captain everywhere the build reads it', () => {
  const capacitor = JSON.parse(read('capacitor.config.json'));
  assert.equal(capacitor.appId, 'vn.hitechpos.captain');
  assert.equal(capacitor.appName, 'HiTechPOS Captain');
  for (const file of ['MainActivity.java', 'LocalNetworkPlugin.java', 'SecureSessionPlugin.java'])
    assert.match(read('android-templates/' + file), /^package vn\.hitechpos\.captain;/, file);
  assert.match(read('build-apk.js'), /android:scheme="\$\{appId\}" android:host="authorized"/);
  assert.match(read('scripts/native-check.js'), /java\/vn\/hitechpos\/captain\/MainActivity\.java/);
});
