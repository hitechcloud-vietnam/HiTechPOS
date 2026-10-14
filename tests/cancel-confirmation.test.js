const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');

function extract(file, matches) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  let found;
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (matches(node)) found = node;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  }
  walk(acorn.parse(source, { ecmaVersion: 'latest' }));
  assert.ok(found);
  return source.slice(found.start, found.end);
}

test('history confirmation remains open and retryable until cancellation succeeds', async () => {
  const handler = extract('assets/order-history/script.js', n => n.type === 'FunctionExpression' && n.async &&
    n.body.body.some(s => s.type === 'IfStatement' && s.test.type === 'LogicalExpression' &&
      s.test.left?.argument?.name === 'pendingCancelOrderId'));
  let calls = 0, closed = 0;
  const context = vm.createContext({
    pendingCancelOrderId: 'order-1', confirmCancelBtn: { disabled: false },
    performCancelOrder: async id => { assert.equal(id, 'order-1'); return ++calls > 1; },
    document: { getElementById: () => ({value:'Customer requested',reportValidity:()=>true}) },
    bootstrap: { Modal: { getInstance: () => ({ hide() { closed++; } }) } },
  });
  await vm.runInContext(`(${handler})()`, context);
  assert.equal(closed, 0);
  assert.equal(context.pendingCancelOrderId, 'order-1');
  assert.equal(context.confirmCancelBtn.disabled, false);
  await vm.runInContext(`(${handler})()`, context);
  assert.equal(closed, 1);
  assert.equal(context.pendingCancelOrderId, null);
});

const handlers = {
  history: extract('assets/order-history/script.js', n => n.type === 'FunctionDeclaration' && n.id.name === 'performCancelOrder'),
  floor: extract('assets/kot/script.js', n => n.type === 'FunctionExpression' && n.async &&
    n.body.body.some(s => s.type === 'IfStatement' && s.test.type === 'LogicalExpression' && s.test.left?.argument?.name === 'cancelKotId')),
};

for (const [name, handler] of Object.entries(handlers)) {
  for (const scenario of ['success', 'render-failure', 'rejected', 'network-failure']) {
    test(`${name}: cancellation outcome survives ${scenario}`, async () => {
      const toasts = [];
      const order = { _id: 'order-1', items: [{ name: 'Meal' }], total_amount: 100 };
      const render = () => { if (scenario === 'render-failure') throw new Error('DOM refresh failed'); };
      const context = vm.createContext({
        console: { log() {}, error() {} },
        allOrders: [order], currentKotOrders: [order], currentOrderId: 'order-1', cancelKotId: 'order-1',
        confirmBtn: { dataset: {}, textContent: 'Cancel' },
        CaptainOrderActions: { save: async () => {
          if (scenario === 'network-failure') throw new Error('Offline');
          return { type: scenario === 'rejected' ? 'error' : 'success' };
        } },
        showToast: (message, type) => toasts.push({ message, type }),
        showLoader() {}, hideLoader() {}, showSectionLoader() {}, hideSectionLoader() {},
        filterOrders: render, viewOrderDetails() {}, closeSlidingPanel: render, clearKotSelection() {},
        document: { getElementById: () => ({value:'Customer requested',reportValidity:()=>true}) },
        bootstrap: { Modal: { getInstance: () => ({ hide() {} }) } },
        setTimeout() {},
      });
      const result = await vm.runInContext(`(${handler})('order-1')`, context);
      const expected = ['success', 'render-failure'].includes(scenario) ? 'success' : 'error';
      assert.equal(toasts.length, 1);
      assert.equal(toasts[0].type, expected);
      if (expected === 'success') assert.equal(toasts[0].message, 'Order cancelled');
      if (name === 'history') assert.equal(result, expected === 'success');
      if (name === 'floor') {
        assert.equal(context.cancelKotId, expected === 'success' ? null : 'order-1');
        if (scenario === 'network-failure') assert.equal(toasts[0].message, 'Offline');
      }
    });
  }
}
