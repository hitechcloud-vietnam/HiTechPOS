const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../assets/order-history/script.js'), 'utf8');
const search = source.slice(source.indexOf('async function searchProducts(query)'), source.indexOf('// Store products for reference'));
const draft = source.slice(source.indexOf('function addDraftServing(source)'), source.indexOf('// Add product to order by ID'));
const add = source.slice(source.indexOf('function addProductToOrder(productId,'), source.indexOf('// Update order total'));
const save = source.slice(source.indexOf('function linesForSave(items)'), source.indexOf('function confirmRemoveItem()'));
test('search, add and save send the menu base price, never final_price', async () => {
  let matches;
  const ctx = vm.createContext({
    console, crypto: require('node:crypto'), window: {}, STORE_NAME: 'products',
    getData: async () => [{ id: 'paratha', name: 'Paratha', price: 45, final_price: 47.25 }],
    document: { getElementById: () => ({}) },
    renderProductSuggestions: products => { matches = products; },
    editingOrder: { items: [] }, renderCurrentOrderItems() {}, updateOrderTotal() {},
    lineIsCancelled: () => false, lineQuantity: item => item.quantity,
  });
  vm.runInContext(search + '\n' + draft + '\n' + add + '\n' + save, ctx);
  await ctx.searchProducts('Paratha');
  ctx.addProductToOrder('paratha', matches[0].name, matches[0].selling_price);
  const request = ctx.linesForSave(ctx.editingOrder.items);
  assert.equal(request[0].price, 45);
  assert.equal(matches[0].final_price, 47.25);
});
