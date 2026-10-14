'use strict';

const { fail } = require('./errors');

/*
 * JSON over HTTPS with the rules every payment transport needs:
 *   - no automatic retry. A timeout on "create payment" does not mean nothing
 *     was created, and retrying blindly is how a customer pays twice;
 *   - redirects are refused, so a misconfigured base URL cannot forward
 *     credentials to another host;
 *   - provider bodies are never copied into the error message (they can carry
 *     account numbers and keys echoed back), only into `details` for callers
 *     that choose to log them deliberately.
 */
async function requestJson(transport, url, { method = 'GET', headers = {}, body, timeoutMs = 15000, prefix = 'provider' } = {}) {
  let response;
  try {
    response = await transport(url, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
  } catch (cause) {
    fail(`${prefix}_outcome_unknown`, 502, { cause });
  }
  let data = null;
  const text = await response.text().catch(() => '');
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      fail(`${prefix}_response_invalid`, 502, { details: { httpStatus: response.status } });
    }
  }
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 ? `${prefix}_credentials_rejected` : `${prefix}_request_failed`;
    fail(code, 502, { details: { httpStatus: response.status, body: data } });
  }
  return data;
}

module.exports = { requestJson };
