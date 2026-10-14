const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/common/order-actions.js'),'utf8');
for(const scenario of ['cancelled','active','different-order','read-failed','server-changed'])test('cancel acknowledgement recovery: '+scenario,async()=>{
 let writes=0,reads=0;const failure=new Error('cleanup failed');const POSNIC={session:{base:'http://till/api'},api:{post:async()=>{writes++;throw failure},get:async()=>{reads++;if(scenario==='read-failed')throw Error('offline');if(scenario==='server-changed')POSNIC.session.base='http://other/api';return {type:'success',data:{_id:scenario==='different-order'?'other':'order',sale_process:scenario==='active'?'KOT':'cancelled',payment_status:scenario==='active'?'Unpaid':'Cancelled'}}}}};
 const context=vm.createContext({window:{},POSNIC,document:{readyState:"loading",addEventListener(){}}});vm.runInContext(source,context);
 const pending=context.window.CaptainOrderActions.save({order_id:'order',status:'cancelled'});
 if(scenario==='cancelled')assert.equal((await pending).type,'success');else await assert.rejects(pending,e=>e===failure);
 assert.equal(writes,1);assert.equal(reads,1);
});
