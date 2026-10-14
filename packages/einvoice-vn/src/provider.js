'use strict';

const { EInvoiceError, fail } = require('./errors');

/*
 * The contract an e-invoice provider adapter implements. The host (POS
 * shard) owns the sale, permissions and the durable record of what was
 * issued; an adapter only translates one canonical invoice (see invoice.js,
 * built with buildInvoice) to and from one provider.
 *
 *   id: string
 *   issue(invoice) -> IssueResult
 *     Creates, signs and publishes. NEVER retried automatically: on
 *     einvoice_outcome_unknown the host must call getStatus(invoice.refId)
 *     before trying again (the adapters send a stable provider-side key
 *     derived from refId, so a reconciled retry cannot double-issue at
 *     providers that de-duplicate on it).
 *   getStatus(ref, options?) -> IssueResult (status 'not_found' when absent)
 *     ref: { refId } | { providerInvoiceId } | string (refId)
 *   getPdf?(ref, options?) -> { pdf: Buffer, fileName? } | { url }
 *   cancel?(ref, reason) / replace?(ref, invoice) / adjust?(ref, invoice)
 *     Optional; adapters that cannot do it throw einvoice_not_supported.
 *
 * IssueResult: { provider, refId, transactionId, providerInvoiceId, invoiceNo,
 *                templateCode, series, lookupCode?, lookupUrl?, taxAuthorityCode?,
 *                issuedAt, status, raw? }
 */
const EINVOICE_STATUS = Object.freeze({
  DRAFT: 'draft',
  PENDING: 'pending', // accepted by provider, awaiting signature / CQT code
  ISSUED: 'issued', // published (and coded by CQT for "C" series)
  REJECTED: 'rejected', // refused by provider or CQT
  CANCELLED: 'cancelled',
  REPLACED: 'replaced',
  ADJUSTED: 'adjusted',
  NOT_FOUND: 'not_found',
});

const REQUIRED = ['id', 'issue', 'getStatus'];

function assertProvider(provider) {
  for (const key of REQUIRED) {
    if (!provider || provider[key] === undefined) throw new TypeError(`einvoice provider is missing ${key}`);
  }
  if (typeof provider.issue !== 'function' || typeof provider.getStatus !== 'function') {
    throw new TypeError('einvoice provider issue/getStatus must be functions');
  }
  return provider;
}

function createEInvoiceRegistry(providers = []) {
  const byId = new Map();
  const registry = {
    register(provider) {
      assertProvider(provider);
      if (byId.has(provider.id)) throw new Error(`einvoice provider ${provider.id} is already registered`);
      byId.set(provider.id, provider);
      return registry;
    },
    get(id) {
      const provider = byId.get(id);
      if (!provider) throw new Error(`einvoice provider ${id} is not configured`);
      return provider;
    },
    has: (id) => byId.has(id),
    list: () => [...byId.keys()],
  };
  providers.forEach((p) => registry.register(p));
  return registry;
}

function refIdOf(ref) {
  return typeof ref === 'string' ? ref : ref && ref.refId;
}

/*
 * Local idempotency guard around a provider, keyed by refId.
 *
 *   - issued refId     -> returns the stored result, provider not called;
 *   - in-flight refId  -> einvoice_issue_in_progress (409);
 *   - unknown outcome  -> einvoice_outcome_unknown (409) until reconcile(refId)
 *                         has asked the provider what happened;
 *   - rejected/invalid -> nothing kept, a corrected invoice may be issued.
 *
 * `store` is { get, set, delete } (sync or async); the default is an in-memory
 * Map, which only protects one process. Hosts should pass a durable store
 * (e.g. the sale document) so the guard survives restarts.
 */
function withIssueGuard(provider, { store = new Map() } = {}) {
  assertProvider(provider);
  const get = async (k) => store.get(k);
  const set = async (k, v) => { await store.set(k, v); };
  const del = async (k) => { await store.delete(k); };

  async function reconcile(refId, options) {
    const result = await provider.getStatus({ refId }, options);
    if (result.status === EINVOICE_STATUS.NOT_FOUND || result.status === EINVOICE_STATUS.REJECTED) {
      await del(refId);
    } else {
      await set(refId, { state: 'done', result });
    }
    return result;
  }

  return Object.freeze({
    ...provider,
    id: provider.id,
    async issue(invoice) {
      const refId = invoice && invoice.refId;
      if (!refId) fail('einvoice_invalid', 422, { message: 'Thiếu refId' });
      const prior = await get(refId);
      if (prior && prior.state === 'done') return prior.result;
      if (prior && prior.state === 'pending') fail('einvoice_issue_in_progress', 409, { message: 'Hoá đơn của đơn hàng này đang được phát hành', details: { refId } });
      if (prior && prior.state === 'unknown') {
        fail('einvoice_outcome_unknown', 409, { message: 'Lần phát hành trước chưa rõ kết quả, cần đối soát (reconcile) trước', details: { refId } });
      }
      await set(refId, { state: 'pending', at: Date.now() });
      try {
        const result = await provider.issue(invoice);
        await set(refId, { state: 'done', result });
        return result;
      } catch (err) {
        /* a duplicate means the provider already has this refId: reconcile, don't re-issue */
        const unknown = err instanceof EInvoiceError && (err.code === 'einvoice_outcome_unknown' || err.code === 'einvoice_duplicate');
        if (unknown) await set(refId, { state: 'unknown', at: Date.now() });
        else await del(refId);
        throw err;
      }
    },
    reconcile,
    getStatus: (ref, options) => provider.getStatus(ref, options),
  });
}

module.exports = { EINVOICE_STATUS, assertProvider, createEInvoiceRegistry, withIssueGuard, refIdOf };
