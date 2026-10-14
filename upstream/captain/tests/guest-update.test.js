const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/common/guest-update.js'),'utf8');
function app(storage=new Map()){
  const calls=[];
  if(!storage.has('branch_id'))storage.set('branch_id','branch-1');
  const context={Map,JSON,Error,Number,crypto:{randomUUID:()=> 'guest-request-0001'},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    POSNIC:{session:{base:'https://shop/api',shopKey:'shop-1',user:{id:'staff-1'}},api:{post:async(url,body)=>{
      calls.push({url,body});return {...body,state:'completed'};
    }}}};
  vm.runInNewContext(source,context);
  return {context,api:context.CaptainGuestUpdate,calls,storage};
}
test('interrupted guest save survives reload and cannot be replaced with a new count',async()=>{
  const a=app();a.context.POSNIC.api.post=async()=>{throw new Error('offline');};
  await assert.rejects(a.api.save('order-1',3));
  const b=app(a.storage);await b.api.save('order-1',7);
  assert.equal(b.calls[0].body.guests,3);assert.equal(b.calls[0].body.request_id,'guest-request-0001');
  assert.equal(b.api.pending('order-1'),null);
});
test('another issuer, staff or branch cannot replay a saved guest update',async()=>{
  const a=app();a.context.POSNIC.api.post=async()=>{throw new Error('offline');};
  await assert.rejects(a.api.save('order-1',3));
  a.context.POSNIC.session.base='https://other/api';await assert.rejects(a.api.resume('order-1'),/Reconnect/);
  a.context.POSNIC.session.user.id='staff-2';assert.equal(a.api.pending('order-1'),null);
  a.context.POSNIC.session.user.id='staff-1';a.storage.set('branch_id','branch-2');assert.equal(a.api.pending('order-1'),null);
});
test('storage failure prevents sending and a mismatched response retains recovery',async()=>{
  const a=app();a.context.localStorage.setItem=()=>{throw new Error('full');};
  assert.throws(()=>a.api.save('order-1',3));assert.equal(a.calls.length,0);
  const b=app();b.context.POSNIC.api.post=async()=>({request_id:'wrong',orderId:'order-1',guests:3,state:'completed'});
  await assert.rejects(b.api.save('order-1',3));assert.ok(b.api.pending('order-1'));
});
test('only a matching cancellation tombstone clears a rejected request',async()=>{
  for(const state of ['unknown','pending','cancelled']){
    const a=app();a.context.POSNIC.api.post=async(url,body)=>{
      if(!url.endsWith('/status'))throw Object.assign(new Error('capacity'),{status:409});
      return {...body,orderId:'order-1',guests:3,state};
    };
    await assert.rejects(a.api.save('order-1',3));
    assert.equal(Boolean(a.api.pending('order-1')),state!=='cancelled');
  }
});
test('session switching during response retains the original staff request',async()=>{
  const a=app();a.context.POSNIC.api.post=async(url,body)=>{
    a.context.POSNIC.session.user.id='staff-2';return {...body,state:'completed'};
  };
  await assert.rejects(a.api.save('order-1',3));
  a.context.POSNIC.session.user.id='staff-1';assert.ok(a.api.pending('order-1'));
});
test('double taps share one in-flight request',async()=>{
  const a=app();let release;const gate=new Promise(resolve=>release=resolve);let calls=0;
  a.context.POSNIC.api.post=async(url,body)=>{calls++;await gate;return {...body,state:'completed'};};
  const first=a.api.save('order-1',3),second=a.api.save('order-1',3);
  release();await Promise.all([first,second]);assert.equal(calls,1);
});
