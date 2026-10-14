/* Order presentation. Mutations stay in the authenticated, recoverable services. */
(function(root){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function render(orders,{takeaway,financialActions}){
  return `<div class="order-workspace"><div class="order-scroll">${orders.map(order=>{
   const editable=order.payment_status!=='Paid'&&!root.kotIsCancelled(order);
   const id=esc(order._id);
   const rounds=Array.isArray(order.kitchen_rounds)?root.ServiceRounds.render({...order,dine_type:takeaway?'Take away':order.dine_type},editable):
    (order.items||[]).map(item=>`<div class="order-legacy-line${root.kotIsCancelled(order)||root.itemIsCancelled(item)?' is-cancelled':''}"><strong translate="no">${esc(item.item_name||item.name)}</strong><span translate="no">×${esc(item.item_quantity??item.quantity)}</span>${(item.item_description??item.notes)?`<p class="order-legacy-note" translate="no">${esc(item.item_description??item.notes)}</p>`:''}${editable&&!root.itemIsCancelled(item)?root.FloorLineActions?.render(order,item)||'':''}</div>`).join('');
   return `<article class="kot-card order-sheet" data-order-id="${id}" data-takeaway="${Boolean(takeaway)}" data-payment-status="${esc(order.payment_status||'')}">
    <div class="order-identity"><span translate="no">#${esc(order.sales_id||order._id)}</span><span>${takeaway?'Take Away':`<span>Guests</span> · <span translate="no">${esc(order.person_count||'—')}</span>`}</span></div>
    <div class="order-items-heading"><h2>Order items</h2>${editable?`<button class="order-add" type="button" data-order-add="${id}"><i class="fas fa-plus" aria-hidden="true"></i> <span>Add items</span></button>`:''}</div>
    <div class="kot-items-list">${rounds}</div>
    ${editable&&order.preparation_notes?`<button class="order-note" type="button" data-floor-order-note="${id}"><span>Kitchen note</span>${order.preparation_note?`<span translate="no"> · ${esc(order.preparation_note)}</span>`:''}</button>`:order.preparation_note?`<p translate="no">${esc(order.preparation_note)}</p>`:''}
    ${root.OrderPhotos?.render(order)||''}
    <div class="order-tax-summary" data-order-totals="${id}" data-bill-table="${takeaway?'':esc(order.table_number||'')}" aria-live="polite"><div class="order-summary"><span>Total:</span><strong>${root.CaptainMoney.html(Number(order.sales_total||0))}</strong></div><p class="order-tax-status">${esc(root.I18N?.t("Loading...")||"Loading...")}</p></div>
    ${editable?`<div class="order-secondary">${!takeaway?`<button type="button" data-floor-move-order="${id}"><i class="fas fa-exchange-alt" aria-hidden="true"></i> <span>Move table</span></button>`:''}<button class="order-cancel" type="button" data-order-cancel="${id}"><i class="far fa-trash-alt" aria-hidden="true"></i> <span>Cancel order</span></button></div>`:''}
   </article>`;
  }).join('')}</div><footer class="order-financial">${financialActions}</footer></div>`;
 }
 document.addEventListener('click',event=>{
  const add=event.target.closest('[data-order-add]');
  if(add&&!add.disabled)root.addItemsToOrder(add.dataset.orderAdd);
  const cancel=event.target.closest('[data-order-cancel]');
  if(cancel&&!cancel.disabled)root.cancelKot(cancel.dataset.orderCancel);
 });
 async function loadTotals(node) {
  const owner=root.POSNIC.session.shopKey, user=root.POSNIC.session.user?.id, branch=localStorage.getItem('branch_id');
  const current=()=>node.isConnected&&root.POSNIC.session.active&&!root.CaptainAccess?.locked&&owner===root.POSNIC.session.shopKey&&user===root.POSNIC.session.user?.id&&branch===localStorage.getItem('branch_id');
  const t=value=>root.I18N?.t(value)||value;
  try {
   const table=node.dataset.billTable;
   let bill=await root.POSNIC.api.get('/captain/v1/bill?'+(table?'table='+encodeURIComponent(table):'saleId='+encodeURIComponent(node.dataset.orderTotals)));
   if(table && !(bill.orderIds?.length===1 && String(bill.orderIds[0])===node.dataset.orderTotals)){
    const lines=(bill.lines||[]).filter(line=>String(line.id||'').startsWith(node.dataset.orderTotals+':'));
    if(!lines.length||lines.some(line=>!Number.isSafeInteger(line.amountMinor)))throw new Error('Order bill unavailable');
    bill={...bill,lines,totalMinor:lines.reduce((total,line)=>total+line.amountMinor,0)};
   }
   if(!current())return;
   if(!Array.isArray(bill.lines)||!Number.isSafeInteger(bill.totalMinor))throw new Error('Invalid bill');
   const parts=new Map();
   for(const line of bill.lines){
    if(!Array.isArray(line.components))throw new Error('Missing bill components');
    for(const part of line.components){
    if(!Number.isSafeInteger(part.minor))throw new Error('Invalid component');
    parts.set(part.key,(parts.get(part.key)||0)+part.minor);
   }}
   const sum=[...parts.values()].reduce((total,value)=>total+value,0);
   if(!Number.isSafeInteger(sum)||sum!==bill.totalMinor)throw new Error('Inconsistent bill components');
   const policy=root.CaptainMoney.snapshot(bill);
   const money=value=>esc(root.CaptainMoney.format(root.CaptainMoney.fromMinor(value,policy),policy));
   if(![...parts.keys()].some(key=>key.startsWith('tax:')))parts.set('tax:Tax',0);
   node.innerHTML='<dl class="order-tax-breakdown">'+[...parts].filter(([key,value])=>value!==0||key==='base'||key.startsWith('tax:')).map(([key,value])=>'<div><dt>'+esc(t(bill.labels?.[key]|| (key==='tax:Tax'?'Tax':key)))+'</dt><dd translate="no">'+money(value)+'</dd></div>').join('')+'<div class="order-tax-total"><dt>'+esc(t('Total'))+'</dt><dd translate="no">'+money(bill.totalMinor)+'</dd></div></dl>';
  }catch(error){
   if(!current())return;
   const status=node.querySelector('.order-tax-status');
   if(status){status.textContent=t('Could not load the bill.');const retry=document.createElement('button');retry.type='button';retry.textContent=t('Retry');retry.onclick=()=>{retry.disabled=true;void loadTotals(node);};status.append(' ',retry);}
  }
 }
 function mount(container){container.querySelectorAll('[data-order-totals]').forEach(node=>void loadTotals(node));}
 root.CaptainOrderView={render,mount};
})(window);
