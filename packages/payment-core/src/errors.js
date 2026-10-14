'use strict';

/*
 * One error type for every provider, so callers branch on `code` rather than
 * on provider-specific classes. `status` is the HTTP status a host should
 * answer with when the error escapes a request handler.
 */
class PaymentError extends Error {
  constructor(code, { status = 409, message, cause, details } = {}) {
    super(message || code, cause ? { cause } : undefined);
    this.name = 'PaymentError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, status, extra = {}) {
  throw new PaymentError(code, { status, ...extra });
}

module.exports = { PaymentError, fail };
