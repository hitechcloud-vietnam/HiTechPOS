'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { quote, publicCatalogue } = require('../src/plans');
const { addMonths } = require('../src/billing');
const { normalizeSubdomain, tenantDbName } = require('../src/tenants');

test('quotes are integer VND with cycle discounts', () => {
  assert.deepEqual(
    (({ subtotal, discount, net, vat, total }) => ({ subtotal, discount, net, vat, total }))(quote('pro', 12)),
    { subtotal: 4788000, discount: 957600, net: 3830400, vat: 0, total: 3830400 }
  );
  assert.equal(quote('basic', 1, { vatRate: 10 }).total, 218900);
  assert.throws(() => quote('basic', 2), { code: 'billing_cycle_invalid' });
  assert.throws(() => quote('trial', 1), { code: 'plan_not_purchasable' });
  assert.ok(!publicCatalogue().plans.some((p) => p.id === 'trial'));
});

test('addMonths clamps to month end', () => {
  assert.equal(addMonths('2026-01-31T00:00:00Z', 1).toISOString(), '2026-02-28T00:00:00.000Z');
  assert.equal(addMonths('2026-10-14T05:00:00Z', 12).toISOString(), '2027-10-14T05:00:00.000Z');
});

test('subdomains are DNS-safe and database-safe', () => {
  assert.deepEqual(normalizeSubdomain(' PhoTue '), { ok: true, subdomain: 'photue' });
  assert.equal(normalizeSubdomain('admin').reason, 'reserved');
  for (const bad of ['ab', '-abc', 'abc-', 'a--b', 'phở', 'a.b', 'x'.repeat(31)]) assert.equal(normalizeSubdomain(bad).ok, false, bad);
  assert.equal(tenantDbName('cafe-moc'), 'hitech_t_cafe_moc');
});
