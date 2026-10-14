'use strict';
/* HiTechPOS: plan limits are cached per shop database, not per process. */
jest.mock('../../../src/db/tenant-context', () => {
  let current = null;
  return {
    currentConnection: () => current,
    __set: (c) => { current = c; },
  };
});
jest.mock('mongoose', () => ({ connection: { readyState: 1 } }));

const ctx = require('../../../src/db/tenant-context');
const limits = require('../../../src/helpers/limits');

function shop(name, doc) {
  return { name, db: { collection: () => ({ findOne: async () => doc }) } };
}

beforeEach(() => limits.invalidate());

test('each shop gets its own limits even within the cache window', async () => {
  ctx.__set(shop('hitech_t_a', { _id: 'limits', branches: 1, users: 3, products: 500 }));
  expect(await limits.branchLimit()).toBe(1);
  expect(await limits.userLimit()).toBe(3);
  expect(await limits.itemLimit()).toBe(500);
  ctx.__set(shop('hitech_t_b', { _id: 'limits', branches: 20, users: 200 }));
  expect(await limits.branchLimit()).toBe(20);
  expect(await limits.itemLimit()).toBeNull();
  ctx.__set(shop('hitech_t_a', null));
  expect(await limits.userLimit()).toBe(3); // still cached for shop A
});

test('a shop with no limits document is unlimited', async () => {
  ctx.__set(shop('hitech_t_c', null));
  expect(await limits.branchLimit()).toBeNull();
  expect(await limits.userLimit()).toBeNull();
});
