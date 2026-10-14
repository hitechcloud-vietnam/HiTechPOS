/* Transfers retain the original issuer, staff and request through uncertain responses. */
(function(root){
  'use strict';
  const active=new Map();
  const t=text=>root.I18N?.t(text)||text;
  const invalid=()=>new Error(t('Could not save. Please try again.'));
  const issuer=()=>root.POSNIC?.session?.base||root.POSNIC?.server?.baseUrl||'';
  function owner(){
    const session=root.POSNIC?.session,branch=localStorage.getItem('branch_id');
    if(!session?.shopKey||!session.user?.id||!branch)throw new Error(t('Sign in with your account'));
    return JSON.stringify([session.shopKey,session.user.id,branch]);
  }
  const key=(identity,order)=>'posnic.item-transfer:'+identity+':'+order;
  const oid=value=>typeof value==='string'&&/^[a-f0-9]{24}$/i.test(value);
  function valid(body){
    const d=body?.destination;
    return oid(body?.orderId)&&typeof body.requestId==='string'&&/^[a-zA-Z0-9_-]{16,80}$/.test(body.requestId)&&
      typeof body.revision==='string'&&/^[a-f0-9]{64}$/.test(body.revision)&&
      Array.isArray(body.items)&&body.items.length>0&&body.items.length<=200&&
      body.items.every(row=>row&&typeof row.id==='string'&&row.id.length>0&&row.id.length<=160&&
        Number.isFinite(row.quantity)&&row.quantity>0&&
        (row.servedQuantity===undefined||(Number.isFinite(row.servedQuantity)&&row.servedQuantity>=0&&row.servedQuantity<=row.quantity)))&&
      new Set(body.items.map(row=>row.id)).size===body.items.length&&
      Array.isArray(d?.tableIds)&&d.tableIds.length>0&&d.tableIds.length<=20&&d.tableIds.every(oid)&&
      new Set(d.tableIds).size===d.tableIds.length&&d.tableIds.includes(d.primaryId)&&
      Number.isInteger(d.guests)&&d.guests>0&&d.guests<=1000;
  }
  // The screen selects kitchen round identities, never catalogue IDs. Two
  // preparations of the same dish must remain separate, including their notes.
  function selection(rounds,choices){
    if(!Array.isArray(rounds)||!Array.isArray(choices)||!choices.length||choices.length>200)throw invalid();
    const lines=new Map(),seen=new Set();
    const units=value=>{
      if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1000000)throw invalid();
      const n=Math.round(value*1000);if(Math.abs(n-value*1000)>0.000001)throw invalid();return n;
    };
    for(const round of rounds)for(const line of round.items||[]){
      if(!line?.id||lines.has(line.id))throw invalid();lines.set(line.id,line);
    }
    return choices.map(choice=>{
      const line=lines.get(choice?.id);
      if(!line||seen.has(choice.id))throw invalid();seen.add(choice.id);
      const quantity=units(choice.quantity),available=units(line.quantity),served=units(line.served||0);
      if(!quantity||quantity>available||served>available)throw invalid();
      let moved=choice.servedQuantity;
      if(moved===undefined){
        if(quantity===available)moved=served/1000;
        else if(!served)moved=0;
        else if(served===available)moved=quantity/1000;
        else throw Object.assign(new Error(t('Served')),{code:'SERVED_QUANTITY_REQUIRED',lineId:choice.id});
      }
      const count=units(moved);
      if(count>quantity||count>served||quantity-count>available-served)throw invalid();
      return {id:choice.id,quantity:quantity/1000,servedQuantity:count/1000};
    });
  }
  function pending(order){
    const identity=owner(),entry=JSON.parse(localStorage.getItem(key(identity,order))||'null');
    if(entry&&(entry.owner!==identity||entry.body?.orderId!==order||!entry.issuer||!valid(entry.body)))throw invalid();
    return entry;
  }
  function remember(order,input){
    const existing=pending(order);if(existing)return existing;
    const body=JSON.parse(JSON.stringify({orderId:order,requestId:crypto.randomUUID(),
      revision:input.revision,items:input.items,destination:input.destination}));
    if(!valid(body)||!issuer())throw invalid();
    const entry={owner:owner(),issuer:issuer(),body};
    localStorage.setItem(key(entry.owner,order),JSON.stringify(entry));
    return entry;
  }
  async function run(entry){
    const storageKey=key(entry.owner,entry.body.orderId);
    if(active.has(storageKey))return active.get(storageKey);
    const same=()=>{
      if(owner()!==entry.owner)throw new Error(t('Sign in with your account'));
      if(issuer()!==entry.issuer)throw new Error(t('Reconnect to the server that authorized this phone. Orders are retained.'));
    };
    const matches=result=>result?.requestId===entry.body.requestId&&result.sourceId===entry.body.orderId;
    function accepted(result){
      same();
      if(!matches(result)||result.state!=='completed'||!oid(result.destinationId)||typeof result.sourceClosed!=='boolean')throw invalid();
      localStorage.removeItem(storageKey);return result;
    }
    const operation=(async()=>{
      same();
      try{return accepted(await root.POSNIC.api.post('/captain/v1/tables/transfer/complete',entry.body));}
      catch(error){
        same();
        try{
          const result=await root.POSNIC.api.post('/captain/v1/tables/transfer/status',{
            orderId:entry.body.orderId,requestId:entry.body.requestId});
          same();
          if(matches(result)&&result.state==='completed')return accepted(result);
          if(matches(result)&&result.state==='cancelled')localStorage.removeItem(storageKey);
        }catch{/* Uncertain recovery retains the original request. */}
        throw error;
      }
    })();
    active.set(storageKey,operation);
    try{return await operation;}finally{active.delete(storageKey);}
  }
  root.CaptainItemTransfer={selection,pending,complete:(order,input)=>run(remember(order,input)),resume:order=>{
    const entry=pending(order);if(!entry)throw invalid();return run(entry);
  }};
})(globalThis);
