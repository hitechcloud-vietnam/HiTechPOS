'use strict';

const { createProviderRegistry } = require('@hitechpos/payment-core');
const { createPayOSProvider } = require('@hitechpos/payment-payos');
const { createPay2SProvider } = require('@hitechpos/payment-pay2s');

/* Only providers with credentials configured are offered at checkout. */
function providersFromConfig(config) {
  const registry = createProviderRegistry();
  if (config.payos) registry.register(createPayOSProvider(config.payos));
  if (config.pay2s) registry.register(createPay2SProvider(config.pay2s));
  return registry;
}

module.exports = { providersFromConfig };
