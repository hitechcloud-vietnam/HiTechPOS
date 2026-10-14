/* Shared mobile interactions. Pull only at the top; never compete with
 * typing, nested scrolling, dialogs, multi-touch, or system edge gestures. */
(function () {
    let refreshAction, pending = null, gesture = null, hideTimer, suppressClickUntil = 0;
    let indicator, symbol, message;
    const visible = node => node && node.getClientRects().length > 0;
    const overlayOpen = () => [...document.querySelectorAll(
        '.modal.show, dialog[open], .notes-modal, #menu-index:not([hidden]), #item-picker:not([hidden]), .cart-sheet.open, #kot-sliding-panel.open'
    )].some(visible);
    const editing = () => document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');
    const overlays = '.modal.show, dialog[open], .notes-modal, #menu-index:not([hidden]), #item-picker:not([hidden]), .cart-sheet.open, #kot-sliding-panel.open';
    function details() {
        const adapter = [window.FloorMobileDetails, window.HistoryMobileDetails].find(item => item?.root());
        if (!adapter || [...document.querySelectorAll(overlays)].some(node => visible(node) && node !== adapter.root() && !node.contains(adapter.root()))) return null;
        return adapter;
    }
    function horizontalScroller(target, root) {
        for (let node = target; node && node !== root; node = node.parentElement) {
            if (node.scrollWidth > node.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(node).overflowX)) return true;
        }
        return false;
    }
    let navigating = false;
    function controls() {
        const adapter = details();
        if (!adapter) return;
        const surface = adapter.root(), header = surface.querySelector(adapter.header);
        if (!header) return;
        let nav = header.querySelector('.mobile-detail-nav');
        if (!nav) {
            nav = document.createElement('nav'); nav.className = 'mobile-detail-nav';
            nav.innerHTML = '<button type="button" data-detail-step="-1" aria-label="Previous">‹</button><span class="mobile-detail-position" aria-live="polite" translate="no"></span><button type="button" data-detail-step="1" aria-label="Next">›</button><button type="button" data-mobile-refresh aria-label="Refresh">↻</button>';
            header.append(nav);
        }
        const entries = adapter.entries(), index = entries.findIndex(entry => entry.id === adapter.current());
        nav.querySelector('.mobile-detail-position').textContent = index >= 0 ? `${index + 1} / ${entries.length}` : '';
        const busy = navigating || pending || adapter.busy();
        nav.querySelector('[data-detail-step="-1"]').disabled = !!busy || index <= 0;
        nav.querySelector('[data-detail-step="1"]').disabled = !!busy || index < 0 || index >= entries.length - 1;
        nav.querySelector('[data-mobile-refresh]').disabled = !!busy;
    }
    async function step(amount) {
        const adapter = details();
        if (!adapter || navigating || pending || adapter.busy() || editing()) return;
        const entries = adapter.entries(), index = entries.findIndex(entry => entry.id === adapter.current());
        const entry = index >= 0 && entries[index + amount];
        if (!entry) return;
        navigating = true; controls();
        try { await adapter.show(entry); }
        finally { navigating = false; controls(); }
    }
    function atTop(target) {
        for (let node = target; node && node !== document; node = node.parentElement) {
            if (node.scrollTop > 1) return false;
        }
        return (document.scrollingElement?.scrollTop || 0) <= 1;
    }
    function show(state, distance = 56) {
        clearTimeout(hideTimer);
        indicator.hidden = false;
        if (indicator.dataset.state !== state) indicator.dataset.state = state;
        indicator.style.setProperty('--pull-distance', Math.min(distance, 72) + 'px');
        symbol.textContent = {pull:'↓', ready:'↻', loading:'↻', done:'✓', error:'!'}[state];
        const text = state === 'loading' ? 'Loading' : state === 'done' ? 'Done' : state === 'error' ? 'Connection failed' : 'Refresh';
        const translated = window.I18N ? I18N.t(text) : text;
        if (message.textContent !== translated) message.textContent = translated;
    }
    function reset() {
        if (gesture?.sheet) gesture.sheet.style.transform = '';
        gesture = null;
        if (!pending) indicator.hidden = true;
    }
    function refresh() {
        if (pending) return pending;
        const adapter = details();
        if (navigating || adapter?.busy()) return Promise.resolve(false);
        const action = adapter ? () => adapter.refresh() : !overlayOpen() && refreshAction;
        if (!action) return Promise.resolve(false);
        show('loading');
        const buttons = [...document.querySelectorAll('[data-mobile-refresh]')];
        buttons.forEach(button => { button.disabled = true; button.setAttribute('aria-busy', 'true'); });
        pending = Promise.resolve().then(async () => {
            // A deliberate refresh restores the saved session before reading data.
            // Preserve cached data when offline; never reset setup or queued orders.
            if (window.POSNIC?.net?.check) await POSNIC.net.check(true);
            return action();
        }).then(result => {
            show(result === false ? 'error' : 'done');
            return result !== false;
        }, error => {
            console.warn('Refresh failed', error);
            show('error');
            return false;
        }).finally(() => {
            pending = null;
            buttons.forEach(button => { button.disabled = false; button.removeAttribute('aria-busy'); });
            controls();
            hideTimer = setTimeout(() => { indicator.hidden = true; }, 1600);
        });
        controls();
        return pending;
    }
    window.MobileGestures = { refresh, setRefresh(action) { refreshAction = action; document.documentElement.classList.toggle('mobile-refresh-enabled', typeof action === 'function'); } };
    document.addEventListener('DOMContentLoaded', () => {
        const path = location.pathname;
        if (path.endsWith('kot-management.html')) refreshAction = () => loadTables();
        else if (path.endsWith('order-history.html')) refreshAction = () => loadOrderHistory({background:true});
        else if (path.endsWith('products.html')) refreshAction = () => refreshProductsPage(null);
        else if (path.endsWith('my-sales.html')) refreshAction = () => refreshMySales();
        if (refreshAction) document.documentElement.classList.add('mobile-refresh-enabled');
        indicator = document.createElement('div');
        indicator.id = 'mobile-refresh-status';
        indicator.hidden = true;
        indicator.setAttribute('role', 'status');
        indicator.setAttribute('aria-live', 'polite');
        symbol = document.createElement('span');
        symbol.setAttribute('aria-hidden', 'true');
        message = document.createElement('span');
        indicator.append(symbol, message);
        document.body.append(indicator);
        window.addEventListener('captain:details', controls);
        document.addEventListener('shown.bs.modal', controls);
        document.addEventListener('pointerdown', event => {
            if (event.pointerType === 'mouse' || event.pointerType === 'pen') suppressClickUntil = 0;
        }, {passive:true});
        document.addEventListener('keydown', event => {
            suppressClickUntil = 0;
            const adapter = details();
            if (!adapter || adapter.busy() || navigating || pending || editing() || event.defaultPrevented) return;
            if (event.key === 'Escape' && adapter === window.FloorMobileDetails) { event.preventDefault(); adapter.dismiss(); }
            if (event.target.closest('.mobile-detail-nav') && ['ArrowLeft','ArrowRight'].includes(event.key)) {
                event.preventDefault();
                const rtl = getComputedStyle(adapter.root()).direction === 'rtl';
                void step((event.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1));
            }
        });
        document.addEventListener('click', event => {
            if (Date.now() < suppressClickUntil) {
                event.preventDefault(); event.stopImmediatePropagation(); return;
            }
            const next = event.target.closest('[data-detail-step]');
            if (next) { event.preventDefault(); if (!next.disabled) void step(Number(next.dataset.detailStep)); return; }
            if (event.target.closest('[data-mobile-refresh]')) {
                event.preventDefault(); event.stopImmediatePropagation(); refresh();
            }
        }, true);
        document.addEventListener('touchstart', event => {
            suppressClickUntil = 0; // A fresh tap is intentional, not the prior swipe's click.
            reset();
            if (event.touches?.length === 1 && !event.target.closest('button')) {
                const menuHead = event.target.closest('#menu-index .ui-sheet-head, #menu-index .mobile-sheet-handle');
                const summaryHead = event.target.closest('#cart-summary-sheet .cart-sheet-handle, #cart-summary-sheet .cart-sheet-header');
                const sheet = menuHead ? menuHead.closest('.ui-sheet') : summaryHead?.closest('.cart-sheet');
                if (sheet && visible(sheet)) {
                    const touch = event.touches[0];
                    gesture = {x:touch.clientX, y:touch.clientY, distance:0, sheet,
                        dismiss:menuHead ? () => MenuScreen.closeIndex() : () => closeCartSummarySheet()};
                    return;
                }
            }
            const adapter = details();
            if (adapter && !adapter.busy() && !navigating && !pending && !editing() && event.touches?.length === 1 &&
                adapter.root().contains(event.target) && !horizontalScroller(event.target,adapter.root()) && window.getSelection()?.isCollapsed !== false && !event.target.closest('button, a, input, textarea, select, [contenteditable="true"]')) {
                const touch = event.touches[0];
                if (touch.clientX < 24 || touch.clientX > innerWidth - 24) return;
                gesture = {x:touch.clientX, y:touch.clientY, target:event.target, distance:0, adapter,
                    root:adapter.root(), id:adapter.current(), head:!!event.target.closest(adapter.header)};
                return;
            }
            if (!refreshAction || pending || event.touches?.length !== 1 || overlayOpen() || editing() ||
                event.target.closest('button:not([data-view-order]), input, textarea, select, [contenteditable="true"]') || !atTop(event.target)) return;
            const touch = event.touches[0];
            if (touch.clientX < 24 || touch.clientX > innerWidth - 24) return;
            gesture = {x:touch.clientX, y:touch.clientY, target:event.target, distance:0};
        }, {passive:true});
        document.addEventListener('touchmove', event => {
            if (!gesture) return;
            if (gesture.adapter) {
                if (event.touches?.length !== 1 || details() !== gesture.adapter || gesture.adapter.busy() || editing() || gesture.adapter.current() !== gesture.id) { reset(); return; }
                const touch = event.touches[0], dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
                if (!gesture.axis && Math.max(Math.abs(dx),Math.abs(dy)) > 12) gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'x' : 'y';
                if (gesture.axis === 'x') {
                    if (event.cancelable) event.preventDefault();
                    gesture.distance = dx; suppressClickUntil = Date.now() + 600;
                } else if (gesture.axis === 'y') {
                    if (dy < 0 || !atTop(gesture.target)) { reset(); return; }
                    if (event.cancelable) event.preventDefault();
                    gesture.distance = dy; suppressClickUntil = Date.now() + 600;
                    if (!gesture.head) show(dy >= 96 ? 'ready' : 'pull', dy * 0.5);
                }
                return;
            }
            if (event.touches?.length !== 1 || (!gesture.sheet && (overlayOpen() || editing() || !atTop(gesture.target)))) { reset(); return; }
            const touch = event.touches[0];
            const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
            if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) || dy < -8) { reset(); return; }
            if (dy < 10) return;
            if (event.cancelable) event.preventDefault();
            gesture.distance = Math.max(0, dy);
            suppressClickUntil = Date.now() + 600;
            if (gesture.sheet) gesture.sheet.style.transform = 'translateY(' + Math.min(dy, 240) + 'px)';
            else show(dy >= 96 ? 'ready' : 'pull', dy * 0.5);
        }, {passive:false});
        document.addEventListener('touchend', () => {
            if (gesture?.adapter) {
                const ended = gesture;
                reset();
                if (details() !== ended.adapter || ended.adapter.current() !== ended.id || ended.adapter.busy()) return;
                if (ended.axis === 'x' && Math.abs(ended.distance) >= 80) {
                    const rtl = getComputedStyle(ended.root).direction === 'rtl';
                    void step((ended.distance < 0 ? 1 : -1) * (rtl ? -1 : 1));
                } else if (ended.axis === 'y' && ended.distance >= 96) {
                    if (ended.head) ended.adapter.dismiss(); else refresh();
                }
                return;
            }
            const ready = gesture && gesture.distance >= 96;
            const dismiss = gesture?.dismiss;
            reset();
            if (ready) { if (dismiss) dismiss(); else refresh(); }
        }, {passive:true});
        document.addEventListener('touchcancel', reset, {passive:true});
        window.addEventListener('pagehide', reset);
    });
})();
