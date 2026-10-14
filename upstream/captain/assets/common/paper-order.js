/* Photo drafts stay on the phone until the ordinary durable order queue accepts them. */
(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let draft, menu = [], tables = [], dialog, busy = false, cropStart, cropEnd;
  const scope = () => `${POSNIC.session.shopKey || POSNIC.server.baseUrl}|${localStorage.getItem('branch_id') || ''}|${POSNIC.session.user?.id || ''}`;
  async function storage(value) {
    const db = await new Promise((resolve,reject) => {
      const request = indexedDB.open('captain-paper-orders',1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try { return await new Promise((resolve,reject) => {
      const tx=db.transaction('drafts', value === undefined ? 'readonly':'readwrite');
      const store=tx.objectStore('drafts');
      const request=value === undefined ? store.get(scope()) : value === null ? store.delete(scope()) : store.put(value,scope());
      tx.oncomplete=()=>resolve(request.result); tx.onerror=()=>reject(tx.error);
    }); } finally { db.close(); }
  }
  function message(text) { dialog.querySelector('[role=status]').textContent=text; }
  function match(line) {
    const full = menu.filter(p => norm(p.name) === norm(line.text));
    if (full.length === 1) return { ...line, item: full[0].id, quantity: null }; // Chicken 65 isn't quantity 65.
    const hits=menu.filter(p => norm(p.name)===norm(line.name) || norm(p.code)===norm(line.name) || norm(p.name.split(/\s+/).map(w=>w[0]).join(''))===norm(line.name));
    return { ...line, item: hits.length===1 ? hits[0].id : '', reviewed: false };
  }
  function itemOptions(selected) { return '<option value="">Choose menu item</option>'+menu.map(p=>`<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>${esc(p.name)}</option>`).join(''); }
  async function open() {
    if (dialog) { dialog.showModal(); return; }
    try {
      [menu, tables, draft] = await Promise.all([getData('products'), POSNIC.api.get('/captain/v1/tables'), storage()]);
      menu=Array.isArray(menu)?menu:[]; tables=CaptainTables.liveRows(tables);
      draft=draft||{id:crypto.randomUUID(),rows:[],table:'',pax:'',original:''};
      dialog=document.createElement('dialog'); dialog.className='paper-order-dialog';
      dialog.innerHTML=`<header><h2>Paper order</h2><button type="button" data-close aria-label="Close">×</button></header>
        <p role="status" aria-live="polite"></p><div data-content></div>`;
      document.body.append(dialog); dialog.querySelector('[data-close]').onclick=()=>{if(!busy)dialog.close();};
      dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
      dialog.showModal(); render();
    } catch(e) { showErrorPopup(e.message||'Could not open paper orders.'); }
  }
  function render() {
    const host=dialog.querySelector('[data-content]');
    if(draft.submission){
      host.innerHTML='<p>Order saved. Retry sending the same order.</p><button type="button" data-retry>Retry</button>';
      host.querySelector('[data-retry]').onclick=send;return;
    }
    host.innerHTML=`${draft.result?'<details><summary>Photo</summary>':''}<label class="paper-camera">Take or choose photo<input type="file" accept="image/jpeg,image/png" capture="environment"></label>
      ${draft.original?'<div class="paper-preview"><canvas aria-label="Drag to select the writing area"></canvas></div><p>Drag around the writing to crop, or process the whole photo. The original is kept.</p><button type="button" data-process>Read photo</button><button type="button" data-reset>Whole photo</button>':''}
      ${draft.result?`</details><section><h3>Review order</h3><p>Check every item and quantity before sending.</p>
      <div class="paper-seating"><label>Table<select data-table><option value="">Choose table</option>${tables.map(t=>`<option value="${esc(t.id)}" ${t.id===draft.table?'selected':''}>${esc(t.tableorder_value)}</option>`).join('')}</select></label><label>Guests (optional)<input data-pax type="number" min="1" max="999" value="${esc(draft.pax)}"></label></div>
      <div data-rows>${draft.rows.map((r,i)=>`<div class="paper-row" data-row="${i}"><small>${esc(r.text||'Added item')}${r.confidence<90?' · Check handwriting':''}</small>
      <label>Item<select data-item>${itemOptions(r.item)}</select></label><label>Quantity<input data-qty type="number" min="0.01" max="999" step="0.01" value="${esc(r.quantity??'')}"></label><label>Kitchen note<input data-note maxlength="200" value="${esc(r.note||'')}"></label><button type="button" data-remove>Remove</button></div>`).join('')}</div>
      <button type="button" data-add>Add item</button><button class="paper-send" type="button" data-send>Send to kitchen</button></section>`:''}`;
    host.querySelector('input[type=file]').onchange=async e=>{
      if(busy)return; const file=e.target.files[0]; if(!file)return;
      if(file.size>5*1024*1024){message('Choose a photo under 5 MB.');return;}
      const original=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);});
      draft={id:crypto.randomUUID(),original,rows:[],table:'',pax:''};cropStart=cropEnd=null;
      try {await storage(draft);render();}catch{message('Photo could not be saved. Free phone storage and retry.');}
    };
    if(draft.original) { draw(); host.querySelector('[data-process]').onclick=process;
      host.querySelector('[data-reset]').onclick=()=>{cropStart=cropEnd=null;draw();}; }
    if(!draft.result)return;
    host.querySelector('[data-table]').onchange=e=>{draft.table=e.target.value;persist();};
    host.querySelector('[data-pax]').oninput=e=>{draft.pax=e.target.value;persist();};
    host.querySelectorAll('[data-row]').forEach(row=>{
      const i=Number(row.dataset.row);
      row.querySelector('[data-item]').onchange=e=>{draft.rows[i].item=e.target.value;persist();};
      row.querySelector('[data-qty]').oninput=e=>{draft.rows[i].quantity=e.target.value===''?null:Number(e.target.value);persist();};
      row.querySelector('[data-note]').oninput=e=>{draft.rows[i].note=e.target.value;persist();};
      row.querySelector('[data-remove]').onclick=()=>{draft.rows.splice(i,1);persist();render();};
    });
    host.querySelector('[data-add]').onclick=()=>{draft.rows.push({text:'',item:'',quantity:1,confidence:100});persist();render();};
    host.querySelector('[data-send]').onclick=send;
  }
  function persist() { storage(draft).catch(()=>message('Changes could not be saved. Keep this screen open and retry.')); }
  async function bitmap() { const img=new Image();img.src=draft.original;await img.decode();return img; }
  async function draw() {
    const canvas=dialog.querySelector('canvas'), img=await bitmap();
    canvas.width=img.width;canvas.height=img.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
    if(cropStart&&cropEnd){ctx.strokeStyle='#2458dc';ctx.lineWidth=Math.max(3,img.width/150);ctx.strokeRect(cropStart.x,cropStart.y,cropEnd.x-cropStart.x,cropEnd.y-cropStart.y);}
    const point=e=>{const r=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(canvas.width,(e.clientX-r.left)*canvas.width/r.width)),y:Math.max(0,Math.min(canvas.height,(e.clientY-r.top)*canvas.height/r.height))};};
    canvas.onpointerdown=e=>{if(busy)return;canvas.setPointerCapture(e.pointerId);cropStart=point(e);cropEnd=null;};
    canvas.onpointerup=e=>{if(busy||!cropStart)return;cropEnd=point(e);draw();};
  }
  async function process() {
    if(busy)return;busy=true;dialog.querySelector('[data-content]').inert=true;message('Reading handwriting…');
    try {
      let crop;
      if(cropStart&&cropEnd){const width=Math.abs(cropEnd.x-cropStart.x),height=Math.abs(cropEnd.y-cropStart.y);
        if(width<20||height<20)throw new Error('Select a larger writing area.');
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
        canvas.getContext('2d').drawImage(await bitmap(),Math.min(cropStart.x,cropEnd.x),Math.min(cropStart.y,cropEnd.y),width,height,0,0,width,height);crop=canvas.toDataURL('image/jpeg',0.9);
      }
      // A new crop is a new recognition request; retrying unchanged bytes keeps its ID.
      if((crop||'')!==(draft.crop||'')){draft.id=crypto.randomUUID();draft.crop=crop||'';}
      await storage(draft);
      const result=await POSNIC.api.post('/captain/v1/paper-orders/recognize',{id:draft.id,original:draft.original,crop:draft.crop||undefined},{timeout:90000});
      draft.result=true;draft.rows=result.lines.map(match);draft.pax=result.pax||'';
      draft.table=tables.find(t=>norm(t.tableorder_value)===norm(result.table))?.id||'';
      await storage(draft);render();message(result.truncated?'Some lines were not included. Add missing items before sending.':draft.rows.length?'Check the draft below.':'No items found. Retake the photo or add items below.');
    }catch(e){message(e.message||'Could not read photo. Retry when connected.');}finally{busy=false;dialog.querySelector('[data-content]').inert=false;}
  }
  async function send() {
    if(busy)return;busy=true;dialog.querySelector('[data-content]').inert=true;
    try {
      if(draft.submission){await queueSubmission();return;}
      const table=tables.find(t=>t.id===draft.table);
      if(!table)throw new Error('Choose a table.');
      if(!draft.rows.length)throw new Error('Add an item.');
      if(draft.pax!==''&&(!Number.isInteger(Number(draft.pax))||Number(draft.pax)<1||Number(draft.pax)>999))throw new Error('Check the guest count.');
      const items=[];
      for(const row of draft.rows){const product=menu.find(p=>p.id===row.item);
        if(!product||!Number.isFinite(row.quantity)||row.quantity<=0||row.quantity>999)throw new Error('Choose an item and quantity on every line.');
        // Let the established menu ask for preparations and daily prices.
        let price=Number(product.selling_price??product.subtotal??product.price), modifiers=[];
        if(MenuView.askPrice(product)||POSNIC.optionRules?.hasOptions(product)) {
          dialog.close();
          try {
            if(MenuView.askPrice(product)){price=await POSNIC.askPrice(product.name);if(!price)throw new Error('Price entry cancelled. Your draft is kept.');}
            modifiers=await POSNIC.askOptions(product);
            if(modifiers===null)throw new Error('Item options cancelled. Your draft is kept.');
          } finally {dialog.showModal();}
        }
        items.push({item_id:product.id,line_id:crypto.randomUUID(),item_name:product.name,item_quantity:row.quantity,
          item_price:price,item_description:row.note||'',modifiers:modifiers.map(m=>({group:m.group||'',name:m.name||''}))});
      }
      if(POSNIC.session.canTakeOrders===false)throw new Error('Reconnect your account before sending.');
      const branches=await getData(BRANCH_STORE), branch=branches?.[0]?.branch_id||branches?.[0]?.id||localStorage.getItem('branch_id');
      if(!branch)throw new Error('Choose a branch first.');
      draft.orderKey=draft.orderKey||OrderQueue.newKey();await storage(draft);
      const body={idempotencyKey:draft.orderKey,branch,items,paper_order_id:draft.id,
        client:POSNIC.thisDevice?.facts()||{},customerMobile:'',sale_method:'Table-Order',order:'Dine-in',dine_type:'Dine-in',
        kiosk_table_id:table.id,kiosk_table_no:table.tableorder_value,person_count:draft.pax===''?'':Number(draft.pax)};
      draft.submission=body;await storage(draft);
      await queueSubmission();
    }catch(e){if(draft.submission)render();message(e.message||'Order could not be saved. Retry.');}finally{busy=false;dialog.querySelector('[data-content]').inert=false;}
  }
  async function queueSubmission(){
    const body=draft.submission;
    if(!OrderQueue.all().some(r=>r.key===body.idempotencyKey)&&!OrderQueue.add({key:body.idempotencyKey,branch:body.branch,body,held:false}))throw new Error('Order could not be saved. Free phone storage and retry.');
    await storage(null);dialog.close();location.href='kot-management.html';
  }
  document.addEventListener('DOMContentLoaded',async()=>{
    const button=document.getElementById('paper-order-open');if(!button)return;
    async function availability(launch=false){
      button.disabled=true;
      try{
        const options=await POSNIC.api.get('/captain/v1/paper-orders/options');
        button.hidden=!options.enabled;
        if(!options.enabled)return;
        if(launch){
          if(options.configured)await open();
          else showErrorPopup('Paper scanning needs server setup. Ask your manager to configure private photo storage and handwriting recognition in Captain App settings.');
        }
      }catch{
        // A connection failure is not an explicit decision to disable scanning.
        button.hidden=false;
        if(launch)showErrorPopup('Could not check paper scanning. Reconnect and try again. Your saved paper draft is kept.');
      }finally{button.disabled=false;}
    }
    button.onclick=()=>availability(true);
    await availability();
  });
})();
