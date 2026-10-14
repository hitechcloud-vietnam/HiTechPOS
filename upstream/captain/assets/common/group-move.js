/* Durable group moves are scoped to the signed-in shop, staff and branch. */
(function(root){
  const active = new Map();
  const issuer = () => root.POSNIC?.session?.base || root.POSNIC?.server?.baseUrl || '';
  function identity(){
    const s=root.POSNIC?.session, branch=localStorage.getItem('branch_id');
    if(!s?.shopKey || !s.user?.id || !branch)throw new Error(root.I18N?.t('Sign in with your account') || 'Sign in with your account');
    return JSON.stringify([s.shopKey,s.user.id,branch]);
  }
  const key=(owner,order)=>'posnic.group-move:'+owner+':'+order;
  function read(order){
    const owner=identity();
    const value=JSON.parse(localStorage.getItem(key(owner,order))||'null');
    if(value && (value.owner!==owner || value.body.orderId!==order))throw new Error(root.I18N?.t('Could not save. Please try again.') || 'Could not save. Please try again.');
    return value;
  }
  function save(order,selection){
    const existing=read(order);
    if(existing)return existing;
    const owner=identity();
    const entry={owner,issuer:issuer(),body:{orderId:order,request_id:crypto.randomUUID(),tableIds:selection.tableIds,primaryId:selection.primaryId,guests:selection.guests,...(selection.targetOrderId ? {targetOrderId:selection.targetOrderId} : {}),...(selection.dineType ? {dineType:selection.dineType} : {})}};
    localStorage.setItem(key(owner,order),JSON.stringify(entry));
    return entry;
  }
  async function run(entry){
    const storageKey=key(entry.owner,entry.body.orderId);
    if(active.has(storageKey))return active.get(storageKey);
    const same=()=>{
      if(identity()!==entry.owner)throw new Error(root.I18N?.t('Sign in with your account') || 'Sign in with your account');
      if(entry.issuer !== undefined && entry.issuer !== issuer())throw new Error(root.I18N?.t('Reconnect to the server that authorized this phone. Orders are retained.') || 'Reconnect to the server that authorized this phone. Orders are retained.');
    };
    const operation=(async()=>{
      same();
      let cancellationConflict;
      if (entry.cancel || entry.cancelReady) {
        let cancelled;
        try {
          cancelled=await root.POSNIC.api.post('/captain/v1/tables/move/cancel',{
            request_id:entry.body.request_id,orderId:entry.body.orderId
          });
        } catch (error) {
          if (error.status !== 409) throw error;
          cancellationConflict=error;
        }
        same();
        if (!cancellationConflict) {
          if(cancelled?.request_id!==entry.body.request_id || cancelled.state!=='cancelled')throw new Error(root.I18N?.t('Could not save. Please try again.') || 'Could not save. Please try again.');
          localStorage.removeItem(storageKey);
          return {type:'success',cancelled:true};
        }
      }
      const prepared=await root.POSNIC.api.post(entry.body.targetOrderId ? '/captain/v1/tables/merge/prepare' : '/captain/v1/tables/move/prepare',entry.body);
      same();
      if(prepared.request_id!==entry.body.request_id || prepared.orderId!==entry.body.orderId || (entry.body.targetOrderId && prepared.mergeTargetId!==entry.body.targetOrderId))throw new Error(root.I18N?.t('Could not save. Please try again.') || 'Could not save. Please try again.');
      // A reservation conflict is not permission to finish a cancelled move.
      // Only reconcile a move the server confirms has already begun applying.
      if (cancellationConflict && !['applying','submitting'].includes(prepared.state))throw cancellationConflict;
      const result=await root.POSNIC.api.post('/captain/v1/tables/move/complete',{request_id:entry.body.request_id});
      same();
      if(result.request_id!==entry.body.request_id || result.orderId!==entry.body.orderId || result.state!=='submitting' || (entry.body.targetOrderId && result.mergeTargetId!==entry.body.targetOrderId) || (entry.body.dineType && result.dineType!==entry.body.dineType))throw new Error(root.I18N?.t('Could not save. Please try again.') || 'Could not save. Please try again.');
      localStorage.removeItem(storageKey);
      return {type:'success',tableIds:result.tableIds,dineType:result.dineType};
    })();
    active.set(storageKey,operation);
    try{return await operation;}finally{active.delete(storageKey);}
  }
  function cancel(order) {
    const entry=read(order);
    if (!entry) throw new Error(root.I18N?.t('Choose a table first.') || 'Choose a table first.');
    const storageKey=key(entry.owner,order);
    // Do not turn an in-flight completion into a concurrent cancellation.
    if(active.has(storageKey))return active.get(storageKey);
    entry.cancel=true;
    localStorage.setItem(storageKey,JSON.stringify(entry));
    return run(entry);
  }
  function selection(tables, ids, primaryId, guests) {
    const tableIds=[...new Set(ids)];
    const rows=tableIds.map(id=>tables.find(row=>row.id===id));
    const reached=new Set(tableIds.length?[tableIds[0]]:[]);
    let changed=true;
    while(changed){
      changed=false;
      for(const row of rows.filter(Boolean))for(const other of rows.filter(Boolean)){
        if(reached.has(row.id) && !reached.has(other.id) &&
          ((row.adjacent||[]).includes(other.id)||(other.adjacent||[]).includes(row.id))){
          reached.add(other.id);changed=true;
        }
      }
    }
    const maximum=rows.reduce((sum,row)=>sum+(row?.max||0),0);
    const known=rows.every(row=>row?.capacity>0 && row?.max>0);
    return {tableIds,primaryId,guests,maximum,
      valid:tableIds.length>0 && tableIds.length<=20 && rows.every(Boolean) &&
        tableIds.includes(primaryId) && reached.size===tableIds.length &&
        (tableIds.length===1 || known) && (!maximum || guests<=maximum)};
  }
  root.CaptainGroupMove={selection,cancel,pending:read,move:(order,selection)=>run(save(order,selection)),resume:order=>{const entry=read(order);if(!entry)throw new Error(root.I18N?.t('Choose a table first.') || 'Choose a table first.');return run(entry);}};
})(globalThis);
