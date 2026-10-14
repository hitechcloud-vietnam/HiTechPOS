const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const text = require('../assets/common/item-localization');
const search = require('../assets/common/item-search');
const row = {id:'coffee',name:'Coffee',price:20,quantity:2,translations:[{locale:'nl',name:'Koffie'},{locale:'ar',name:'قهوة'}]};
test('translation search finds one canonical item across languages, including Arabic', () => {
  const index=search.index([row]);
  for(const query of ['coffee','koffie','قهوة']) assert.deepEqual(search.search(index,query),[row]);
  assert.deepEqual(search.search(search.index([{...row,translations:[{locale:'nl',name:'Coffee'}]}]),'coffee').map(x=>x.id),['coffee']);
});
test('Captain uses its existing language setting offline without changing the cart identity', () => {
  let language='nl', listener, draws=0;
  const window={PosnicItemText:text,I18N:{language:()=>language},addEventListener:(_event,fn)=>listener=fn,loadProducts:()=>draws++};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/common/item-language'),'utf8'),{window,document:{getElementById:id=>id==='product-list'}});
  assert.equal(window.ItemLanguage.name(row),'Koffie');
  language='ar';listener();assert.equal(window.ItemLanguage.name(row),'قهوة');
  language='fr';assert.equal(window.ItemLanguage.name(row),'Coffee');
  assert.equal(draws,1);assert.equal(row.name,'Coffee');assert.equal(row.quantity,2);assert.equal(row.price,20);
});
