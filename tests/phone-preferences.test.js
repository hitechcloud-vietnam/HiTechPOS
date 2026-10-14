const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/common/phone-preferences.js'),'utf8');
test('optional phone cues stay off unless explicitly enabled and preserve saved choices',()=>{
 const values=new Map();const context=vm.createContext({localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)}});
 vm.runInContext(source,context);const p=context.CaptainPhone;
 for(const name of ['sound','vibration']){assert.equal(p.enabled(name),false);assert.equal(p.set(name,true),true);assert.equal(p.enabled(name),true);p.set(name,false);assert.equal(p.enabled(name),false);}
});
test('unavailable preference storage never enables optional cues',()=>{
 const context=vm.createContext({localStorage:{getItem(){throw Error('unavailable');}}});vm.runInContext(source,context);
 assert.equal(context.CaptainPhone.enabled('sound'),false);assert.equal(context.CaptainPhone.enabled('vibration'),false);
});

test('tax display preference persists and rejects invalid values',()=>{
 const values=new Map();const context=vm.createContext({localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)}});
 vm.runInContext(source,context);const p=context.CaptainPhone;
 assert.equal(p.priceMode(),'including');assert.equal(p.setPriceMode('excluding'),true);assert.equal(p.priceMode(),'excluding');
 assert.equal(p.setPriceMode('free'),false);assert.equal(p.priceMode(),'excluding');
});
