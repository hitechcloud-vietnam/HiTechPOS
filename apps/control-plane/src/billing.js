'use strict';

const { createJournal, generateOrderCode, fail, PAYMENT_STATUS } = require('@hitechpos/payment-core');
const { quote, getPlan } = require('./plans');

const DAY = 86400000;

function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  /* 31 Jan + 1 month lands on 3 Mar in JS; clamp to the month's last day. */
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d;
}

/*
 * Subscription billing for shops: quote -> checkout with a provider ->
 * verified callback -> extend the paid period. The journal is the source of
 * truth for money; the tenant document only mirrors the resulting period.
 */
function createBillingService({ store, providers, config, now = () => new Date() }) {
  const journal = createJournal({ store: store.payments, now });

  async function checkout({ tenantId, planId, months, provider: providerId }) {
    const tenant = await store.tenants.findById(tenantId);
    if (!tenant) fail('tenant_not_found', 404);
    const provider = providers.get(providerId);
    const q = quote(planId, Number(months), { vatRate: config.saasVatRate });
    const orderCode = generateOrderCode(now().getTime());
    await journal.open({
      orderCode, provider: provider.id, amount: q.total, purpose: 'subscription', reference: String(tenant._id),
      metadata: { tenantId: String(tenant._id), subdomain: tenant.subdomain, quote: q },
    });
    let checkoutInfo;
    try {
      checkoutInfo = await provider.createCheckout({
        orderCode,
        amount: q.total,
        description: `HTP ${tenant.subdomain} ${q.planId} ${q.months}T`,
        returnUrl: `${config.publicUrl}/billing/return?orderCode=${orderCode}`,
        cancelUrl: `${config.publicUrl}/billing/cancel?orderCode=${orderCode}`,
        ipnUrl: `${config.publicUrl}/webhooks/${provider.id}`,
        expiresAt: new Date(now().getTime() + 30 * 60000).toISOString(),
        items: [{ name: `HiTechPOS ${q.planName} ${q.months} tháng`, quantity: 1, price: q.total }],
      });
    } catch (e) {
      /* The provider may or may not have created the link; the journal row
         stays pending and a later callback can still settle it. */
      e.orderCode = orderCode;
      throw e;
    }
    await journal.attachCheckout(orderCode, checkoutInfo);
    return { orderCode, quote: q, ...checkoutInfo };
  }

  /* Extends from the later of now and the current period end, so renewing
     early never loses days and renewing late does not back-date. */
  async function activate(payment) {
    const { tenantId, quote: q } = payment.metadata;
    const tenant = await store.tenants.findById(tenantId);
    if (!tenant) fail('tenant_not_found', 404);
    const plan = getPlan(q.planId);
    const currentEnd = tenant.subscription && tenant.subscription.status === 'active' ? new Date(tenant.subscription.currentPeriodEnd) : now();
    const from = currentEnd > now() ? currentEnd : now();
    const end = addMonths(from, q.months);
    return store.tenants.update(tenantId, {
      plan: { id: plan.id, limits: plan.limits, features: plan.features },
      subscription: { status: 'active', currentPeriodEnd: end.toISOString(), lastPaymentOrderCode: payment.orderCode },
      suspended: tenant.suspendedReason === 'subscription_expired' ? false : tenant.suspended,
      suspendedReason: tenant.suspendedReason === 'subscription_expired' ? null : tenant.suspendedReason ?? null,
    });
  }

  async function handleCallback(providerId, request) {
    const provider = providers.get(providerId);
    const event = await provider.verifyCallback(request);
    const existing = await journal.get(event.orderCode);
    /* payOS's confirm-webhook test and callbacks for links this plane did
       not create are verified but unknown; acknowledge and ignore them. */
    if (!existing) return { acknowledged: true, ignored: 'unknown_order' };
    const result = await journal.apply(event);
    if (result.changed && result.payment.status === PAYMENT_STATUS.PAID && result.payment.purpose === 'subscription') {
      await activate(result.payment);
    }
    return { acknowledged: true, status: result.payment.status, ignored: result.ignored };
  }

  /* Run on a schedule: suspend shops whose paid period (or trial) ended more
     than the grace period ago. Never touches manually suspended shops. */
  async function enforceExpiry() {
    const graceMs = (config.graceDays ?? 7) * DAY;
    const suspended = [];
    for (const t of await store.tenants.list({ suspended: false })) {
      const end = t.subscription && t.subscription.currentPeriodEnd;
      if (!end || new Date(end).getTime() + graceMs > now().getTime()) continue;
      await store.tenants.update(t._id, { suspended: true, suspendedReason: 'subscription_expired', subscription: { ...t.subscription, status: 'expired' } });
      suspended.push(t.subdomain);
    }
    return suspended;
  }

  return { checkout, handleCallback, activate, enforceExpiry, journal };
}

module.exports = { createBillingService, addMonths };
