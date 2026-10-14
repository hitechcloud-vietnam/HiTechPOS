'use strict';

const { fail } = require('@hitechpos/payment-core');

/*
 * Subscription catalogue, priced in VND per month. Limits are enforced by the
 * POS (branches, users, devices) through the tenant's plan record; features
 * gate which companion apps a shop may connect.
 *
 * VAT: software products and software services are not subject to VAT in
 * Vietnam (Luật Thuế GTGT, "sản phẩm phần mềm, dịch vụ phần mềm"), so the
 * default rate is KCT. It is configurable because bundles that include
 * hardware or non-software services are taxed - confirm with the accountant.
 */
const PLANS = Object.freeze([
  {
    id: 'trial', name: 'Dùng thử', monthlyPrice: 0, trialDays: 14, public: false,
    limits: { branches: 1, users: 3, devices: 2, products: 500 },
    features: ['pos-web', 'mobile-pos', 'vietqr'],
  },
  {
    id: 'basic', name: 'Cơ bản', monthlyPrice: 199000, public: true,
    limits: { branches: 1, users: 3, devices: 2, products: 5000 },
    features: ['pos-web', 'mobile-pos', 'vietqr', 'payos', 'pay2s', 'reports'],
  },
  {
    id: 'pro', name: 'Chuyên nghiệp', monthlyPrice: 399000, public: true, highlighted: true,
    limits: { branches: 3, users: 15, devices: 10, products: 50000 },
    features: ['pos-web', 'mobile-pos', 'captain', 'kds', 'business', 'vietqr', 'payos', 'pay2s', 'reports', 'loyalty', 'e-invoice'],
  },
  {
    id: 'enterprise', name: 'Doanh nghiệp', monthlyPrice: 899000, public: true,
    limits: { branches: 20, users: 200, devices: 100, products: null },
    features: ['pos-web', 'mobile-pos', 'captain', 'kds', 'business', 'vietqr', 'payos', 'pay2s', 'reports', 'loyalty', 'e-invoice', 'api', 'custom-domain', 'white-label'],
  },
].map((p) => Object.freeze({ ...p, limits: Object.freeze(p.limits), features: Object.freeze(p.features) })));

/* Prepaying longer earns a discount (percent). */
const CYCLES = Object.freeze({ 1: 0, 3: 5, 6: 10, 12: 20, 24: 30 });

function getPlan(id) {
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) fail('plan_not_found', 404);
  return plan;
}

function vatAmount(net, rate) {
  return typeof rate === 'number' ? Math.round((net * rate) / 100) : 0;
}

/* All arithmetic in integer VND; discounts round down in the customer's favour. */
function quote(planId, months, { vatRate = 'KCT' } = {}) {
  const plan = getPlan(planId);
  if (plan.monthlyPrice === 0) fail('plan_not_purchasable', 422);
  if (!Object.hasOwn(CYCLES, months)) fail('billing_cycle_invalid', 422);
  const subtotal = plan.monthlyPrice * months;
  const discount = Math.floor((subtotal * CYCLES[months]) / 100);
  const net = subtotal - discount;
  const vat = vatAmount(net, vatRate);
  return { planId, planName: plan.name, months, subtotal, discountPercent: CYCLES[months], discount, net, vatRate, vat, total: net + vat, currency: 'VND' };
}

function publicCatalogue() {
  return {
    plans: PLANS.filter((p) => p.public),
    cycles: Object.entries(CYCLES).map(([months, discountPercent]) => ({ months: Number(months), discountPercent })),
    trialDays: getPlan('trial').trialDays,
  };
}

module.exports = { PLANS, CYCLES, getPlan, quote, publicCatalogue };
