/* Cover updates retain their original shop, staff, branch and issuer on retry. */
(function(root){
  const active=new Map();
  const t=text=>root.I18N?.t(text)||text;
  const issuer=()=>root.POSNIC?.session?.base||root.POSNIC?.server?.baseUrl||'';
  function owner(){
    const session=root.POSNIC?.session, branch=localStorage.getItem('branch_id');
    if(!session?.shopKey||!session.user?.id||!branch)throw new Error(t('Sign in with your account'));
    return JSON.stringify([session.shopKey,session.user.id,branch]);
  }
  const key=(identity,order)=>'posnic.guest-update:'+identity+':'+order;
  const invalid=()=>new Error(t('Could not save. Please try again.'));
  function pending(order){
    const identity=owner(),entry=JSON.parse(localStorage.getItem(key(identity,order))||'null');
    if(entry&&(entry.owner!==identity||entry.body?.orderId!==order||typeof entry.issuer!=='string'||
        typeof entry.body.request_id!=='string'||!Number.isInteger(entry.body.guests)))throw invalid();
    return entry;
  }
  function save(order,guests){
    const existing=pending(order);
    if(existing)return existing;
    if(!Number.isInteger(guests)||guests<1||guests>1000)throw invalid();
    const entry={owner:owner(),issuer:issuer(),body:{orderId:order,guests,request_id:crypto.randomUUID()}};
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
    const matches=result=>result?.request_id===entry.body.request_id&&result.orderId===entry.body.orderId&&result.guests===entry.body.guests;
    const operation=(async()=>{
      same();
      let result;
      try{result=await root.POSNIC.api.post('/captain/v1/tables/guests',entry.body);}
      catch(error){
        same();
        if(error.status===409){
          try{
            const status=await root.POSNIC.api.post('/captain/v1/tables/guests/status',{request_id:entry.body.request_id});
            same();
            if(matches(status)&&status.state==='cancelled')localStorage.removeItem(storageKey);
          }catch{/* An uncertain status must retain the original request. */}
        }
        throw error;
      }
      same();
      if(!matches(result)||result.state!=='completed')throw invalid();
      localStorage.removeItem(storageKey);
      return result;
    })();
    active.set(storageKey,operation);
    try{return await operation;}finally{active.delete(storageKey);}
  }
  root.CaptainGuestUpdate={pending,save:(order,guests)=>run(save(order,guests)),resume:order=>{
    const entry=pending(order);if(!entry)throw invalid();return run(entry);
  }};
})(globalThis);
