const test = require('node:test');
const assert = require('node:assert/strict');
const Money = require('../assets/common/money');
for (const [code,digits,input,minor] of [['JPY',0,'123',123],['USD',2,'1.005',101],['KWD',3,'1.2345',1235],['CLF',4,'1.23456',12346]]) {
 test(`currency ${code} uses ${digits} decimal places without binary rounding loss`,()=>{
  const setting=Money.policy({currency_code:code});
  assert.equal(setting.currencyDigits,digits);
  assert.equal(Money.toMinor(input,setting),minor);
  assert.equal(Money.toMinor('-'+input,setting),-minor);
  assert.equal(Money.toMinor(Money.fromMinor(minor,setting),setting),minor);
 });
}
test('currency snapshot retains old journal precision rather than inferring new units',()=>{
 assert.equal(Money.snapshot({currency:'JPY'}).factor,100);
 assert.equal(Money.snapshot({currency:'JPY',currencyDigits:0}).factor,1);
 assert.equal(Money.policy({currency_text:'Kuwaiti Dinar / KWD',currency:'KD'}).factor,1000);
 assert.throws(()=>Money.toMinor(Infinity));
 assert.throws(()=>Money.toMinor('not money'));
 assert.throws(()=>Money.toMinor('999999999999999999999999999'));
});
test('currency scientific notation and fractional negative values round consistently',()=>{
 assert.equal(Money.toMinor('1e-2',{currency:'USD'}),1);
 assert.equal(Money.toMinor('-1.005',{currency:'USD'}),-101);
});
