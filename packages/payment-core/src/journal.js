'use strict';

const { PAYMENT_STATUS: S } = require('./provider');
const { fail } = require('./errors');

/*
 * The durable record of a checkout, and the only place its status changes.
 *
 * Callbacks arrive more than once, out of order, and sometimes for amounts
 * that do not match what was asked. The rules:
 *   - an event already applied (same eventKey) is a no-op;
 *   - paid is terminal: a later "cancelled" for a paid checkout is ignored and
 *     flagged, never applied, because the money has moved;
 *   - a paid event whose amount differs from the expected amount goes to
 *     REVIEW instead of PAID - a short payment must not unlock a subscription
 *     or close a bill, and an overpayment needs a human to refund;
 *   - any other terminal status (cancelled/expired/failed) may still become
 *     PAID, because a customer can complete a bank transfer after the link
 *     expired on our side.
 */
const TRANSITIONS = {
  [S.PENDING]: [S.PAID, S.CANCELLED, S.EXPIRED, S.FAILED, S.REVIEW],
  [S.CANCELLED]: [S.PAID, S.REVIEW],
  [S.EXPIRED]: [S.PAID, S.REVIEW],
  [S.FAILED]: [S.PAID, S.REVIEW],
  [S.REVIEW]: [S.PAID],
  [S.PAID]: [],
};

function canTransition(from, to) {
  return from === to || (TRANSITIONS[from] || []).includes(to);
}

/* Store contract: insert(doc) (throws code 'duplicate' on orderCode clash),
   findByOrderCode(orderCode), update(orderCode, patch, expectedStatus) ->
   updated doc or null when the status changed underneath. */
function createMemoryStore() {
  const rows = new Map();
  return {
    async insert(doc) {
      if (rows.has(doc.orderCode)) fail('payment_duplicate_order_code', 409);
      rows.set(doc.orderCode, structuredClone(doc));
      return structuredClone(doc);
    },
    async findByOrderCode(orderCode) {
      const row = rows.get(Number(orderCode));
      return row ? structuredClone(row) : null;
    },
    async update(orderCode, patch, expectedStatus) {
      const row = rows.get(Number(orderCode));
      if (!row || row.status !== expectedStatus) return null;
      Object.assign(row, structuredClone(patch));
      return structuredClone(row);
    },
    async list() {
      return [...rows.values()].map((r) => structuredClone(r));
    },
  };
}

function createJournal({ store = createMemoryStore(), now = () => new Date() } = {}) {
  async function open({ orderCode, provider, amount, currency = 'VND', purpose, reference, metadata = {} }) {
    if (!Number.isSafeInteger(orderCode) || orderCode <= 0) fail('payment_order_code_invalid', 422);
    if (!Number.isSafeInteger(amount) || amount <= 0) fail('payment_amount_invalid', 422);
    if (currency !== 'VND') fail('payment_currency_unsupported', 422);
    return store.insert({
      orderCode, provider, amount, currency, purpose, reference, metadata,
      status: S.PENDING, providerRef: null, checkoutUrl: null,
      events: [], createdAt: now().toISOString(), updatedAt: now().toISOString(),
    });
  }

  async function attachCheckout(orderCode, { providerRef, checkoutUrl, qrCode, expiresAt }) {
    const current = await store.findByOrderCode(orderCode);
    if (!current) fail('payment_not_found', 404);
    return store.update(orderCode, {
      providerRef: providerRef ?? null, checkoutUrl: checkoutUrl ?? null,
      qrCode: qrCode ?? null, expiresAt: expiresAt ?? null, updatedAt: now().toISOString(),
    }, current.status);
  }

  /*
   * Apply a verified provider event. Returns { payment, changed, ignored? }.
   * Retries once on a concurrent status change, which is what two callbacks
   * for one checkout racing each other looks like.
   */
  async function apply(event) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await store.findByOrderCode(event.orderCode);
      if (!current) fail('payment_not_found', 404);
      if (current.provider !== event.provider) fail('payment_provider_mismatch', 409);
      if (event.eventKey && current.events.some((e) => e.eventKey === event.eventKey)) {
        return { payment: current, changed: false, ignored: 'duplicate' };
      }
      let target = event.status;
      if (target === S.PAID && event.amount !== current.amount) target = S.REVIEW;
      const record = {
        eventKey: event.eventKey || null, status: event.status, appliedStatus: target,
        amount: event.amount ?? null, transactionId: event.transactionId ?? null,
        at: now().toISOString(),
      };
      if (!canTransition(current.status, target)) {
        record.appliedStatus = current.status;
        const updated = await store.update(event.orderCode, { events: [...current.events, record], updatedAt: record.at }, current.status);
        if (!updated) continue;
        return { payment: updated, changed: false, ignored: 'transition_not_allowed' };
      }
      const patch = { status: target, events: [...current.events, record], updatedAt: record.at };
      if (target === S.PAID) {
        patch.paidAt = event.paidAt || record.at;
        patch.transactionId = event.transactionId ?? null;
      }
      if (target === S.REVIEW) patch.reviewReason = event.status === S.PAID ? 'amount_mismatch' : 'manual';
      const updated = await store.update(event.orderCode, patch, current.status);
      if (!updated) continue;
      return { payment: updated, changed: current.status !== target };
    }
    fail('payment_concurrent_update', 409);
  }

  return { open, attachCheckout, apply, get: (orderCode) => store.findByOrderCode(orderCode), store };
}

module.exports = { createJournal, createMemoryStore, canTransition, TRANSITIONS };
