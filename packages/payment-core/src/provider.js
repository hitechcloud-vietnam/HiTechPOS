'use strict';

/*
 * The contract a payment provider adapter implements. The host (control plane
 * for subscriptions, POS for sales) owns the journal, permissions and the sale
 * record; an adapter only translates to and from one provider and verifies
 * what that provider sends back.
 *
 *   createCheckout(intent) -> { providerRef, checkoutUrl, qrCode?, expiresAt? }
 *     intent: { orderCode, amount, description, returnUrl, cancelUrl,
 *               ipnUrl?, buyer?, items?, expiresAt? }
 *   verifyCallback({ body, headers, query }) -> PaymentEvent  (throws if forged)
 *   getStatus?(providerRef | orderCode) -> PaymentEvent
 *   cancel?(providerRef | orderCode, reason) -> void
 *
 * PaymentEvent: { provider, orderCode, providerRef, status, amount,
 *                 transactionId, paidAt, eventKey }
 *   status is one of PAYMENT_STATUS; eventKey is the provider-stable identity
 *   of the notification used for de-duplication.
 */
const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  PAID: 'paid',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  FAILED: 'failed',
  REVIEW: 'review',
});

const REQUIRED = ['id', 'createCheckout', 'verifyCallback'];

function assertProvider(provider) {
  for (const key of REQUIRED) {
    if (!provider || provider[key] === undefined) throw new TypeError(`payment provider is missing ${key}`);
  }
  if (typeof provider.createCheckout !== 'function' || typeof provider.verifyCallback !== 'function') {
    throw new TypeError('payment provider createCheckout/verifyCallback must be functions');
  }
  return provider;
}

function createProviderRegistry(providers = []) {
  const byId = new Map();
  const registry = {
    register(provider) {
      assertProvider(provider);
      if (byId.has(provider.id)) throw new Error(`payment provider ${provider.id} is already registered`);
      byId.set(provider.id, provider);
      return registry;
    },
    get(id) {
      const provider = byId.get(id);
      if (!provider) throw new Error(`payment provider ${id} is not configured`);
      return provider;
    },
    has: (id) => byId.has(id),
    list: () => [...byId.keys()],
  };
  providers.forEach((p) => registry.register(p));
  return registry;
}

module.exports = { PAYMENT_STATUS, assertProvider, createProviderRegistry };
