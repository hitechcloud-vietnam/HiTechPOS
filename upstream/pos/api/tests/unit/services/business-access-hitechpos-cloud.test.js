'use strict';

/*
 * HiTechPOS (not upstream Posnic): the control plane at app.hitechpos.vn hands
 * an owner's phone over to the shop by writing an approved 'cloud-browser'
 * row into the shop's business_authorizations (apps/control-plane/src/
 * business-handoff.js, written by store/mongo.js shopBridge). This runs the
 * control plane's own Mongo bridge against a real mongod and redeems the row
 * with this shard's exchange(), so a change on either side breaks here rather
 * than on an owner's phone. Skipped when the control plane is not checked out.
 */
const fs = require('node:fs');
const path = require('node:path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const {
  createBusinessAccess,
  opaque,
  hash,
  proof,
} = require('../../../src/services/business-access');

const CONTROL_PLANE = path.join(__dirname, '../../../../../../apps/control-plane/src');
const present = fs.existsSync(path.join(CONTROL_PLANE, 'business-handoff.js'));
const maybe = present ? describe : describe.skip;

maybe('HiTechPOS Cloud hand-over row', () => {
  let mongo, store, shopDb, tenant;

  beforeAll(async () => {
    const binary = process.env.MONGOMS_SYSTEM_BINARY;
    mongo = await MongoMemoryServer.create({ binary: binary ? { systemBinary: binary } : {} });
    await mongoose.connect(mongo.getUri('hitech_t_photue'));
    const { createMongoStore } = require(path.join(CONTROL_PLANE, 'store/mongo.js'));
    store = await createMongoStore({ uri: mongo.getUri(), dbName: 'hitechpos_control_test' });
    tenant = { subdomain: 'photue', tenantDb: 'hitech_t_photue' };
    shopDb = mongoose.connection.db;
  }, 60000);

  afterAll(async () => {
    await store?.close();
    await mongoose.disconnect();
    await mongo?.stop();
  }, 60000);

  async function shop({ email = 'chu@photue.vn', usertype = 'super_admin', authVersion = 3 } = {}) {
    const license = new ObjectId();
    const branch = {
      _id: new ObjectId(),
      license,
      branch_name: 'Phở Tuệ',
      currency: '₫',
      currency_value: [{ currency_text: 'VND', currency_sign: '₫' }],
      time_zone: 'Asia/Ho_Chi_Minh',
    };
    const user = {
      _id: new ObjectId(),
      license,
      email,
      username: email,
      usertype,
      activate: true,
      authVersion,
      business_name: 'Phở Tuệ',
      branch_access: [{ branch_id: branch._id }],
    };
    await shopDb.collection('branches').insertOne(branch);
    await shopDb.collection('users').insertOne(user);
    return { license, branch, user };
  }

  async function handOver(userId, { stepUp = false, authenticatedAt = new Date(Date.now() - 30_000) } = {}) {
    const verifier = opaque();
    const request = opaque();
    const written = await store.shopBridge.insertBusinessAuthorization(tenant, {
      userId,
      requestHash: hash(request),
      codeChallenge: proof(verifier),
      deviceName: 'HiTechPOS Business',
      stepUp,
      authenticatedAt,
      now: new Date(),
    });
    return { written, verifier, request, authenticatedAt };
  }

  test('the bridge maps the owner and the shard redeems the row once', async () => {
    const f = await shop({ email: 'owner@photue.vn' });
    await shop({ email: 'owner@photue.vn', usertype: 'cashier' });
    const owner = await store.shopBridge.businessOwner(tenant, { email: 'owner@photue.vn' });
    expect(owner).toEqual({ userId: String(f.user._id) });
    expect(await store.shopBridge.businessOwner(tenant, { email: 'nobody@photue.vn' })).toBeNull();

    const h = await handOver(owner.userId);
    expect(h.written).toBe(true);
    const row = await shopDb.collection('business_authorizations').findOne({ _id: hash(h.request) });
    expect(row.userId).toEqual(f.user._id);
    expect(row.license).toEqual(f.license);
    expect(row.authorization).toBe('cloud-browser');
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(10 * 60_000);

    const access = createBusinessAccess(shopDb);
    await expect(access.exchange(h.request, opaque())).rejects.toMatchObject({ code: 'request_expired' });
    const grant = await access.exchange(h.request, h.verifier);
    expect(Object.keys(grant).sort()).toEqual(['context', 'expiresAt', 'token']);
    expect(grant.token).toMatch(/^pb1_[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(grant.expiresAt) - Date.now()).toBeGreaterThan(29 * 24 * 3600_000);
    expect(grant.context).toEqual({
      accountId: String(f.user._id),
      businessId: String(f.license),
      businessName: 'Phở Tuệ',
      branches: [
        {
          id: String(f.branch._id),
          name: 'Phở Tuệ',
          currency: 'VND',
          currencyDigits: 0,
          timezone: 'Asia/Ho_Chi_Minh',
        },
      ],
      capabilities: expect.arrayContaining(['reporting.manage', 'overview.read', 'stock.read']),
    });
    const { session } = await access.authenticate(grant.token);
    expect(session.authenticatedAt.getTime()).toBe(h.authenticatedAt.getTime());
    await expect(access.exchange(h.request, h.verifier)).rejects.toMatchObject({ status: 403 });
  });

  test('step-up rows give the ten-minute session the approval flow needs', async () => {
    const f = await shop({ email: 'stepup@photue.vn' });
    const h = await handOver(String(f.user._id), { stepUp: true, authenticatedAt: new Date() });
    const grant = await createBusinessAccess(shopDb).exchange(h.request, h.verifier);
    expect(Date.parse(grant.expiresAt) - Date.now()).toBeLessThanOrEqual(10 * 60_000);
  });

  test('a stale auth version or ineligible user is never handed a session', async () => {
    const f = await shop({ email: 'stale@photue.vn' });
    const h = await handOver(String(f.user._id));
    await shopDb.collection('users').updateOne({ _id: f.user._id }, { $inc: { authVersion: 1 } });
    await expect(createBusinessAccess(shopDb).exchange(h.request, h.verifier)).rejects.toMatchObject({
      code: 'session_revoked',
    });

    const staff = await shop({ email: 'staff@photue.vn', usertype: 'cashier' });
    expect((await handOver(String(staff.user._id))).written).toBe(false);
    await shopDb.collection('users').updateOne({ _id: f.user._id }, { $set: { activate: false } });
    expect((await handOver(String(f.user._id))).written).toBe(false);
    expect(await store.shopBridge.businessOwner(tenant, { email: 'stale@photue.vn' })).toBeNull();
  });
});
