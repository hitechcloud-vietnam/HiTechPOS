/* The item review is the main screen. Less frequent changes have their own steps. */
(function () {
    'use strict';
    const byId = id => document.getElementById(id);
    let view = 'items', setting = '', beforeSetting = null, initial = null, originalOrder = null;
    let originalLines = new WeakSet(), saving = false, saved = false, cancelling = false;
    let originalQuantities = new WeakMap(), originalCancellations = new WeakMap();
    const cancellationFields = ['cancelled', 'cancelled_quantity', 'cancellation_reason'];
    let ownsHistory = false;
    let settingLoad = 0, legacyGuestSupported = false;
    const identity = () => JSON.stringify([POSNIC.session?.shopKey, POSNIC.session?.user?.id, localStorage.getItem('branch_id'), POSNIC.session?.base || POSNIC.server?.baseUrl]);
    const durableGuests = () => !!(order()?.seating_request_id || legacyGuestSupported || (order() && CaptainGuestUpdate.pending(order()._id)));
    const historyKey = 'captainOrderEditor';
    let historyClosing = false;
    const closeWaiters = [];
    const closed = () => { historyClosing = false; closeWaiters.splice(0).forEach(resolve => resolve()); };
    const selected = name => document.querySelector('input[name="' + name + '"]:checked');
    const order = () => orderBeingModified();
    function details() {
        const table = selected('edit_table_no');
        return {
            type: selected('edit_dine_type')?.value || order()?.dine_type || 'Dine-in',
            tableRadio: table?.id || '',
            table: table?.id === 'edit_table_manual_radio' ? byId('edit_manual_table_input').value.trim().toUpperCase() : table?.value || order()?.table_number || order()?.kiosk_table_no || '',
            manual: byId('edit_manual_table_input')?.value || '',
            guests: order()?.person_count || 1,
            discount: byId('edit-discount-value')?.value || '0',
            discountType: selected('edit_discount_type')?.value || 'amount',
            discountReason: byId('edit-discount-description')?.value || '',

        };
    }
    function fingerprint() {
        return JSON.stringify({ details: details(), items: order()?.items || [], preparationNote:order()?.preparation_note || '' });
    }
    function restore(value) {
        document.querySelectorAll('input[name="edit_dine_type"]').forEach(input => input.checked = input.value === value.type);
        document.querySelectorAll('input[name="edit_table_no"]').forEach(input => input.checked = input.id === value.tableRadio);
        if (byId('edit_manual_table_input')) byId('edit_manual_table_input').value = value.manual;
        setEditPersonCount(value.guests);
        byId('edit-discount-value').value = value.discount;
        byId('edit-discount-description').value = value.discountReason;
        document.querySelectorAll('input[name="edit_discount_type"]').forEach(input => input.checked = input.value === value.discountType);
    }
    function show(next) {
        settingLoad++;
        view = next;
        for (const name of ['items', 'details', 'settings']) byId('order-editor-' + name).hidden = name !== next;
        document.querySelector('#editOrderModal .editor-footer').hidden = next !== 'items';
        refresh();
        const target = next === 'items' ? byId('open-item-picker') : next === 'details' ? document.querySelector('[data-editor-setting]:not([hidden])') : byId('editor-setting-back');
        target?.focus({ preventScroll: true });
        document.querySelector('#editOrderModal .modal-body').scrollTop = 0;
    }
    function typeChanged() {
        if (view !== 'settings') return;
        byId('edit-type-section').hidden = setting !== 'type';
        byId('edit-discount-section').hidden = setting !== 'discount';
        // Converting a takeaway to dine-in includes choosing its destination.
        const tableNeeded = setting === 'table' || (setting === 'type' && details().type === 'Dine-in');
        byId('edit-table-section').hidden = !tableNeeded;
        byId('edit-pax-section').hidden = setting !== 'guests';
        byId('edit-table-section').style.display = '';
        byId('edit-pax-section').style.display = '';
    }
    let priceKey = '', priceGeneration = 0, priceTimer, priceState = 'idle', confirmedTotal;
    function resetPrice() {
        clearTimeout(priceTimer); priceGeneration++; priceKey = ''; priceState = 'idle'; confirmedTotal = undefined;
    }
    function pricing(value) {
        const current = order();
        if (!current?.pricing_preview) return;
        const priorType = ['amount','price','fixed'].includes(String(originalOrder?.extra_discount_type || '').toLowerCase()) ? 'amount' : 'percent';
        const discount = Number(value.discount), changed = discount !== Number(originalOrder?.extra_discount || 0) || (discount !== 0 && value.discountType !== priorType);
        const preserve = current.transfer_allocated === true && !changed;
        const body = { order_id: current._id, items: linesForSave(current.items),
            extra_discount_type: preserve ? null : value.discountType, extra_discount: preserve ? null : discount,
            discount_description: value.discountReason, seen_at: orderSeenAt(current) };
        const owner = identity(), key = JSON.stringify([owner, body]);
        if (key === priceKey) return;
        clearTimeout(priceTimer); priceKey = key; priceState = 'loading'; confirmedTotal = undefined;
        const generation = ++priceGeneration;
        priceTimer = setTimeout(async () => {
            let deadline;
            try {
                const result = await Promise.race([
                    POSNIC.api.post('/captain/v1/orders/edit/preview', body),
                    new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('timeout')), 20000); })
                ]);
                if (generation !== priceGeneration || current !== order() || owner !== identity()) return;
                if (typeof result.total_amount !== 'number' || !Number.isFinite(result.total_amount)) throw new Error('invalid_total');
                confirmedTotal = result.total_amount; priceState = 'ready';
            } catch {
                if (generation !== priceGeneration || current !== order() || owner !== identity()) return;
                priceState = 'error';
            } finally { clearTimeout(deadline); }
            refresh();
        }, 300);
    }
    function reviewTotal(value) {
        const current = order();
        if (!originalOrder || !current) return Number(current?.total_amount || 0);
        const financialLines = items => JSON.stringify((items || []).map(item => [
            item.line_id || item.product_id || item.item_id || item.id || item._id,
            Number(item.quantity ?? item.item_quantity ?? 0), Number(item.price ?? item.unit_price ?? 0),
            !!item.cancelled, !!item.return, item.status
        ]));
        // The server supplies the exact pre-discount taxable basis for allocated
        // bills. Use its confirmed amounts while only discount/notes change.
        if (current.transfer_allocated !== true || !Number.isFinite(Number(originalOrder.discount_basis)) ||
            financialLines(current.items) !== financialLines(originalOrder.items)) return Number(current.total_amount || 0);
        const policy = CaptainMoney.current();
        const before = CaptainMoney.toMinor(originalOrder.total_amount,policy) + CaptainMoney.toMinor(originalOrder.extra_discount || 0,policy);
        const requested = value.discountType === 'percent' ? Number(originalOrder.discount_basis)*Number(value.discount)/100 : Number(value.discount);
        if (!Number.isFinite(requested) || requested < 0) return Number(current.total_amount || 0);
        return CaptainMoney.fromMinor(before-Math.min(before,CaptainMoney.toMinor(requested,policy)),policy);
    }
    function refresh() {
        if (!byId('order-editor-items') || !order()) return;
        const value = details(), dineIn = value.type === 'Dine-in';
        pricing(value);
        byId('order-editor-context').textContent = dineIn && value.table ? 'Table ' + value.table : 'Takeaway';
        const type = document.createElement('span'); type.textContent = value.type;
        const guests = document.createElement('span'); guests.textContent = 'Guests';
        byId('order-editor-meta').replaceChildren(type);
        if (dineIn) byId('order-editor-meta').append(document.createTextNode(' · ' + value.guests + ' '), guests);
        byId('editor-table-value').textContent = value.table;
        byId('editor-guests-value').textContent = value.guests;
        byId('editor-type-value').textContent = value.type;
        byId('editor-discount-value').textContent = value.discountType === 'percent' ? value.discount + '%' : CaptainMoney.display(Number(value.discount));
        document.querySelector('[data-editor-setting="table"]').hidden = !dineIn;
        document.querySelector('[data-editor-setting="guests"]').hidden = !dineIn;
        const count = (order().items || []).filter(item => !lineIsCancelled(item, order())).reduce((sum, item) => sum + Number(item.quantity || item.item_quantity || 0), 0);
        const additions = (order().items || []).filter(item => !originalLines.has(item) && !lineIsCancelled(item, order()));
        const addedCount = additions.reduce((sum,item)=>sum+Number(item.quantity || 0),0);
        byId('picker-item-count').textContent = addedCount === 1 ? '1 new item' : addedCount + ' new items';
        byId('picker-total-value').textContent = CaptainMoney.display(additions.reduce((sum,item)=>sum+Number(item.quantity || 0)*Number(item.selling_price ?? item.price ?? 0),0));
        for (const prefix of ['editor']) {
            byId(prefix + '-item-count').textContent = count === 1 ? '1 item' : count + ' items';
            const total = byId(prefix + '-total-value');
            total.textContent = order().pricing_preview ? (priceState === 'ready' ? CaptainMoney.display(confirmedTotal) : priceState === 'loading' ? '…' : '—') : CaptainMoney.display(reviewTotal(value));
            total.setAttribute('aria-busy', String(!!order().pricing_preview && priceState === 'loading'));
            let retry = byId(prefix + '-price-retry');
            if (!retry) {
                retry = document.createElement('button'); retry.id = prefix + '-price-retry'; retry.type = 'button';
                retry.classList.add('btn', 'btn-sm', 'btn-link'); retry.textContent = window.I18N?.t('Retry') || 'Retry';
                retry.addEventListener('click', () => { resetPrice(); refresh(); }); total.after(retry);
            }
            retry.hidden = !order().pricing_preview || priceState !== 'error';
        }
        byId('cancel-order-changes').disabled = saving;
        const dirty = initial !== null && initial !== fingerprint();
        byId('save-order-changes').disabled = saving || !dirty;
        byId('save-order-changes').hidden = !dirty;
        byId('cancel-order-changes').textContent = dirty ? 'Discard changes' : 'Close';
    }
    function begin() {
        resetPrice();
        let note=byId('editor-preparation-note');
        if (!note) {
            const label=document.createElement('label');label.className='editor-preparation-note';
            label.innerHTML='<span>Kitchen note</span><textarea id="editor-preparation-note" maxlength="500" rows="2"></textarea>';
            byId('current-order-items').after(label);
            note=byId('editor-preparation-note');
            note.addEventListener('input',()=>{if(order()){order().preparation_note=note.value;refresh();}});
        }
        note.value=order()?.preparation_note || '';
        note.parentElement.hidden=!order()?.preparation_notes;
        legacyGuestSupported = false; settingLoad++;
        saved = false; saving = false; beforeSetting = null;
        originalOrder = JSON.parse(JSON.stringify(order()));
        document.querySelectorAll('#edit-type-section input, #edit-table-section input, #edit-pax-section input, #edit-pax-section button').forEach(input => input.disabled=false);
        originalLines = new WeakSet(order()?.items || []);
        originalQuantities = new WeakMap((order()?.items || []).map(item => [item, Number(item.quantity) || 0]));
        originalCancellations = new WeakMap((order()?.items || []).map(item => [item,
            Object.fromEntries(cancellationFields.filter(key => Object.hasOwn(item, key)).map(key => [key, item[key]]))]));
        initial = fingerprint();
        renderCurrentOrderItems();
        show('items');
    }
    function undoCancellation(item) {
        if (saving || initial === null || !originalLines.has(item) || !order()?.items.includes(item) ||
            !(originalQuantities.get(item) > Number(item.quantity))) return false;
        item.quantity = originalQuantities.get(item);
        const original = originalCancellations.get(item);
        for (const key of cancellationFields) {
            if (Object.hasOwn(original, key)) item[key] = original[key];
            else delete item[key];
        }
        renderCurrentOrderItems();
        updateOrderTotal();
        return true;
    }
    async function openSetting(name) {
        if (saving) return;
        if (name === 'guests' && order() && !durableGuests()) {
            const revision = ++settingLoad, current = order(), owner = identity();
            const button = document.querySelector('[data-editor-setting="guests"]');
            button.disabled = true;
            try {
                const result = await POSNIC.api.get('/captain/v1/tables');
                if (revision !== settingLoad || order() !== current || identity() !== owner || !byId('editOrderModal').classList.contains('show')) return;
                legacyGuestSupported = result.capabilities?.legacyGuestUpdate === true;
            } catch (error) {
                if (revision === settingLoad && order() === current) showToast(window.I18N?.t('Connection failed') || 'Connection failed', 'error');
                return;
            } finally { button.disabled = false; }
        }
        if (order() && (name === 'table' || (name === 'guests' && durableGuests()) || (order().seating_request_id && name === 'type'))) {
            const pending = CaptainGroupMove.pending(order()._id);
            if (pending) name = pending.body.dineType ? 'type' : 'table';
            if (CaptainGuestUpdate.pending(order()._id)) name = 'guests';
            if (initial !== null && fingerprint() !== initial) {
                if (!await CaptainConfirm.discard()) return;
                setOrderBeingModified(JSON.parse(JSON.stringify(originalOrder)));
                restore(JSON.parse(initial).details);
                renderCurrentOrderItems();
            }
            if (name === 'table') {
                const id = order()._id, modal = byId('editOrderModal');
                saved = true;
                modal.addEventListener('hidden.bs.modal', () => moveOrder(id), {once:true});
                bootstrap.Modal.getInstance(modal)?.hide();
                return;
            }
        }
        setting = name; beforeSetting = details();
        byId('editor-setting-title').textContent = { table: 'Move table', guests: 'Guests', type: 'Order Type', discount: 'Discount' }[name];
        show('settings'); typeChanged();
        if (order()?.seating_request_id && name === 'type') {
            const pending = CaptainGroupMove.pending(order()._id);
            if (pending?.body.dineType) {
                document.querySelectorAll('input[name="edit_dine_type"]').forEach(input => input.checked = input.value === pending.body.dineType);
                typeChanged();
            }
            byId('editor-setting-apply').textContent = window.I18N?.t(pending ? 'Retry' : 'Save') || (pending ? 'Retry' : 'Save');
            document.querySelectorAll('#edit-type-section input, #edit-table-section input').forEach(input => input.disabled=!!pending);
        } else if (name === 'guests' && durableGuests()) {
            const pending = CaptainGuestUpdate.pending(order()._id);
            if (pending) setEditPersonCount(pending.body.guests);
            byId('editor-setting-apply').textContent = window.I18N?.t(pending ? 'Retry' : 'Save') || (pending ? 'Retry' : 'Save');
            document.querySelectorAll('#edit-pax-section input, #edit-pax-section button').forEach(input => input.disabled=!!pending);
        } else byId('editor-setting-apply').textContent = window.I18N?.t('Apply') || 'Apply';
    }
    function back() {
        if (saving) return;
        if (beforeSetting) restore(beforeSetting);
        beforeSetting = null;
        show('details');
    }
    async function apply() {
        if (saving) return;
        const value = details();
        if (setting === 'discount') {
            const input = byId('edit-discount-value');
            input.max = value.discountType === 'percent' ? '100' : '';
            input.step = value.discountType === 'percent' ? '0.01' : String(1 / CaptainMoney.current().factor);
            if (!input.reportValidity()) return;
            const reason = byId('edit-discount-description');
            reason.value = reason.value.trim();
            reason.required = false;
            reason.removeAttribute('minlength'); reason.maxLength = 200;
            if (!reason.reportValidity()) return;
        }
        if (value.type === 'Dine-in' && !value.table) {
            showToast('Choose a table first.', 'error'); return;
        }
        if (value.type === 'Dine-in' && value.tableRadio === 'edit_table_manual_radio' && !/^[A-Z0-9]{1,6}$/.test(value.table)) {
            showToast('Table must be 1–6 letters/numbers (A–Z, 0–9).', 'error'); return;
        }
        if (setting === 'guests' && durableGuests()) {
            const current = order(), controls = [...byId('editOrderModal').querySelectorAll('button,input,select')];
            const disabled = controls.map(control => control.disabled);
            saving=true; controls.forEach(control=>control.disabled=true);
            try {
                if (CaptainGuestUpdate.pending(current._id)) await CaptainGuestUpdate.resume(current._id);
                else await CaptainGuestUpdate.save(current._id,value.guests);
                saved=true;
                bootstrap.Modal.getInstance(byId('editOrderModal'))?.hide();
                await loadOrderHistory({background:true});
                showToast(window.I18N?.t('Saved') || 'Saved','success');
            } catch(error) {
                showToast(error.message || 'Could not save. Please try again.','error');
            } finally {
                saving=false; controls.forEach((control,index)=>control.disabled=disabled[index]);
                try {
                    const pending=CaptainGuestUpdate.pending(current._id);
                    byId('editor-setting-apply').textContent=window.I18N?.t(pending?'Retry':'Save') || (pending?'Retry':'Save');
                    document.querySelectorAll('#edit-pax-section input, #edit-pax-section button').forEach(input=>input.disabled=!!pending);
                } catch {
                    saved=true; bootstrap.Modal.getInstance(byId('editOrderModal'))?.hide();
                }
                refresh();
            }
            return;
        }
        if (setting === 'type' && order()?.seating_request_id &&
            (value.type !== (originalOrder.dine_type || 'Dine-in') || CaptainGroupMove.pending(order()._id))) {
            const current = order(), takeaway = value.type === 'Take away';
            const selectedTable = selected('edit_table_no');
            const sameTable = value.table === originalOrder.table_number;
            const tableIds = takeaway ? [] : sameTable ? originalOrder.seating_table_ids : [selectedTable?.dataset.id].filter(Boolean);
            const primaryId = takeaway ? '' : sameTable ? originalOrder.seating_primary_id : tableIds[0];
            const pending = CaptainGroupMove.pending(current._id);
            if (!pending && !takeaway && (!tableIds?.length || !primaryId)) { showToast('Choose a table first.', 'error'); return; }
            saving = true;
            const controls = [...byId('editOrderModal').querySelectorAll('button,input,select')];
            const disabled = controls.map(control => control.disabled);
            controls.forEach(control => control.disabled=true);
            try {
                if (pending) await CaptainGroupMove.resume(current._id);
                else await CaptainGroupMove.move(current._id,{tableIds,primaryId,guests:takeaway?0:Math.max(1,value.guests),dineType:value.type});
                saved = true;
                bootstrap.Modal.getInstance(byId('editOrderModal'))?.hide();
                await loadOrderHistory({background:true});
                showToast(window.I18N?.t('Saved') || 'Saved', 'success');
            } catch (error) {
                showToast(error.message || 'Could not save. Please try again.', 'error');
                byId('editor-setting-apply').textContent=window.I18N?.t('Retry') || 'Retry';
            } finally {
                saving=false;
                controls.forEach((control,index)=>control.disabled=disabled[index]);
                try {
                    const unresolved = CaptainGroupMove.pending(current._id);
                    if (unresolved) document.querySelectorAll('#edit-type-section input, #edit-table-section input').forEach(input=>input.disabled=true);
                } catch {
                    // Session expiry must not leave a rejected cleanup promise or editable stale order.
                    saved = true;
                    bootstrap.Modal.getInstance(byId('editOrderModal'))?.hide();
                }
                refresh();
            }
            return;
        }
        beforeSetting = null;
        show('items');
    }
    async function cancel() {
        if (saving) return;
        if (initial !== null && fingerprint() !== initial && !await CaptainConfirm.discard()) return;
        cancelling = true;
        bootstrap.Modal.getInstance(byId('editOrderModal'))?.hide();
        cancelling = false;
    }
    document.addEventListener('click', event => {
        if (event.target.closest('#cancel-order-changes')) cancel();
        if (event.target.closest('#order-editor-details-open')) show('details');
        const action = event.target.closest('[data-editor-setting]');
        if (action) openSetting(action.dataset.editorSetting);
        if (event.target.closest('[data-editor-view="items"]')) show('items');
        if (event.target.closest('#editor-setting-back')) back();
        if (event.target.closest('#editor-setting-apply')) apply();
    });
    document.addEventListener('DOMContentLoaded', () => {
        const modal = byId('editOrderModal');
        if (!modal) return;
        const discountSection = document.createElement('div');
        discountSection.id = 'edit-discount-section'; discountSection.hidden = true;
        for (const id of ['edit-discount-value','edit-discount-description']) {
            const row = byId(id).closest('.row'); row.style.display = ''; discountSection.append(row);
        }
        byId('editor-setting-apply').before(discountSection);
        const amountLabel = modal.querySelector('label[for="edit-discount-amount"]');
        amountLabel.textContent = CaptainMoney.current().currencySymbol;
        amountLabel.setAttribute('translate','no');
        byId('edit-discount-value').step = String(1 / CaptainMoney.current().factor);
        byId('edit-discount-value').required = true;
        byId('edit-discount-value').inputMode = 'decimal';
        byId('edit-discount-description').closest('.row').hidden = true;
        discountSection.querySelector('label.form-label').htmlFor = 'edit-discount-value';
        byId('edit-discount-description').previousElementSibling.htmlFor = 'edit-discount-description';

        modal.addEventListener('show.bs.modal', () => {
            if (ownsHistory) return;
            history.pushState({ ...history.state, [historyKey]: true }, '', location.href);
            ownsHistory = true;
        });
        window.addEventListener('popstate', () => {
            if (historyClosing) { closed(); return; }
            if (!ownsHistory || !modal.classList.contains('show')) return;
            ownsHistory = false;
            bootstrap.Modal.getInstance(modal)?.hide();
            // A nested step or a declined discard consumes Back without leaving the draft.
            if (modal.classList.contains('show')) {
                history.pushState({ ...history.state, [historyKey]: true }, '', location.href);
                ownsHistory = true;
            }
        });
        window.addEventListener('captain:back', event => {
            if (event.defaultPrevented || document.querySelector('dialog[open], #posnic-lock.is-open') || !modal.classList.contains('show')) return;
            event.preventDefault();
            const nested = [...document.querySelectorAll('.modal.show')].filter(node => node !== modal).pop();
            bootstrap.Modal.getInstance(nested || modal)?.hide();
        });
        modal.addEventListener('hide.bs.modal', event => {
            if (saved || cancelling) return;
            if (saving) { event.preventDefault(); return; }
            if (byId('picker-index') && !byId('picker-index').hidden) { event.preventDefault(); closePickerIndex(); return; }
            if (!byId('item-picker').hidden) { event.preventDefault(); closeItemPicker(); return; }
            if (view === 'settings') { event.preventDefault(); back(); return; }
            if (view === 'details') { event.preventDefault(); show('items'); return; }
            if (initial !== null && fingerprint() !== initial) {
                event.preventDefault();
                void cancel();
            }
        });
        modal.addEventListener('hidden.bs.modal', () => {
            resetPrice();
            if (ownsHistory && history.state?.[historyKey]) { ownsHistory = false; historyClosing = true; history.back(); }
            else { ownsHistory = false; closed(); }
            initial = null;
            setOrderBeingModified(null);
            if (!byId('orderDetailsModal')?.classList.contains('show')) currentOrderId = null;
            closeItemPicker();
        });
    });
    window.OrderEditor = {
        whenClosed() { return ownsHistory || historyClosing ? new Promise(resolve => closeWaiters.push(resolve)) : null; },
        whenClosing() {
            return historyClosing || (ownsHistory && !byId('editOrderModal')?.classList.contains('show'))
                ? new Promise(resolve => closeWaiters.push(resolve)) : null;
        },
        begin, refresh, typeChanged, cancel, undoCancellation,
        dirty: () => initial !== null && initial !== fingerprint(),
        isAdded: item => initial !== null && !originalLines.has(item),
        previousQuantity: item => originalQuantities.get(item) || 0,
        setSaving(value) { saving = value; refresh(); },
        saved() { saved = true; },
    };
})();
