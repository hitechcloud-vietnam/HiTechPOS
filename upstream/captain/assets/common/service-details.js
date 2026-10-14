/* One preparation editor for the cart and existing order lines. */
(function (root) {
  'use strict';
  const labels = {milk:'Milk',eggs:'Eggs',fish:'Fish',shellfish:'Shellfish',peanuts:'Peanuts','tree-nuts':'Tree nuts',wheat:'Wheat',soy:'Soy',sesame:'Sesame',celery:'Celery',mustard:'Mustard',lupin:'Lupin',sulphites:'Sulphites'};
  const esc = value => String(value ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const t = value => root.I18N?.t(value) || value;
  const capabilityKey = branch => 'posnic.service.v1.' + (root.POSNIC?.session?.shopKey || root.POSNIC?.server?.baseUrl || '') + '.' + (branch || localStorage.getItem('branch_id') || '');
  const capabilities = new Map();
  function supported(branch) {try {const key=capabilityKey(branch);return capabilities.has(key) ? capabilities.get(key) : localStorage.getItem(key) === 'true';} catch {return false;}}
  function remember(value,branch) {try {for (const key of [capabilityKey(branch),capabilityKey()]) {capabilities.set(key,value===true);try {localStorage.setItem(key,String(value===true));} catch {}}} catch {}}

  function metadata(line) {
    return {seat:Number(line.seat)||0,course:line.course||'',held:line.held===true,
      allergies:line.allergies||[],allergy_note:line.allergy_note||''};
  }
  function summary(line) {
    const parts=[];
    if(line.seat) parts.push(esc(t('Seat {0}').replace('{0}',line.seat)));
    if(line.course) parts.push(esc(t(line.course)));
    if(line.held) parts.push(esc(t('Held')));
    const allergy=(line.allergies||[]).map(code=>t(labels[code]||code));
    if(line.allergy_note) allergy.push(line.allergy_note);
    return (parts.length?'<p class="service-detail-summary">'+parts.join(' · ')+'</p>':'')+
      (allergy.length?'<p class="service-allergy"><strong>'+esc(t('Allergy'))+':</strong> '+esc(allergy.join(', '))+'</p>':'');
  }
  function open(line, save, {canSeparate=false,canHold=true}={}) {
    if(!supported() || document.getElementById('preparation-dialog')) return;
    const previous=document.activeElement;
    const dialog=document.createElement('dialog');dialog.id='preparation-dialog';
    dialog.setAttribute('aria-labelledby','preparation-title');
    dialog.innerHTML=`<form><header><div><h2 id="preparation-title">Preparation</h2><p translate="no">${esc(line.name||line.item_name)}</p></div><button type="button" data-close aria-label="Close">×</button></header><div class="preparation-body">
      <label><span>Seat</span><input name="seat" type="number" inputmode="numeric" min="0" max="99" step="1" value="${Number(line.seat)||0}"><small>Use 0 for a shared dish.</small></label>
      <label><span>Course</span><select name="course">${['','Drinks','Starters','Main course','Dessert'].map(value=>`<option value="${esc(value)}" ${value===line.course?'selected':''}>${esc(t(value||'No course'))}</option>`).join('')}</select></label>
      ${canHold?`<label class="preparation-check"><input name="held" type="checkbox" ${line.held?'checked':''}><span>Hold until I send this course</span></label>`:''}
      <details ${(line.allergies?.length||line.allergy_note)?'open':''}><summary>Allergy details</summary><div class="preparation-allergies">${Object.entries(labels).map(([code,label])=>`<label class="preparation-check"><input type="checkbox" name="allergy" value="${code}" ${(line.allergies||[]).includes(code)?'checked':''}><span>${esc(label)}</span></label>`).join('')}</div><label><span>Other allergy or instructions</span><textarea name="allergy_note" maxlength="200">${esc(line.allergy_note||'')}</textarea></label><p>Confirm allergy requirements with the kitchen.</p></details>
      ${canSeparate?'<label class="preparation-check"><input type="checkbox" name="separate"><span>Apply to one item only</span></label>':''}
      <p class="preparation-error" role="alert"></p></div><footer><button type="button" data-close>Cancel</button><button type="submit">Apply</button></footer></form>`;
    document.body.append(dialog);
    const form = dialog.querySelector('form');
    const fingerprint = () => JSON.stringify([...new FormData(form)]);
    const initial = fingerprint();
    let saving = false;
    const finish = () => {dialog.close();dialog.remove();window.removeEventListener('captain:back', nativeBack, true);previous?.focus({preventScroll:true});};
    const close = async () => {
      if (saving || (fingerprint() !== initial && !await CaptainConfirm.discard())) return;
      finish();
    };
    const nativeBack = event => {if(CaptainConfirm.active)return;event.preventDefault();event.stopImmediatePropagation();close();};
    window.addEventListener('captain:back', nativeBack, true);
    dialog.querySelectorAll('[data-close]').forEach(button=>button.onclick=close);
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.querySelector('form').onsubmit=async event=>{
      event.preventDefault();if(saving)return;const form=event.currentTarget;
      if(!form.reportValidity())return;
      const value=new FormData(form), next={seat:Number(value.get('seat')),course:String(value.get('course')||''),held:canHold?value.has('held'):line.held===true,
        allergies:value.getAll('allergy'),allergy_note:String(value.get('allergy_note')||'').trim()};
      saving = true;
      const controls=[...dialog.querySelectorAll('button,input,select,textarea')];controls.forEach(control=>control.disabled=true);
      dialog.setAttribute('aria-busy','true');
      try{await save(next,value.has('separate'));finish();}
      catch(error){dialog.querySelector('[role=alert]').textContent=t(error.message||'Could not save. Please try again.');}
      finally {saving=false;dialog.removeAttribute('aria-busy');controls.forEach(control=>control.disabled=false);}
    };
    root.I18N?.apply(dialog);dialog.showModal();
  }
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-preparation-cart],[data-preparation-order]');
    if(!button)return;event.preventDefault();event.stopImmediatePropagation();
    if(button.hasAttribute('data-preparation-cart')){
      const id=button.dataset.preparationCart,line=(await getCartData()).find(item=>item.id===id);
      if(!line)return;
      open(line,(next,separate)=>queueCartMutation(async()=>{
        const cart=await getCartData(),current=cart.find(item=>item.id===id);
        if(!current)throw new Error('Order changed. Please refresh.');
        if(separate&&current.quantity>1){current.quantity-=1;const key=crypto.randomUUID();cart.push({...current,...next,product_id:cartProductId(current),id:key,line_id:key,quantity:1});}
        else Object.assign(current,next);
        await saveCartData(cart);renderCart(cart);
      }),{canSeparate:line.quantity>1});
    }else{
      const order=orderBeingModified(),line=order?.items[Number(button.dataset.preparationOrder)];if(!line)return;
      open(line,next=>{if(order!==orderBeingModified()||!order.items.includes(line))throw new Error('Order changed. Please refresh.');Object.assign(line,next);renderCurrentOrderItems();},
        {canHold:root.OrderEditor?.isAdded(line)===true});
    }
  },true);
  root.ServiceDetails={metadata,summary,open,supported,remember};
})(window);
