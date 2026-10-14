/* Use the existing draft/save controller inside the order, without another screen. */
(function(root){
 let home=null, sheet=null, modal=null, pendingReveal=null, footerObserver=null;
 function alignFooter(){
  if(!home)return;
  const workspace=sheet.closest('.order-workspace'),bounds=workspace.getBoundingClientRect();
  modal.style.setProperty('--order-footer-left',`${bounds.left}px`);
  modal.style.setProperty('--order-footer-width',`${bounds.width}px`);
  const height=modal.querySelector('.editor-footer').getBoundingClientRect().height;
  workspace.style.setProperty('--order-footer-height',`${Math.ceil(height)}px`);
 }
 const hidden=[], disabled=[], noteChanges=new Map(), cancelDisabled=new Map();
 function restore(){
  if(!home)return;
  footerObserver?.disconnect();footerObserver=null;
  window.removeEventListener('resize',alignFooter);
  modal.style.removeProperty('--order-footer-left');modal.style.removeProperty('--order-footer-width');
  sheet.closest('.order-workspace').style.removeProperty('--order-footer-height');
  for(const [node,original] of noteChanges){if(original===null)node.remove();else {node.textContent=original;node.hidden=false;}}
  noteChanges.clear();pendingReveal=null;
  for(const [button,value] of cancelDisabled)button.disabled=value;
  cancelDisabled.clear();
  sheet.querySelectorAll('.is-draft-cancelled').forEach(node=>node.classList.remove('is-draft-cancelled'));
  sheet.querySelectorAll('.draft-cancel-label').forEach(node=>node.remove());
  home.replaceWith(modal);home=null;
  modal.classList.remove('inline-order-editor','inline-additions');
  for(const [node,value] of disabled.splice(0).reverse())node.disabled=value;
  sheet?.closest('.order-workspace')?.classList.remove('inline-editing');
  for(const [node,value] of hidden.splice(0))node.hidden=value;
  sheet=null;
 }
 function mount(id){
  if(home)return true;
  sheet=[...document.querySelectorAll('.order-sheet')].find(node=>node.dataset.orderId===id);
  if(!sheet)return false;
  modal=document.getElementById('editOrderModal');
  home=document.createComment('order editor home');modal.before(home);
  sheet.querySelector('.kot-items-list').after(modal);
  for(const node of sheet.querySelectorAll(':scope > .kot-items-list,:scope > .order-items-heading,:scope > .order-note,:scope > .order-summary,:scope > .order-secondary')){hidden.push([node,node.hidden]);node.hidden=true;}
  for(const other of sheet.parentElement.querySelectorAll(':scope > .order-sheet')){if(other!==sheet){hidden.push([other,other.hidden]);other.hidden=true;}}
  const financial=sheet.closest('.order-workspace').querySelector('.order-financial');
  hidden.push([financial,financial.hidden]);financial.hidden=true;
  modal.classList.add('inline-order-editor');sheet.closest('.order-workspace').classList.add('inline-editing');
  footerObserver=new ResizeObserver(alignFooter);footerObserver.observe(sheet.closest('.order-workspace'));
  footerObserver.observe(modal.querySelector('.editor-footer'));
  window.addEventListener('resize',alignFooter);alignFooter();
  modal.addEventListener('hidden.bs.modal',restore,{once:true});
  return true;
 }
 function additions(){
  if(!home || modal.classList.contains('inline-additions'))return;
  modal.classList.add('inline-additions');
  sheet.querySelector(':scope > .kot-items-list').hidden=false;
  sheet.querySelector(':scope > .order-items-heading').hidden=false;
  for(const button of sheet.querySelectorAll(':scope > .kot-items-list button')){
   if(button.matches('[data-line-action="more"],[data-line-action="cancel"],[data-line-action="note"],[data-line-action="less"]'))continue;
   disabled.push([button,button.disabled]);button.disabled=true;
  }
 }
 function note(key,text){
  if(!home || !modal.classList.contains('inline-additions'))return;
  for(const actions of sheet.querySelectorAll(':scope > .kot-items-list [data-line-key]')){
   if(actions.dataset.lineKey!==key)continue;
   const row=actions.closest('.service-line,.order-legacy-line');
   if(!row)continue;
   let node=row.querySelector('.service-item-note');
   if(!node){
    node=document.createElement('p');node.className='service-item-note';node.setAttribute('translate','no');
    const dish=row.querySelector('.service-dish');
    if(dish)dish.append(node);else actions.before(node);
    noteChanges.set(node,null);
   }else if(!noteChanges.has(node))noteChanges.set(node,node.textContent);
   node.textContent=text;node.hidden=!text;
  }
 }
 function reveal(key){
  if(key)pendingReveal=key;
  if(!home || !pendingReveal || !document.getElementById('item-picker')?.hidden)return;
  const targetKey=pendingReveal;
  requestAnimationFrame(()=>{
   if(!sheet)return;
   const target=[...sheet.querySelectorAll('[data-line-key]')].find(node=>node.dataset.lineKey===targetKey);
   const row=target?.closest('.service-line,.order-legacy-line,.order-item-card');
   if(!row)return;
   pendingReveal=null;
   row.classList.remove('item-change-highlight');void row.offsetWidth;row.classList.add('item-change-highlight');
   const scroller=sheet.closest('.order-scroll'), box=row.getBoundingClientRect();
   if(!scroller)return;
   const bounds=scroller.getBoundingClientRect(),footer=modal.querySelector('.editor-footer').getBoundingClientRect();
   const bottom=Math.min(bounds.bottom,footer.top)-16,top=bounds.top+16;
   if(box.top<top || box.bottom>bottom)scroller.scrollBy({top:box.top-top,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
   setTimeout(()=>row.classList.remove('item-change-highlight'),1800);
  });
 }
 function cancellations(items){
  if(!home || !modal.classList.contains('inline-additions'))return;
  for(const actions of sheet.querySelectorAll(':scope > .kot-items-list [data-line-key]')){
   const item=items.find(item=>root.FloorLineActions.key(item)===actions.dataset.lineKey);
   const row=actions.closest('.service-line,.order-legacy-line');
   if(!row || !item)continue;
   const removed=root.OrderEditor.previousQuantity(item)-Number(item.quantity);
   if(!(removed>0)){
    row.querySelector('.draft-cancel-label')?.remove();row.classList.remove('is-draft-cancelled');
    for(const [button,value] of cancelDisabled){if(row.contains(button)){button.disabled=value;cancelDisabled.delete(button);}}
    continue;
   }
   let label=row.querySelector('.draft-cancel-label');
   if(!label){label=document.createElement('span');label.className='draft-cancel-label';row.append(label);}
   const complete=item.cancelled || Number(item.quantity)===0;
   const message=document.createElement('span');
   message.textContent=complete?'Cancellation · Not sent yet':`Cancel ${removed} of ${root.OrderEditor.previousQuantity(item)} · Not sent`;
   const undo=document.createElement('button');undo.type='button';undo.dataset.undoCancellation='';undo.textContent='Undo';
   undo.addEventListener('click',()=>{if(root.OrderEditor.undoCancellation(item))reveal(actions.dataset.lineKey);});
   label.replaceChildren(message,undo);
   if(!complete || row.classList.contains('is-draft-cancelled'))continue;
   row.classList.add('is-draft-cancelled');
   for(const button of row.querySelectorAll('button:not([data-undo-cancellation])')){cancelDisabled.set(button,button.disabled);button.disabled=true;}
  }
 }
 root.InlineOrderEditor={mount,restore,additions,cancellations,note,reveal,get adding(){return !!home && modal.classList.contains('inline-additions');},get active(){return !!home;}};
})(window);
