'use strict';

const crypto = require('node:crypto');
const { requestJson } = require('@hitechpos/payment-core');
const { EInvoiceError, fail } = require('./errors');

/*
 * HTTP + auth plumbing shared by the provider adapters.
 *
 * Rules (same as the payment adapters, see CLAUDE.md):
 *   - the transport is injected (`fetch`-compatible) so tests never hit the network;
 *   - requestJson never retries, never follows redirects and keeps provider
 *     bodies out of error messages;
 *   - an "issue" call is a mutation: a timeout, a 5xx or an unparsable body
 *     means the invoice MAY exist at the provider, so it surfaces as
 *     einvoice_outcome_unknown and must be reconciled with getStatus(refId),
 *     never retried blindly;
 *   - read calls may re-login once after a 401 (expired token); mutations never do.
 */

function toEInvoiceError(err, { provider, mutation }) {
  if (err instanceof EInvoiceError) return err;
  const code = typeof err.code === 'string' ? err.code : '';
  const httpStatus = err.details && err.details.httpStatus;
  const details = { provider, ...(httpStatus !== undefined ? { httpStatus } : {}) };
  if (err.details && err.details.body !== undefined) details.body = err.details.body;
  const make = (c, status, message) => new EInvoiceError(c, { status, message, cause: err, details });

  if (code.endsWith('_credentials_rejected')) {
    return make('einvoice_credentials_rejected', 502, `${provider}: thông tin đăng nhập hoặc token bị từ chối`);
  }
  if (code.endsWith('_outcome_unknown') || code.endsWith('_response_invalid')) {
    return mutation
      ? make('einvoice_outcome_unknown', 502, `${provider}: không xác định được kết quả, cần đối soát bằng getStatus`)
      : make(code.endsWith('_response_invalid') ? 'einvoice_response_invalid' : 'einvoice_unavailable', 502, `${provider}: không kết nối được`);
  }
  if (code.endsWith('_request_failed')) {
    if (mutation && (httpStatus === undefined || httpStatus >= 500 || httpStatus === 408 || httpStatus === 429)) {
      return make('einvoice_outcome_unknown', 502, `${provider}: lỗi máy chủ khi phát hành, cần đối soát bằng getStatus`);
    }
    if (httpStatus === 404 && !mutation) return make('einvoice_not_found', 404, `${provider}: không tìm thấy hoá đơn`);
    return mutation
      ? make('einvoice_rejected', 502, `${provider}: yêu cầu bị từ chối (HTTP ${httpStatus})`)
      : make('einvoice_unavailable', 502, `${provider}: yêu cầu thất bại (HTTP ${httpStatus})`);
  }
  return mutation
    ? make('einvoice_outcome_unknown', 502, `${provider}: lỗi không xác định khi phát hành`)
    : make('einvoice_unavailable', 502, `${provider}: lỗi không xác định`);
}

function isUnauthorized(err) {
  return Boolean(err) && (
    (err.code === 'einvoice_credentials_rejected' && err.details && err.details.httpStatus === 401)
    || err.unauthorized === true
  );
}

/* A provider-level "token invalid" signalled inside a 200 body. */
function unauthorizedError(provider, details) {
  const err = new EInvoiceError('einvoice_credentials_rejected', {
    status: 502, message: `${provider}: token hết hạn hoặc không hợp lệ`, details: { provider, httpStatus: 401, ...details },
  });
  err.unauthorized = true;
  return err;
}

function createHttp({ provider, transport, timeoutMs = 30000 }) {
  if (typeof transport !== 'function') fail('einvoice_configuration_invalid', 422, { message: 'transport (fetch) là bắt buộc' });
  return async function http(url, { method = 'POST', headers, body, mutation = false } = {}) {
    try {
      return await requestJson(transport, url, { method, headers, body, timeoutMs, prefix: provider });
    } catch (err) {
      throw toEInvoiceError(err, { provider, mutation });
    }
  };
}

/* Reads `exp` from a JWT without verifying it (only used to schedule refresh). */
function jwtExpiryMs(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/*
 * Token cache with expiry. `login()` resolves { token, expiresAt (ms) }.
 * Concurrent callers share one in-flight login.
 */
function createTokenCache({ login, now = Date.now, skewMs = 60000 }) {
  let current = null;
  let inflight = null;
  return {
    async get() {
      if (current && current.expiresAt - skewMs > now()) return current.token;
      if (!inflight) {
        inflight = Promise.resolve()
          .then(login)
          .then((result) => { current = result; return result.token; })
          .finally(() => { inflight = null; });
      }
      return inflight;
    },
    invalidate() { current = null; },
    peek: () => current,
  };
}

/*
 * Runs `fn(token)`. On 401: the cached token is dropped; read calls
 * (`retryOn401: true`) log in again and repeat once, mutations do not.
 */
async function withToken(cache, fn, { retryOn401 = false } = {}) {
  const token = await cache.get();
  try {
    return await fn(token);
  } catch (err) {
    if (!isUnauthorized(err)) throw err;
    cache.invalidate();
    if (!retryOn401) throw err;
    return fn(await cache.get());
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * Provider-side idempotency key derived from our refId. Providers expect a
 * GUID-like transaction id (Viettel transactionUuid, MISA RefID); a refId that
 * already is a UUID is used as-is, anything else maps deterministically to a
 * name-based (v5-style, SHA-1) UUID so a retry after a crash sends the same key.
 */
function transactionIdFor(refId) {
  const s = String(refId);
  if (UUID_RE.test(s)) return s.toLowerCase();
  const h = crypto.createHash('sha1').update(`hitechpos:einvoice:${s}`, 'utf8').digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/* Calendar parts of an instant in Vietnam time (UTC+7, no DST). */
function vnParts(iso) {
  const d = new Date(new Date(iso).getTime() + 7 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    year: String(d.getUTCFullYear()), month: pad(d.getUTCMonth() + 1), day: pad(d.getUTCDate()),
    hour: pad(d.getUTCHours()), minute: pad(d.getUTCMinutes()), second: pad(d.getUTCSeconds()),
  };
}

/* "YYYY-MM-DD" in Vietnam time. */
function vnDate(iso) {
  const p = vnParts(iso);
  return `${p.year}-${p.month}-${p.day}`;
}

function baseUrlFrom(config, defaults, provider) {
  const env = config.environment || 'sandbox';
  const url = config.baseUrl || defaults[env];
  if (!url) fail('einvoice_configuration_invalid', 422, { message: `${provider}: thiếu baseUrl cho môi trường ${env}` });
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol');
  } catch {
    fail('einvoice_configuration_invalid', 422, { message: `${provider}: baseUrl không hợp lệ` });
  }
  return String(url).replace(/\/+$/, '');
}

function requireString(value, name, provider) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('einvoice_configuration_invalid', 422, { message: `${provider}: thiếu cấu hình ${name}` });
  }
  return value.trim();
}

/* Some providers return arrays/objects JSON-encoded inside a string field. */
function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

module.exports = {
  toEInvoiceError, isUnauthorized, unauthorizedError, createHttp, jwtExpiryMs, createTokenCache, withToken,
  transactionIdFor, vnParts, vnDate, baseUrlFrom, requireString, parseMaybeJson,
};
