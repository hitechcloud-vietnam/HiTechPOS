const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const acorn=require('acorn');
const source=fs.readFileSync(require('node:path').join(__dirname,'../indexedDB.js'),'utf8');
const fn=acorn.parse(source,{ecmaVersion:'latest'}).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='resolvePreviousDraft');
function setup(answer,fail=false){
 const entries=new Map([['kiosk_table_no','8'],['note','old note'],['posnic.pending-orders','pending-order-evidence']]);
 let rows=[{id:'fish',name:'Fish',quantity:1}],resets=0;
 const ctx=vm.createContext({waitForCartMutations:async()=>{},queueCartMutation:fn=>fn(),getCartData:async()=>rows,saveCartData:async next=>{if(fail)throw Error('storage unavailable');rows=next},resetOrderKey:()=>resets++,I18N:{t:x=>x},localStorage:{getItem:k=>entries.get(k),removeItem:k=>entries.delete(k)},CaptainConfirm:{discard:async()=>answer},window:{location:{}}});
 vm.runInContext(source.slice(fn.start,fn.end),ctx);
 return {ctx,entries,rows:()=>rows,resets:()=>resets};
}
test('discard resolves only draft, never queued delivery',async()=>{const s=setup(true);assert.equal(await s.ctx.resolvePreviousDraft(),true);assert.equal(s.rows().length,0);assert.equal(s.entries.get('posnic.pending-orders'),'pending-order-evidence');assert.equal(s.resets(),1)});
test('storage failure blocks starting another order without losing draft or key',async()=>{const s=setup(true,true);await assert.rejects(s.ctx.resolvePreviousDraft(),/storage unavailable/);assert.equal(s.rows().length,1);assert.equal(s.entries.get('note'),'old note');assert.equal(s.resets(),0)});
test('keeping draft never writes cart or resets key',async()=>{const s=setup(false,true);assert.equal(await s.ctx.resolvePreviousDraft(),false);assert.equal(s.rows().length,1);assert.equal(s.resets(),0);assert.equal(s.ctx.window.location.href,'cart.html')});
