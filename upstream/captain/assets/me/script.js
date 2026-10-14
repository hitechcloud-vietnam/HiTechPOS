/*
 * THE PAGE FOR EVERYTHING THAT IS NOT AN ORDER.
 *
 * Owner: "arrange profile update, logout, app setting or preferences and etc
 * make it professional arrangements."
 *
 * Each control here already existed somewhere. What did not exist was a place
 * to look for them: sign out was on the floor and only on a one-branch shop,
 * the preferences were in a sheet behind a server icon, and the version was on
 * the sign-in screen. This is the place.
 */
(function () {
    'use strict';

    const at = (id) => document.getElementById(id);

    const money = (amount) => {
        const number = Number(amount) || 0;
        try {
            return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
        } catch (e) {
            return String(Math.round(number));
        }
    };

    /* ------------------------------------------------------------- who */

    function paintWho() {
        const line = at('me-who');
        if (!line) return;

        let name = '';
        try {
            name = (POSNIC.session && POSNIC.session.user && POSNIC.session.user.name) || '';
        } catch (e) {
            name = '';
        }
        for (const target of [line, at('me-home-who')].filter(Boolean)) {
            target.translate = !name;
            target.textContent = name || 'Signed in on this phone';
        }
    }

    /*
     * TODAY'S TAKINGS, ON THE WAY TO THE PAGE THAT BREAKS THEM DOWN.
     *
     * Quietly: a waiter opening this page to sign out does not need to wait
     * for a number, so a failure leaves the row saying nothing rather than
     * putting an error on a screen nobody came here for.
     */
    async function paintToday() {
        const cell = at('me-today');
        if (!cell) return;

        try {
            const said = await POSNIC.api.post('/sales/myDay', {
                branch_id: localStorage.getItem('branch_id') || '',
            });
            const data = (said && said.data) || {};
            cell.textContent = data.orders
                ? money(data.total) + ' · ' + data.orders + (data.orders === 1 ? ' order' : ' orders')
                : 'Nothing yet';
        } catch (e) {
            cell.textContent = '';
        }
    }

    /* --------------------------------------------------------- the lock */

    function paintLock() {
        const state = at('me-lock-state');
        const off = at('me-lock-off');
        const row = at('me-lock');
        if (!state || !off || !row) return;

        let on = false;
        try {
            on = !!(window.POSNIC && POSNIC.lock && POSNIC.lock.isSet());
        } catch (e) {
            on = false;
        }

        state.textContent = on ? 'On' : 'Off';
        row.querySelector('.me-row-label').textContent = on ? 'Change the PIN' : 'Screen lock';
        off.hidden = !on;
    }

    function wireLock() {
        const row = at('me-lock');
        const off = at('me-lock-off');
        if (row) {
            row.addEventListener('click', async function () {
                if (!(window.POSNIC && POSNIC.lock)) return;
                if (POSNIC.lock.isSet() && !await POSNIC.lock.unlock('', {why:'Enter your PIN',escape:'Not now'})) return;
                await POSNIC.lock.choose(); paintLock();
            });
        }
        if (off) {
            off.addEventListener('click', function () {
                if (!(window.POSNIC && POSNIC.lock)) return;
                /* The current PIN first: whoever is holding this phone is past
                   the lock, so this stops it being handed back with the lock
                   quietly gone. */
                POSNIC.lock
                    .unlock('', { why: 'Enter your PIN to turn the lock off', escape: 'Not now' })
                    .then(function (ok) {
                        if (ok) POSNIC.lock.clear();
                        paintLock();
                    });
            });
        }
    }

    /* --------------------------------------------------- what this phone is set to */

    /* THE SAME KEY THE FLOOR SHEET USES, spelled the way it spells it. A
       second name for one setting is two settings that disagree, and this had
       an underscore where the app has a dot. */
    const COPIES = 'posnic.bill_copies';

    function paintPreferences() {
        at('me-item-prices').value = CaptainPhone.priceMode();
        for (const name of ['sound', 'vibration']) at('me-' + name).checked = CaptainPhone.enabled(name);
        at('me-vibration-row').hidden = typeof navigator.vibrate !== 'function';
        const language = at('me-language');
        if (language && typeof I18N !== 'undefined') {
            language.value = I18N.language();
            at('me-language-name').textContent = language.selectedOptions[0]?.textContent || '';
        }

        const copies = at('me-copies');
        if (copies) {
            let held = '';
            try {
                held = localStorage.getItem(COPIES) || '';
            } catch (e) {
                held = '';
            }
            copies.value = ['1', '2', '3'].includes(held) ? held : '';
        }

        const where = at('me-server-where');
        if (where) {
            let address = '';
            try {
                address = (POSNIC.server && POSNIC.server.baseUrl) || '';
            } catch (e) {
                address = '';
            }
            where.textContent = address;
        }

        const version = at('me-version');
        if (version) {
            const build = window.POSNIC_BUILD;
            version.textContent = build && build.version
                ? 'Captain ' + build.version + (build.commit ? ' (' + build.commit + ')' : '')
                : 'Captain dev build';
        }
    }

    function wirePreferences() {
        at('me-item-prices').addEventListener('change', event => {
            const saved = CaptainPhone.setPriceMode(event.target.value);
            if (!saved) event.target.value = CaptainPhone.priceMode();
            at('me-preference-message').textContent = saved ? '' : I18N.t('Could not save. Please try again.');
        });
        for (const name of ['sound', 'vibration']) {
            at('me-' + name).addEventListener('change', event => {
                const saved = CaptainPhone.set(name, event.target.checked);
                if (!saved) event.target.checked = CaptainPhone.enabled(name);
                at('me-preference-message').textContent = saved ? '' : I18N.t('Could not save. Please try again.');
            });
        }
        const language = at('me-language');
        if (language) {
            language.addEventListener('change', function () {
                if (typeof I18N !== 'undefined') I18N.use(language.value);
                at('me-language-name').textContent = language.selectedOptions[0]?.textContent || '';
            });
        }

        const copies = at('me-copies');
        if (copies) {
            copies.addEventListener('change', function () {
                try {
                    if (copies.value) localStorage.setItem(COPIES, copies.value);
                    else localStorage.removeItem(COPIES);
                } catch (e) {
                    /* The choice lasts this session and the shop's setting
                       answers on the next one. */
                }
            });
        }

        const server = at('me-server');
        if (server) {
            server.addEventListener('click', function () {
                /* The connect sheet lives on the sign-in screen: three hundred
                   lines of scanning, sweeping and pairing, and a second copy
                   would drift from the first the week after it was made. */
                try {
                    sessionStorage.setItem('posnic_change_server', '1');
                } catch (e) {
                    /* private mode: the page still opens, just without the sheet */
                }
                window.location.href = 'index.html';
            });
        }
    }

    /* ------------------------------------------------------- the account */

    function wireAccount() {
        at('me-sign-out')?.addEventListener('click', () => CaptainAccount.change('staff'));
    }

    document.addEventListener('DOMContentLoaded', function () {
        paintWho();
        paintLock();
        paintPreferences();
        wireLock();
        wirePreferences();
        wireAccount();
        paintToday();
    });
})();
