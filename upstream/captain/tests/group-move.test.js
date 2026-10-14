const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/common/group-move.js'),'utf8');
function app(storage=new Map()){
 const calls=[];
 const context={Map,JSON,Error,crypto:{randomUUID:()=> 'move-request-0001'},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},POSNIC:{session:{shopKey:'shop-1',user:{id:'staff-1'}},api:{post:async(url,body)=>{calls.push({url,body});return {request_id:body.request_id,orderId:'order-1',state:url.endsWith('complete')?'submitting':'reserved'};}}}};
 if(!storage.has('branch_id'))storage.set('branch_id','branch-1');
 vm.runInNewContext(source,context);
 return {context,api:context.CaptainGroupMove,calls,storage};
}
const choice={tableIds:['table-2'],primaryId:'table-2',guests:2};
test('lost response survives app reload and reuses the same request',async()=>{
 const first=app();first.context.POSNIC.api.post=async()=>{throw new Error('offline');};
 await assert.rejects(first.api.move('order-1',choice));
 const saved=first.api.pending('order-1');
 const second=app(first.storage);
 await second.api.resume('order-1');
 assert.equal(second.calls[0].body.request_id,saved.body.request_id);
 assert.equal(second.calls[1].body.request_id,saved.body.request_id);
 assert.equal(second.api.pending('order-1'),null);
});
test('another staff or branch cannot see or resume the saved move',async()=>{
 const a=app();a.context.POSNIC.api.post=async()=>{throw new Error('offline');};
 await assert.rejects(a.api.move('order-1',choice));
 a.context.POSNIC.session.user.id='staff-2';assert.equal(a.api.pending('order-1'),null);
 assert.throws(()=>a.api.resume('order-1'));
 a.context.POSNIC.session.user.id='staff-1';a.storage.set('branch_id','branch-2');assert.equal(a.api.pending('order-1'),null);
});
test('storage failure prevents any API request',()=>{
 const a=app();a.context.localStorage.setItem=()=>{throw new Error('full');};
 assert.throws(()=>a.api.move('order-1',choice));assert.equal(a.calls.length,0);
});
test('session change after prepare cannot continue the previous staff move',async()=>{
 const a=app();
 a.context.POSNIC.api.post=async(url,body)=>{a.calls.push(url);a.context.POSNIC.session.user.id='staff-2';return {request_id:body.request_id,orderId:'order-1'};};
 await assert.rejects(a.api.move('order-1',choice));assert.equal(a.calls.length,1);
 a.context.POSNIC.session.user.id='staff-1';assert.ok(a.api.pending('order-1'));
});

test('cancel retry survives a lost acknowledgement without preparing again',async()=>{
 const a=app();a.context.POSNIC.api.post=async()=>{throw new Error('offline');};
 await assert.rejects(a.api.move('order-1',choice));
 a.context.POSNIC.api.post=async(url,body)=>{
   if(url.endsWith('prepare'))return {request_id:body.request_id,orderId:'order-1',state:'reserved'};
   throw new Error('lost cancel reply');
 };
 await assert.rejects(a.api.cancel('order-1'));
 assert.equal(a.api.pending('order-1').cancel,true);
 const b=app(a.storage);
 b.context.POSNIC.api.post=async(url,body)=>{b.calls.push(url);return {request_id:body.request_id,state:'cancelled'};};
 assert.equal((await b.api.resume('order-1')).cancelled,true);
 assert.deepEqual(b.calls,['/captain/v1/tables/move/cancel']);
 assert.equal(b.api.pending('order-1'),null);
});
test('cancellation reconciles an already applying move without claiming it was cancelled',async()=>{
 const a=app();a.context.POSNIC.api.post=async()=>{throw new Error('offline');};
 await assert.rejects(a.api.move('order-1',choice));
 a.context.POSNIC.api.post=async(url,body)=>{
   a.calls.push(url);
   if(url.endsWith('cancel'))throw Object.assign(new Error('applying'),{status:409});
   return {request_id:body.request_id,orderId:'order-1',state:url.endsWith('prepare')?'applying':'submitting'};
 };
 const result=await a.api.cancel('order-1');
 assert.equal(result.cancelled,undefined);
 assert.equal(a.calls.some(url=>url.endsWith('cancel')),true);
 assert.equal(a.api.pending('order-1'),null);
});
test('completion winning cancellation race is reconciled',async()=>{
 const a=app();a.context.POSNIC.api.post=async()=>{throw new Error('offline');};
 await assert.rejects(a.api.move('order-1',choice));
 a.context.POSNIC.api.post=async(url,body)=>{
   if(url.endsWith('cancel'))throw Object.assign(new Error('applying'),{status:409});
   return {request_id:body.request_id,orderId:'order-1',state:url.endsWith('prepare')?'applying':'submitting'};
 };
 assert.equal((await a.api.cancel('order-1')).cancelled,undefined);
 assert.equal(a.api.pending('order-1'),null);
});

test('cancel before preparation sends the order identity without preparing a destination',async()=>{
 const a=app();a.context.POSNIC.api.post=async()=>{throw new Error('offline');};
 await assert.rejects(a.api.move('order-1',choice));
 a.context.POSNIC.api.post=async(url,body)=>{a.calls.push({url,body});return {request_id:body.request_id,state:'cancelled'};};
 assert.equal((await a.api.cancel('order-1')).cancelled,true);
 assert.equal(a.calls.length,1);
 assert.equal(a.calls[0].url,'/captain/v1/tables/move/cancel');
 assert.equal(a.calls[0].body.orderId,'order-1');
});
test('a generic cancellation conflict cannot complete a still reserved move',async()=>{
 const a=app();a.context.POSNIC.api.post=async()=>{throw new Error('offline');};
 await assert.rejects(a.api.move('order-1',choice));
 a.context.POSNIC.api.post=async(url,body)=>{
   a.calls.push(url);
   if(url.endsWith('cancel'))throw Object.assign(new Error('revision changed'),{status:409});
   return {request_id:body.request_id,orderId:'order-1',state:'reserved'};
 };
 await assert.rejects(a.api.cancel('order-1'));
 assert.equal(a.calls.some(url=>url.endsWith('complete')),false);
 assert.equal(a.api.pending('order-1').cancel,true);
});

test('group selection counts connected seats and rejects disconnected or unknown-capacity groups',()=>{
 const a=app();
 const tables=[{id:'a',capacity:2,max:3,adjacent:['b']},{id:'b',capacity:2,max:3,adjacent:['c']},{id:'c',capacity:2,max:3,adjacent:[]}];
 assert.equal(a.api.selection(tables,['a','b','c'],'b',8).valid,true);
 assert.equal(a.api.selection(tables,['a','c'],'a',4).valid,false);
 assert.equal(a.api.selection(tables,['a','b'],'a',7).valid,false);
 assert.equal(a.api.selection(tables,['a','b'],'c',4).valid,false);
 tables[1].capacity=0;tables[1].max=0;
 assert.equal(a.api.selection(tables,['a','b'],'a',2).valid,false);
});

test('takeaway transition retains its type on retry and requires confirmation from the server',async()=>{
 const a=app();
 a.context.POSNIC.api.post=async(url,body)=>{a.calls.push({url,body});return {request_id:body.request_id,orderId:'order-1',state:url.endsWith('complete')?'submitting':'reserved'};};
 await assert.rejects(a.api.move('order-1',{tableIds:[],primaryId:'',guests:0,dineType:'Take away'}));
 assert.equal(a.api.pending('order-1').body.dineType,'Take away');
 const firstId=a.api.pending('order-1').body.request_id;
 a.context.POSNIC.api.post=async(url,body)=>{a.calls.push({url,body});return {request_id:body.request_id,orderId:'order-1',state:url.endsWith('complete')?'submitting':'reserved',dineType:'Take away',tableIds:[]};};
 const result=await a.api.resume('order-1');
 assert.equal(result.dineType,'Take away');
 assert.ok(a.calls.every(call=>call.body.request_id===firstId));
 assert.equal(a.api.pending('order-1'),null);
});

test('an interrupted move cannot be replayed against another issuing server',async()=>{
 const a=app();a.context.POSNIC.session.base='https://first.posnic.io/api';
 a.context.POSNIC.api.post=async()=>{throw new Error('lost acknowledgement');};
 await assert.rejects(a.api.move('order-1',choice));
 const saved=a.api.pending('order-1');
 const b=app(a.storage);b.context.POSNIC.session.base='https://second.posnic.io/api';
 await assert.rejects(b.api.resume('order-1'),/Reconnect to the server/);
 assert.equal(b.calls.length,0);
 assert.equal(b.api.pending('order-1').body.request_id,saved.body.request_id);
 b.context.POSNIC.session.base='https://first.posnic.io/api';
 await b.api.resume('order-1');
 assert.equal(b.calls.length,2);
 assert.equal(b.api.pending('order-1'),null);
});


test('merge retry retains target identity and uses the dedicated preparation route',async()=>{
 const a=app();a.context.POSNIC.api.post=async()=>{throw new Error('offline');};
 await assert.rejects(a.api.move('order-1',{...choice,targetOrderId:'target-order'}));
 const entry=a.api.pending('order-1');
 a.context.POSNIC.api.post=async(url,body)=>{a.calls.push({url,body});return {request_id:body.request_id,orderId:'order-1',mergeTargetId:'target-order',state:url.endsWith('complete')?'submitting':'reserved'};};
 await a.api.resume('order-1');
 assert.equal(a.calls[0].url,'/captain/v1/tables/merge/prepare');
 assert.equal(a.calls[0].body.targetOrderId,'target-order');
 assert.equal(a.calls[1].body.request_id,entry.body.request_id);
 assert.equal(a.api.pending('order-1'),null);
});

test('merge cannot finish if the server acknowledges another destination order',async()=>{
 const a=app();a.context.POSNIC.api.post=async(url,body)=>{a.calls.push({url,body});return {request_id:body.request_id,orderId:'order-1',mergeTargetId:'wrong-target',state:'reserved'};};
 await assert.rejects(a.api.move('order-1',{...choice,targetOrderId:'target-order'}));
 assert.equal(a.calls.length,1);assert.ok(a.api.pending('order-1'));
});
