'use strict';

const crypto = require('node:crypto');

/*
 * Per-shop secrets, sealed for the control database.
 *
 * The envelope must be exactly what upstream/pos/api/shard.js opens:
 *   v1:<iv hex>:<auth tag hex>:<ciphertext hex>, AES-256-GCM, keyed by
 *   TENANT_SECRET_KEY (64 hex chars).
 * A mismatch would not fail loudly at write time - the shard would refuse to
 * serve the shop - so the format is covered by a round-trip test against the
 * shard's own decryptSecret.
 */
const VERSION = 'v1';

function masterKey(raw = process.env.TENANT_SECRET_KEY) {
  if (!raw) throw new Error('TENANT_SECRET_KEY is not set');
  const key = Buffer.from(String(raw).trim(), 'hex');
  if (key.length !== 32) throw new Error('TENANT_SECRET_KEY must be 64 hex characters');
  return key;
}

function seal(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('hex'), cipher.getAuthTag().toString('hex'), ct.toString('hex')].join(':');
}

function open(blob, key) {
  const [version, iv, tag, ct] = String(blob).split(':');
  if (version !== VERSION) throw new Error(`unsupported secret envelope ${version}`);
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  d.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([d.update(Buffer.from(ct, 'hex')), d.final()]).toString('utf8');
}

/* The secrets upstream/pos/api/src/config/verify-secrets.js requires per shop. */
function generateTenantSecrets() {
  const hex = (n) => crypto.randomBytes(n).toString('hex');
  return { JWT_SECRET: hex(48), SESSION_SECRET: hex(48), ENCRYPTION_KEY: hex(32), KIOSK_API_KEY: hex(24) };
}

function sealAll(secrets, key) {
  return Object.fromEntries(Object.entries(secrets).map(([name, value]) => [name, seal(value, key)]));
}

module.exports = { masterKey, seal, open, sealAll, generateTenantSecrets };
