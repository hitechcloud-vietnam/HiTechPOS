'use strict';

const { createViettelProvider, toViettelInvoice, VIETTEL_BASE_URLS } = require('./providers/viettel');
const { createMisaProvider, toMisaInvoiceData, MISA_BASE_URLS, SIGN_TYPES: MISA_SIGN_TYPES } = require('./providers/misa');
const { createMatBaoProvider, toMatBaoInvoice, MATBAO_BASE_URLS } = require('./providers/matbao');
const { transactionIdFor } = require('./transport');

const FACTORIES = { viettel: createViettelProvider, misa: createMisaProvider, matbao: createMatBaoProvider };

/* Builds an adapter by id from a tenant's stored configuration. */
function createProvider(id, config, options) {
  const factory = FACTORIES[id];
  if (!factory) throw new Error(`einvoice provider ${id} is not supported`);
  return factory(config, options);
}

module.exports = {
  ...require('./errors'),
  ...require('./invoice'),
  ...require('./provider'),
  ...require('./mock'),
  transactionIdFor,
  createProvider,
  createViettelProvider, toViettelInvoice, VIETTEL_BASE_URLS,
  createMisaProvider, toMisaInvoiceData, MISA_BASE_URLS, MISA_SIGN_TYPES,
  createMatBaoProvider, toMatBaoInvoice, MATBAO_BASE_URLS,
};
