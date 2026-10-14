'use strict';

/*
 * One error type for every e-invoice provider, mirroring PaymentError in
 * @hitechpos/payment-core: callers branch on `code`, hosts answer with
 * `status`. Provider bodies only ever go into `details`, never `message`.
 *
 * Canonical codes:
 *   einvoice_invalid                 422  the canonical invoice failed validation
 *   einvoice_configuration_invalid   422  adapter misconfigured (missing credentials...)
 *   einvoice_not_supported           501  operation not implemented for this provider
 *   einvoice_outcome_unknown         502  issue sent, result unknown: reconcile via getStatus(refId)
 *   einvoice_rejected                502  provider refused the request (nothing issued)
 *   einvoice_duplicate               409  provider already holds an invoice for this refId
 *   einvoice_issue_in_progress       409  local guard: same refId is being issued right now
 *   einvoice_credentials_rejected    502  login failed / token refused
 *   einvoice_not_found               404  no invoice for that reference
 *   einvoice_unavailable             502  read call failed (network/timeout/5xx)
 *   einvoice_response_invalid        502  provider answered something we cannot parse
 */
class EInvoiceError extends Error {
  constructor(code, { status = 409, message, cause, details } = {}) {
    super(message || code, cause ? { cause } : undefined);
    this.name = 'EInvoiceError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, status, extra = {}) {
  throw new EInvoiceError(code, { status, ...extra });
}

function notSupported(provider, operation) {
  return fail('einvoice_not_supported', 501, {
    message: `Nhà cung cấp ${provider} chưa hỗ trợ thao tác "${operation}" qua API`,
    details: { provider, operation },
  });
}

module.exports = { EInvoiceError, fail, notSupported };
