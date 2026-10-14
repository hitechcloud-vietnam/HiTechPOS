'use strict';

const { EInvoiceError, fail } = require('./errors');
const { EINVOICE_STATUS, refIdOf } = require('./provider');
const { transactionIdFor } = require('./transport');

/*
 * In-memory provider for development and tests. Numbers are sequential per
 * (templateCode + series), starting at 1, as a real provider would assign
 * them; issuing the same refId twice returns the first invoice (providers
 * de-duplicate on the transaction id).
 *
 * failNextIssue('unknown')  - stores the invoice, then throws einvoice_outcome_unknown
 *                             (simulates a timeout after the provider committed);
 * failNextIssue('lost')     - throws einvoice_outcome_unknown without storing;
 * failNextIssue('rejected') - throws einvoice_rejected without storing.
 */
function createMockProvider({ id = 'mock', now = () => new Date(), lookupBaseUrl = 'https://einvoice.example.invalid/tra-cuu' } = {}) {
  const counters = new Map();
  const byRef = new Map();
  const byId = new Map();
  let failure = null;
  const calls = { issue: 0, getStatus: 0, getPdf: 0, cancel: 0 };

  function find(ref) {
    if (ref && typeof ref === 'object' && ref.providerInvoiceId) return byId.get(ref.providerInvoiceId);
    return byRef.get(refIdOf(ref));
  }

  return {
    id,
    calls,
    invoices: () => [...byRef.values()].map((r) => ({ ...r })),
    failNextIssue(kind) { failure = kind; },
    async issue(invoice) {
      calls.issue += 1;
      if (!invoice || !invoice.refId || !invoice.totals) fail('einvoice_invalid', 422, { message: 'Cần hoá đơn đã chuẩn hoá bằng buildInvoice()' });
      const f = failure;
      failure = null;
      if (f === 'rejected') fail('einvoice_rejected', 502, { message: `${id}: từ chối (giả lập)`, details: { provider: id } });
      if (f === 'lost') fail('einvoice_outcome_unknown', 502, { message: `${id}: mất kết nối (giả lập)`, details: { provider: id } });
      const existing = byRef.get(invoice.refId);
      if (existing) return { ...existing };
      const key = invoice.templateCode + invoice.series;
      const n = (counters.get(key) || 0) + 1;
      counters.set(key, n);
      const transactionId = transactionIdFor(invoice.refId);
      const lookupCode = transactionId.replace(/-/g, '').slice(0, 12).toUpperCase();
      const result = {
        provider: id,
        refId: invoice.refId,
        transactionId,
        providerInvoiceId: `${id}-${key}-${n}`,
        invoiceNo: String(n),
        templateCode: invoice.templateCode,
        series: invoice.series,
        lookupCode,
        lookupUrl: `${lookupBaseUrl}?code=${lookupCode}`,
        taxAuthorityCode: invoice.withTaxAuthorityCode ? `M${invoice.series.slice(1, 3)}-${String(n).padStart(8, '0')}` : null,
        issuedAt: new Date(now()).toISOString(),
        status: EINVOICE_STATUS.ISSUED,
        total: invoice.totals.gross,
      };
      byRef.set(invoice.refId, result);
      byId.set(result.providerInvoiceId, result);
      if (f === 'unknown') {
        throw new EInvoiceError('einvoice_outcome_unknown', { status: 502, message: `${id}: hết thời gian chờ (giả lập)`, details: { provider: id } });
      }
      return { ...result };
    },
    async getStatus(ref) {
      calls.getStatus += 1;
      const found = find(ref);
      if (!found) return { provider: id, refId: refIdOf(ref) || null, status: EINVOICE_STATUS.NOT_FOUND };
      return { ...found };
    },
    async getPdf(ref) {
      calls.getPdf += 1;
      const found = find(ref);
      if (!found) fail('einvoice_not_found', 404, { message: 'Không tìm thấy hoá đơn' });
      return { pdf: Buffer.from(`%PDF-1.4\n% mock ${found.templateCode}${found.series} ${found.invoiceNo}\n`), fileName: `${found.templateCode}${found.series}-${found.invoiceNo}.pdf` };
    },
    async cancel(ref, reason) {
      calls.cancel += 1;
      const found = find(ref);
      if (!found) fail('einvoice_not_found', 404, { message: 'Không tìm thấy hoá đơn' });
      if (!reason) fail('einvoice_invalid', 422, { message: 'Cần lý do huỷ' });
      found.status = EINVOICE_STATUS.CANCELLED;
      return { ...found };
    },
  };
}

module.exports = { createMockProvider };
