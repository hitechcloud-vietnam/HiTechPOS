const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'../indexedDB.js'),'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function askedOn('),source.indexOf('async function updateCart()')),context);
test('submission price covers exclusive, inclusive, discounted, legacy, variable, quick and modifier lines',()=>{
  for(const [line,price] of [
    [{selling_price:400,price:420,final_price:420},400],
    [{selling_price:30,final_price:30},30],
    [{selling_price:100,final_price:94.5},100],
    [{subtotal:45,price:47.25,final_price:47.25},45],
    [{askedPrice:850,subtotal:0,final_price:0},850],
    [{instant:true,price:60,subtotal:0},60],
    [{selling_price:100,modifiers:[{price_delta:20}]},120],
    [{askedPrice:850,modifiers:[{price_delta:20}]},850],
  ]) assert.equal(context.submittedUnitPrice(line),price);
  assert.throws(()=>context.submittedUnitPrice({selling_price:'bad'}));
});
