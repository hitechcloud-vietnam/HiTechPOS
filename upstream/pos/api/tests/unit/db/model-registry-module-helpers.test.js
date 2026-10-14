'use strict';
/*
 * Helpers assigned onto a model export at module load (`Sale.fooModel =
 * async function () {}`) live on the base model. A shop's model is compiled
 * from the schema for that shop's connection and does not carry them, so in a
 * multi-tenant shard every such helper read as undefined ("is not a
 * function"). The proxy now falls back to the base copy for properties the
 * shop model lacks, while anything the shop model has still wins.
 * (HiTechPOS fix, docs/UPSTREAM.md.)
 */

const mongoose = require('mongoose');
const { defineModel } = require('../../../src/db/model-registry');
const { enableMultiTenant, runWithTenant } = require('../../../src/db/tenant-context');

const schema = new mongoose.Schema({ name: String });
schema.statics.fromSchema = function () {
  return 'schema-static';
};
const Gadget = defineModel('TestGadgetHelpers', schema);
Gadget.moduleHelper = async function () {
  return 'module-helper';
};

afterEach(() => enableMultiTenant(false));

function shopConnection() {
  const connection = mongoose.createConnection();
  return connection;
}

test('a module-level helper is reachable inside a shop scope', async () => {
  enableMultiTenant(true);
  const connection = shopConnection();
  await runWithTenant({ db: {}, connection }, async () => {
    expect(typeof Gadget.moduleHelper).toBe('function');
    await expect(Gadget.moduleHelper()).resolves.toBe('module-helper');
    /* the shop's own model still answers what it has */
    expect(Gadget.fromSchema()).toBe('schema-static');
    expect(Gadget.db).toBe(connection);
  });
  await connection.close();
});

test('unknown properties stay undefined', async () => {
  enableMultiTenant(true);
  const connection = shopConnection();
  await runWithTenant({ db: {}, connection }, async () => {
    expect(Gadget.noSuchHelper).toBeUndefined();
  });
  await connection.close();
});
