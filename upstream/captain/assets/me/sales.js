/*
 * ONE WAITER'S OWN DAY.
 *
 * Owner: "sales history of own and table wise seperate."
 *
 * Everything on this page comes from POST /sales/myDay, which scopes the
 * figures to whoever the TOKEN names. This page cannot ask for somebody
 * else's day, whatever is typed at it, and that is deliberate: the same
 * screen is on every waiter's phone.
 */
(function () {
    'use strict';

    const at = (id) => document.getElementById(id);
    const t = text => window.I18N?.t(text) || text;

    const money = amount => CaptainMoney.display(amount);

    const escape = (text) =>
        String(text == null ? '' : text).replace(/[&<>"]/g, (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
        );

    /** A local date string, never toISOString: that is UTC, and a shop is not. */
    function stamp(date) {
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0'),
        ].join('-');
    }

    function when(value) {
        if (!value) return '';
        const then = new Date(value);
        if (isNaN(then.getTime())) return '';
        try {
            return then.toLocaleTimeString(window.I18N?.language?.() || undefined, { hour: 'numeric', minute: '2-digit' });
        } catch (e) {
            return '';
        }
    }

    function draw(data) {
        const total = at('sales-total');
        const count = at('sales-count');
        const cancelled = at('sales-cancelled');
        const hasPaid = typeof data.paid_total === 'number' && Number.isFinite(data.paid_total) && data.paid_total >= 0;
        at('sales-paid-row').hidden = !hasPaid;
        at('sales-paid').textContent = hasPaid ? money(data.paid_total) : '';

        if (total) total.textContent = money(data.total);
        if (count) {
            count.textContent = data.orders
                ? data.orders + (data.orders === 1 ? ' order' : ' orders')
                : 'Nothing sold yet';
        }
        if (cancelled) {
            cancelled.hidden = !data.cancelled;
            cancelled.textContent = data.cancelled
                ? data.cancelled + (data.cancelled === 1 ? ' cancelled order, not counted' : ' cancelled orders, not counted')
                : '';
        }

        const tables = at('sales-tables');
        if (tables) {
            const rows = (data.tables || []).map(
                (row) =>
                    '<div class="me-row me-row-read">' +
                    '<span class="me-row-label" translate="no">' + escape(row.table) + '</span>' +
                    '<span class="me-row-value"><bdi translate="no">' + escape(money(row.total)) + '</bdi> · ' +
                    row.orders + (row.orders === 1 ? ' order' : ' orders') + '</span>' +
                    '</div>'
            );
            tables.innerHTML = rows.length
                ? rows.join('')
                : '<p class="me-note">No tables yet.</p>';
        }

        const recent = at('sales-recent');
        if (recent) {
            const rows = (data.recent || []).map(
                (row) =>
                    '<div class="me-row me-row-read' + (row.cancelled ? ' is-struck' : '') + '">' +
                    '<span class="me-row-label">' +
                    escape(row.table_number ? row.table_number : 'No table') +
                    '<span class="me-row-sub">' + escape(when(row.created_at)) + '</span>' +
                    '</span>' +
                    '<span class="me-row-value" translate="no"><bdi>' + escape(money(row.total_amount)) + '</bdi></span>' +
                    '</div>'
            );
            recent.innerHTML = rows.length ? rows.join('') : '<p class="me-note">No orders yet.</p>';
        }
    }

    function clearFigures() {
        const tables = at('sales-tables');
        const recent = at('sales-recent');
        const note = '';
        if (tables) tables.innerHTML = note;
        if (recent) recent.innerHTML = note;

        const total = at('sales-total');
        if (total) total.textContent = '';
        at('sales-paid-row').hidden = true;
        at('sales-paid').textContent = '';
        at('sales-count').textContent = '';
        at('sales-cancelled').textContent = '';
        at('sales-cancelled').hidden = true;
    }

    let selectedDay = 'today', revision = 0, loadedDay = null;
    async function load(which) {
        selectedDay = which;
        const request = ++revision;
        const day = new Date();
        if (which === 'yesterday') day.setDate(day.getDate() - 1);
        const dateKey = stamp(day);
        if (loadedDay !== dateKey) {
            loadedDay = null;
            clearFigures();
        }
        at('sales-status').textContent = t('Loading...');
        document.querySelector('main').setAttribute('aria-busy', 'true');
        let timer;
        try {
            const said = await Promise.race([
                Promise.resolve().then(() => POSNIC.api.post('/sales/myDay', {
                    branch_id: localStorage.getItem('branch_id') || '',
                    day: dateKey,
                })),
                new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('sales_timeout')), 20000); }),
            ]);
            if (request !== revision) return false;
            if (said?.type !== 'success' || !said.data) throw new Error('Connection failed');
            draw(said.data);
            loadedDay = dateKey;
            at('sales-status').textContent = '';
            return true;
        } catch (error) {
            /*
             * A till that will not answer is not "you have sold nothing". The
             * difference matters on a screen about money.
             */
            if (request !== revision) return false;
            const message = t('The till did not answer. Try again in a moment.');
            at('sales-status').textContent = message;
            if (loadedDay !== dateKey) clearFigures();
            return false;
        } finally {
            clearTimeout(timer);
            if (request === revision) document.querySelector('main').removeAttribute('aria-busy');
        }
    }
    window.refreshMySales = () => load(selectedDay);
    window.addEventListener('captain:back', event => {
        if (event.defaultPrevented || document.querySelector('dialog[open], #posnic-lock.is-open')) return;
        event.preventDefault();
        location.href = 'me.html';
    });

    document.addEventListener('DOMContentLoaded', function () {
        at('sales-pending').addEventListener('click', () => sessionStorage.setItem('captain_pending_return', 'my-sales.html'));
        const back = at('sales-back');
        if (back) {
            back.addEventListener('click', function () {
                window.location.href = 'me.html';
            });
        }

        document.querySelectorAll('.sales-day').forEach(function (button) {
            button.addEventListener('click', function () {
                document.querySelectorAll('.sales-day').forEach(function (other) {
                    other.classList.toggle('is-on', other === button);
                    other.setAttribute('aria-pressed', String(other === button));
                });
                load(button.getAttribute('data-day'));
            });
        });

        load('today');
    });
})();
