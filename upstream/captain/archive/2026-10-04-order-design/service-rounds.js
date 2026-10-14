/* Confirmed kitchen rounds shared by the floor and order details. */
(function (root) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function time(value) {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '';
  }
  function render(order, editable = false) {
    if (!Array.isArray(order.kitchen_rounds)) return '';
    root.CaptainTransferScreen?.register(order);
    const transfer = order.item_transfer && window.canMergeOrders?.() ? `<div class="service-order-action"><button type="button" data-transfer-order="${escape(order._id)}">${root.I18N?.t('Transfer items') || 'Transfer items'}</button></div>` : '';
    const pending = order.kitchen_rounds.some(round => round.items.some(line => !line.held && line.remaining > 0));
    const all = editable && pending ? `<div class="service-order-action service-action"><button type="button" data-serve-all data-serve-sale="${escape(order._id)}" data-serve-branch="${escape(order.branch_id || localStorage.getItem('branch_id') || '')}">Mark all served</button></div>` : '';
    const options = editable && root.ServiceDetails?.supported(order.branch_id) ? `<details class="service-order-options"><summary>Order options</summary><button type="button" data-delivery-sale="${escape(order._id)}">Kitchen delivery</button><button type="button" data-handover-sale="${escape(order._id)}" data-handover-branch="${escape(order.branch_id || localStorage.getItem('branch_id') || '')}">Hand over order</button><p class="service-assignee" translate="no">${escape(order.assigned_staff?.name || '')}</p></details>` : '';
    const lineCounts = new Map();
    order.kitchen_rounds.forEach(round=>round.items.forEach(line=>lineCounts.set(line.line_key,(lineCounts.get(line.line_key)||0)+1)));
    return transfer + options + all + [...order.kitchen_rounds].sort((a,b) => (Date.parse(b.ordered_at) || 0) - (Date.parse(a.ordered_at) || 0)).map(round => `<section class="service-round">
      <h3><span>Ordered at</span> <time translate="no">${escape(time(round.ordered_at))}</time></h3>
      ${round.fired_at ? `<p><span>Sent to the kitchen</span> <time translate="no">${escape(time(round.fired_at))}</time></p>` : ''}
      ${round.items.map(line => `<div class="service-line${line.remaining ? '' : ' is-served'}">
        <div class="service-dish"><strong translate="no">${escape(line.name)}</strong>
        ${root.ServiceDetails?.summary(line) || ''}
        ${line.note ? `<p translate="no">${escape(line.note)}</p>` : ''}
        ${line.served ? `<small><span>Served</span> <span translate="no">${line.served} / ${line.quantity}${line.served_at ? ' · ' + escape(time(line.served_at)) : ''}</span></small>` : ''}</div>
        <span class="service-quantity" translate="no">×${line.quantity}</span>
        ${editable && line.line_key && lineCounts.get(line.line_key)===1 ? root.FloorLineActions?.render(order,{line_id:line.line_key}) || '' : ''}
        ${editable && line.held && line.remaining > 0 ? `<div class="service-action"><button type="button" data-fire-line="${escape(line.id)}" data-fire-sale="${escape(order._id)}" data-fire-branch="${escape(order.branch_id || localStorage.getItem('branch_id') || '')}">Send to kitchen</button></div>` : ''}
        ${editable && !line.held && line.remaining > 0 ? `<div class="service-action">
          ${line.remaining > 1 ? `<input type="number" aria-label="Quantity to serve" min="0.001" max="${line.remaining}" step="any" value="${line.remaining}">` : ''}
          <button type="button" data-serve-sale="${escape(order._id)}" data-serve-branch="${escape(order.branch_id || localStorage.getItem('branch_id') || '')}" data-serve-line="${escape(line.id)}" data-served="${line.served}" data-remaining="${line.remaining}">Mark served</button>
        </div>` : ''}
      </div>`).join('')}</section>`).join('');
  }
  function updateRounds(container, saleId, branchId, rounds, changedLines) {
    const list = container.querySelector('.kot-items-list');
    const optionsOpen = list.querySelector('.service-order-options')?.open;
    const assignedName = list.querySelector('.service-assignee')?.textContent || '';
    const quantities = new Map();
    list.querySelectorAll('[data-serve-line]').forEach(button => {
      const input = button.parentElement.querySelector('input');
      if (input && !changedLines.has(button.dataset.serveLine)) quantities.set(button.dataset.serveLine, input.value);
    });
    list.innerHTML = render({_id:saleId, branch_id:branchId, payment_status:container.dataset.paymentStatus, kitchen_rounds:rounds, assigned_staff:{name:assignedName}}, true);
    const options = list.querySelector('.service-order-options');
    if (options) options.open = Boolean(optionsOpen);
    list.querySelectorAll('[data-serve-line]').forEach(button => {
      const input = button.parentElement.querySelector('input');
      const value = quantities.get(button.dataset.serveLine);
      // Keep another item's partial-quantity draft only while it remains valid.
      if (input && value !== undefined && Number(value) > 0 && Number(value) <= Number(input.max)) input.value = value;
    });
    root.I18N?.apply(list);
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-fire-line]');
    if (!button || button.disabled) return;
    const container = button.closest('.kot-card');
    if (!container || container.dataset.serving === 'true') return;
    container.dataset.serving = 'true';
    const controls = [...container.querySelectorAll('.service-action button,.service-action input')];
    controls.forEach(control => control.disabled = true);
    let message = container.querySelector('.service-result');
    if (!message) {message=document.createElement('p');message.className='service-result';message.setAttribute('role','status');container.append(message);}
    const saleId = button.dataset.fireSale, branchId = button.dataset.fireBranch;
    button.dataset.fireRequest = button.dataset.fireRequest || crypto.randomUUID();
    message.textContent = 'Saving…';
    try {
      const result = await POSNIC.api.post('/sales/fireKitchenItems',{saleId,branchId,items:[button.dataset.fireLine],requestId:button.dataset.fireRequest});
      if(result.type!=='success'||!Array.isArray(result.data)) throw new Error(result.message||'Could not save. Please try again.');
      updateRounds(container,saleId,branchId,result.data,new Set([button.dataset.fireLine]));
      message.textContent='Course sent to kitchen';
    } catch(error) {message.textContent=error.message||'Could not save. Please try again.';}
    finally {delete container.dataset.serving;controls.forEach(control=>control.disabled=false);root.I18N?.apply(container);}
  });
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-serve-sale]');
    if (!button || button.disabled) return;
    const container = button.closest('.kot-card');
    if (!container || container.dataset.serving === 'true') return;
    const input = button.parentElement.querySelector('input');
    const quantity = input ? Number(input.value) : Number(button.dataset.remaining);
    const all = button.hasAttribute('data-serve-all');
    if (!all && (!Number.isFinite(quantity) || quantity <= 0 || quantity > Number(button.dataset.remaining))) {
      if (input) input.reportValidity();
      return;
    }
    // Snapshot only the visible pending lines. Later additions must stay unserved.
    const items = all ? [...container.querySelectorAll('[data-serve-line]')].map(line => ({
      id: line.dataset.serveLine,
      quantity: Number(line.dataset.served) + Number(line.dataset.remaining),
    })) : [{id:button.dataset.serveLine, quantity:Number(button.dataset.served)+quantity}];
    if (!items.length) return;
    container.dataset.serving = 'true';
    const controls = [...container.querySelectorAll('.service-action button, .service-action input')];
    controls.forEach(control => { control.disabled = true; });
    const branchId = button.dataset.serveBranch;
    const saleId = button.dataset.serveSale;
    let confirmed = null;
    let message = container.querySelector('.service-result');
    if (!message) { message = document.createElement('p'); message.className='service-result'; message.setAttribute('role','status'); container.append(message); }
    message.textContent = 'Saving…';
    try {
      // The server accepts up to 200 lines and absolute served quantities make retries safe.
      for (let offset = 0; offset < items.length; offset += 200) {
        const result = await POSNIC.api.post('/sales/serveKitchenItems', {
          branchId, saleId, items: items.slice(offset, offset + 200),
        });
        if (result.type !== 'success' || !Array.isArray(result.data)) throw new Error(result.message || 'Could not save. Please try again.');
        confirmed = result.data;
      }
      message.textContent = 'Items marked served';
    } catch (error) {
      message.textContent = error.message || 'Could not save. Please try again.';
    } finally {
      if (confirmed) updateRounds(container,saleId,branchId,confirmed,new Set(items.map(item => item.id)));
      root.I18N?.apply(container);
      controls.forEach(control => { control.disabled = false; });
      delete container.dataset.serving;
    }
  });
  root.ServiceRounds = {render};
})(window);
