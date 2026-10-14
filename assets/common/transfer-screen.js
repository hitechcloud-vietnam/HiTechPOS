/* Item transfer: select preparations, choose seating, review, then confirm. */
(function(root){
 'use strict';
 const t=s=>root.I18N?.t(s)||s;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 // Whole servings use whole steps; retain precision for recorded fractional portions.
 const quantityStep=line=>[line.quantity,line.served||0].every(value=>Number.isInteger(Number(value))) ? 1 : 0.001;
 const eligible=value=>!!value && !['cancelled','canceled','completed','closed'].includes(String(value.status || '').toLowerCase()) && (!value.sale_process || value.sale_process === 'KOT') && (!value.payment_status || value.payment_status === 'Unpaid') && !value.floor_closed_at;
 const registered=new Map();
 const historyKey='captainTransfer';
 let ownsHistory=false,cleaningHistory=false,queuedOrder=null;
 let dialog,order,stage,items,tables,preview,destination,busy=false,generation=0,identity;
 const owner=()=>JSON.stringify([root.POSNIC.session?.shopKey,root.POSNIC.session?.user?.id,localStorage.getItem('branch_id'),root.POSNIC.session?.base]);
 const money=n=>new Intl.NumberFormat(root.I18N?.language?.()||'en',{style:'currency',currency:preview.currencyCode,minimumFractionDigits:preview.currencyDigits,maximumFractionDigits:preview.currencyDigits}).format(n/10**preview.currencyDigits);
 function ownHistory(){history.pushState({...history.state,[historyKey]:true},'',location.href);ownsHistory=true;}
 function close(){
  generation++;dialog.close();
  if(ownsHistory&&history.state?.[historyKey]){ownsHistory=false;cleaningHistory=true;history.back();}
  else ownsHistory=false;
 }
 function back(){if(busy||stage==='items'||stage==='recovery'){close();return;}stage=stage==='review'?'tables':'items';render();}
 function render(error=''){
  if(identity!==owner()){close();return;}
  const pending=root.CaptainItemTransfer.pending(order._id);
  let body='';
  if(stage==='items')body=(order.kitchen_rounds||[]).map(round=>`<section><time>${esc(round.ordered_at?new Date(round.ordered_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'')}</time>${round.items.map(line=>`<fieldset data-line="${esc(line.id)}"><legend translate="no">${esc(line.name)}</legend>${line.note?`<p translate="no">${esc(line.note)}</p>`:''}<label>${t('Items')} <input type="number" min="0" max="${line.quantity}" step="${quantityStep(line)}" value="${items?.find(i=>i.id===line.id)?.quantity||0}" data-quantity aria-label="${t('Items')}"></label><small translate="no"> / ${line.quantity}</small><label>${t('Served')} <input type="number" min="0" max="${line.served||0}" step="${quantityStep(line)}" value="${items?.find(i=>i.id===line.id)?.servedQuantity||0}" data-served aria-label="${t('Served')}"></label></fieldset>`).join('')}</section>`).join('');
  if(stage==='tables')body=`<label>${t('Guests')} <input id="transfer-guests" type="number" min="1" max="1000" value="${destination?.guests||1}"></label><div class="transfer-tables">${tables.filter(row=>row.status==='available'&&!row.closing).map(row=>`<label><input type="checkbox" value="${esc(row.id)}" ${destination?.tableIds.includes(row.id)?'checked':''}> <span>${t('Table')} <b translate="no">${esc(row.tableorder_value)}</b><small>${t('Guests')}: ${row.max||row.capacity||'—'}</small></span></label>`).join('')}</div><label id="transfer-primary-label">${t('Main table')} <select id="transfer-primary"></select></label>`;
  if(stage==='review')body=`<section><h3>${t('Items')}</h3>${preview.destination.rounds.map(line=>`<div class="transfer-review-line"><p translate="no">${esc(line.name)} × ${line.quantity}</p>${line.note?`<small translate="no">${esc(line.note)}</small>`:''}${line.served?`<small>${t('Served')}: ${line.served}</small>`:''}</div>`).join('')}<p>${t('Table')} <b translate="no">${destination.tableIds.map(id=>esc(tables.find(row=>row.id===id)?.tableorder_value||id)).join(', ')}</b></p><p>${t('Main table')}: <b translate="no">${esc(tables.find(row=>row.id===destination.primaryId)?.tableorder_value||'')}</b></p><p>${t('Guests')}: ${destination.guests}</p><p>${t('Total')}: <strong translate="no">${esc(money(preview.destination.totalMinor))}</strong></p></section><section class="transfer-source"><h3>${t('Table')} <span translate="no">${esc(order.table_number||order.kiosk_table_no||'')}</span></h3><p>${t('Total')}: <strong translate="no">${esc(money(preview.source.totalMinor))}</strong></p></section>`;
  if(stage==='recovery')body=`<p>${t('Reconnect to the server that authorized this phone. Orders are retained.')}</p>`;
  dialog.innerHTML=`<header><button type="button" data-back>${t('Back')}</button><h2>${t('Transfer items')}</h2></header><form><main>${body}<p role="alert">${esc(error)}</p></main><footer><button type="submit" ${busy?'disabled':''}>${t(busy?'Loading':pending?'Retry':stage==='review'?'Save':'Continue')}</button></footer></form>`;
  dialog.querySelector('[data-back]').onclick=back;
  if(stage==='tables'){
   const primary=dialog.querySelector('#transfer-primary');
   const sync=()=>{
    const ids=[...dialog.querySelectorAll('input[type=checkbox]:checked')].map(input=>input.value);
    const selected=primary.value||destination?.primaryId;
    primary.innerHTML=ids.map(id=>`<option value="${esc(id)}" ${id===selected?'selected':''}>${esc(tables.find(row=>row.id===id)?.tableorder_value)}</option>`).join('');
    dialog.querySelector('#transfer-primary-label').hidden=ids.length<2;
   };
   dialog.querySelectorAll('input[type=checkbox]').forEach(input=>input.addEventListener('change',sync));sync();
  }
  dialog.querySelector('form').onsubmit=event=>{event.preventDefault();void next();};
 }
 async function next(){
  if(busy)return;
  const current=++generation;
  const valid=()=>{
   if(current!==generation||!dialog.open)return false;
   if(identity!==owner()){close();return false;}
   return true;
  };
  try{
   if(identity!==owner())throw new Error(t('Sign in with your account'));
   if(stage==='items'){
    const choices=[...dialog.querySelectorAll('[data-line]')].map(row=>({id:row.dataset.line,quantity:Number(row.querySelector('[data-quantity]').value),servedQuantity:Number(row.querySelector('[data-served]').value)})).filter(row=>row.quantity!==0);
    items=choices;items=root.CaptainItemTransfer.selection(order.kitchen_rounds,choices);
    busy=true;render();const result=await root.POSNIC.api.get('/captain/v1/tables');
    if(!valid())return;tables=result.tables;stage='tables';
   }else if(stage==='tables'){
    const ids=[...dialog.querySelectorAll('input[type=checkbox]:checked')].map(input=>input.value);
    const guests=Number(dialog.querySelector('#transfer-guests').value);
    destination=root.CaptainGroupMove.selection(tables,ids,dialog.querySelector('#transfer-primary').value,guests);
    if(!destination.valid||!Number.isInteger(guests)||guests<1||guests>1000)throw new Error(t('Choose a table with enough seats.'));
    busy=true;render();const result=await root.POSNIC.api.post('/captain/v1/tables/transfer/preview',{orderId:order._id,items});
    if(!valid())return;preview=result;stage='review';
   }else{
    busy=true;render();
    const result=root.CaptainItemTransfer.pending(order._id)?await root.CaptainItemTransfer.resume(order._id):await root.CaptainItemTransfer.complete(order._id,{revision:preview.revision,items,destination});
    if(!valid())return;
    if(result.state==='completed'){close();window.showToast?.(t('Order updated'),'success');await window.loadOrderHistory?.();await window.loadTables?.();return;}
   }
   if(valid()){busy=false;render();}
  }catch(error){if(valid()){busy=false;if(root.CaptainItemTransfer.pending(order._id))stage='recovery';else if(stage==='recovery'){stage='items';items=null;destination=null;preview=null;}render(error.message||t('Connection failed'));}}
  finally{if(current===generation)busy=false;}
 }
 function open(value){
  if(!eligible(value)){root.showToast?.(t("Only open unpaid orders can transfer items."),"error");return;}
  // Closing the editor removes its browser-history entry asynchronously.
  // Do not let that late Back remove this screen's entry or change its stage.
  const requestedOwner=owner(),closingEditor=root.OrderEditor?.whenClosed?.();
  if(closingEditor)return closingEditor.then(()=>{if(requestedOwner===owner())return open(value);});
  if(cleaningHistory){queuedOrder={value,owner:owner()};return;}
  generation++;busy=false;order=value;identity=owner();items=null;destination=null;preview=null;tables=[];
  if(!dialog){dialog=document.createElement('dialog');dialog.className='transfer-screen';document.body.append(dialog);dialog.addEventListener('cancel',event=>{event.preventDefault();back();});}
  stage=root.CaptainItemTransfer.pending(order._id)?'recovery':'items';render();if(!dialog.open)dialog.showModal();if(!ownsHistory)ownHistory();
 }
 root.CaptainTransferScreen={eligible,register(value){registered.set(owner()+':'+value._id,value);},open};
 window.addEventListener('popstate',event=>{
  if(cleaningHistory){cleaningHistory=false;event.stopImmediatePropagation();if(queuedOrder){const next=queuedOrder;queuedOrder=null;if(next.owner===owner())open(next.value);}return;}
  if(!ownsHistory||!dialog?.open)return;
  event.stopImmediatePropagation();ownsHistory=false;
  const dialogs=[...document.querySelectorAll('dialog[open]')];
  if(!document.querySelector('#posnic-lock.is-open')&&dialogs.at(-1)===dialog)back();
  if(dialog.open)ownHistory();
 },true);
 window.addEventListener('captain:back',event=>{
  if(!dialog?.open||event.defaultPrevented||document.querySelector('#posnic-lock.is-open'))return;
  const open=[...document.querySelectorAll('dialog[open]')];if(open.at(-1)!==dialog)return;
  event.preventDefault();event.stopImmediatePropagation();back();
 },true);
 document.addEventListener('click',event=>{const button=event.target.closest('[data-transfer-order]');if(!button)return;const current=registered.get(owner()+':'+button.dataset.transferOrder)||(typeof allOrders!=='undefined'?allOrders.find(row=>row._id===button.dataset.transferOrder):null);if(current)root.CaptainTransferScreen.open(current);});
})(globalThis);
