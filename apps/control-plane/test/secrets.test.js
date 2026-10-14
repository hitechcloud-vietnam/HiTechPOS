'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { seal, open, masterKey, generateTenantSecrets, sealAll } = require('../src/secrets');

/* Pull decryptSecret out of the vendored shard.js and run it, so a change on
   either side of the envelope breaks this test rather than a live shop. */
function shardDecrypt() {
  const src = fs.readFileSync(path.join(__dirname, '../../../upstream/pos/api/shard.js'), 'utf8');
  const pick = (re) => src.match(re)[0];
  const code = [
    pick(/const ALGORITHM = [^\n]+/), pick(/const VERSION = [^\n]+/),
    pick(/function decryptSecret\(blob, key\) \{[\s\S]*?\n\}/), 'decryptSecret;',
  ].join('\n');
  return vm.runInNewContext(code, { crypto, Buffer });
}

test('sealed secrets open with the upstream shard decryptSecret', () => {
  const key = masterKey('ab'.repeat(32));
  const secrets = generateTenantSecrets();
  const sealed = sealAll(secrets, key);
  const decrypt = shardDecrypt();
  for (const [name, value] of Object.entries(secrets)) {
    assert.equal(decrypt(sealed[name], key), value);
    assert.equal(open(sealed[name], key), value);
  }
  assert.deepEqual(Object.keys(secrets).sort(), ['ENCRYPTION_KEY', 'JWT_SECRET', 'KIOSK_API_KEY', 'SESSION_SECRET']);
});

test('tampered envelopes and bad keys are refused', () => {
  const key = masterKey('cd'.repeat(32));
  const blob = seal('x', key);
  const parts = blob.split(':');
  parts[3] = parts[3].replace(/^./, (c) => (c === '0' ? '1' : '0'));
  assert.throws(() => open(parts.join(':'), key));
  assert.throws(() => masterKey('abc'), /64 hex/);
  assert.throws(() => masterKey(''), /not set/);
});
