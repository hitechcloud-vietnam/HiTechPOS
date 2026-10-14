function showLoader() {
    const loader = document.getElementById("loader");
    if (loader) loader.style.display = "flex";
}

function hideLoader() {
    const loader = document.getElementById("loader");
    if (loader) loader.style.display = "none";
}

function refreshPage() {
    return window.MobileGestures ? MobileGestures.refresh() : loadTables();
}

function goToKotHistory() {
    window.location.href = 'order-history.html';
}

function goToAddKot() {
    window.location.href = 'discount.html';
}

/*
 * Offered only when there is somewhere to change TO.
 *
 * A shop with a single branch was shown this button, and it led to a list
 * with one card on it. Not a choice, and one more thing on a screen a waiter
 * reads at speed while standing at a table.
 */
function showChangeBranchIfUseful() {
    const button = document.getElementById('kot-change-branch');
    if (!button) return;
    let branches = [];
    try {
        branches = JSON.parse(localStorage.getItem('kiosk_branch_list') || '[]') || [];
    } catch (e) {
        branches = [];
    }
    button.hidden = branches.length < 2;
}
document.addEventListener('DOMContentLoaded', showChangeBranchIfUseful);

/*
 * WHICH SHOP THIS PHONE IS POINTED AT - and only then, changing it.
 *
 * This used to navigate straight to the sign-in screen, which read as the app
 * reloading itself for no reason. Most of the time the question is just "which
 * shop am I on", and that costs nothing to answer here.
 *
 * Changing it genuinely does have to leave: the cached branch, menu, tables
 * and cart all belong to the shop being left, and a Tables screen showing one
 * shop while the app talks to another is worse than a reload. So the trip back
 * is a button somebody presses, with the consequence written beside it.
 */
function changeServer() {
    const sheet = document.getElementById('server-sheet');
    if (!sheet) return;

    const where = document.getElementById('server-where');
    if (where) {
        let address = '';
        try {
            address = POSNIC.server.baseUrl || '';
        } catch (e) {
            address = '';
        }
        where.textContent = address || 'Not connected to a shop yet';
    }

    const copies = document.getElementById('bill-copies');
    if (copies) copies.value = storedBillCopies();

    /* Whatever this phone is reading in, so the sheet opens telling the truth
       rather than always saying English. */
    const language = document.getElementById('app-language');
    if (language && typeof I18N !== 'undefined') language.value = I18N.language();

    /* Whose account this phone is on. A handset gets passed around. */
    const who = document.getElementById('signed-in-as');
    if (who) {
        let name = '';
        try {
            name = (POSNIC.session && POSNIC.session.user && POSNIC.session.user.name) || '';
        } catch (e) {
            name = '';
        }
        if (name) {
            const label = document.createElement('span');
            label.textContent = 'Signed in as ';
            const person = document.createElement('bdi');
            person.setAttribute('translate', 'no');
            person.textContent = name;
            who.replaceChildren(label, person);
        } else who.textContent = 'Signed in on this phone';
    }

    /* Which build this phone is on, said plainly enough to read down a
       telephone. It was on the sign-in screen only, so signing out was the
       only way to answer the question. */
    const version = document.getElementById('app-version-line');
    if (version) {
        const build = window.POSNIC_BUILD;
        version.textContent = build && build.version
            ? 'Captain ' + build.version + (build.commit ? ' (' + build.commit + ')' : '')
            : 'Captain dev build';
    }

    paintLock();
    sheet.hidden = false;
}

/*
 * HOW MANY COPIES THIS PHONE ASKS FOR.
 *
 * Owner: "its better two copies from captain itself... configuration change
 * reequired pos guy wont have permission. lets keep in app itself." The person
 * who wants a second copy is the one holding the phone, and sending them to
 * find somebody with access to the till's settings page is how a setting stays
 * wrong for a year.
 *
 * EMPTY MEANS "AS THE SHOP IS SET", which is the honest default and not the
 * same as one: the till has its own setting, and a phone that has never been
 * asked should not overrule it. Only a number chosen here travels.
 */
const BILL_COPIES_KEY = 'posnic.bill_copies';

function storedBillCopies() {
    try {
        const said = localStorage.getItem(BILL_COPIES_KEY) || '';
        return /^[123]$/.test(said) ? said : '';
    } catch (e) {
        /* A phone with storage blocked still takes orders. */
        return '';
    }
}

function rememberBillCopies(value) {
    try {
        if (/^[123]$/.test(String(value))) localStorage.setItem(BILL_COPIES_KEY, String(value));
        else localStorage.removeItem(BILL_COPIES_KEY);
    } catch (e) {
        /* Nothing to do: the choice lasts this session and the shop's setting
           answers on the next one. */
    }
}

/*
 * THE SCREEN LOCK, IN THE TWO STATES IT HAS.
 *
 * With no PIN it offers one. With a PIN it changes it, and a second button
 * turns it off. Nobody reading this at speed should have to work out which
 * state they are in, so the button says which.
 */
function paintLock() {
    const set = document.getElementById('lock-set');
    const off = document.getElementById('lock-off');
    if (!set || !off) return;

    let on = false;
    try {
        on = !!(window.POSNIC && POSNIC.lock && POSNIC.lock.isSet());
    } catch (e) {
        /* Storage this phone will not read. Nothing is locked, so the honest
           thing to show is the offer. */
        on = false;
    }

    set.textContent = on ? 'Change the PIN' : 'Set a PIN';
    off.hidden = !on;
}

document.addEventListener('change', function (event) {
    if (event.target && event.target.id === 'bill-copies') {
        rememberBillCopies(event.target.value);
    }

    /*
     * The language changes the screen under the waiter's thumb, with no reload
     * and nothing lost: the English of every line is remembered per node, so
     * this is a swap and not a redraw. A half-typed note stays half typed.
     */
    if (event.target && event.target.id === 'app-language' && typeof I18N !== 'undefined') {
        I18N.use(event.target.value);
    }
});

/* Delegated, because the sheet is in the page from the start and these three
   controls outlive every redraw of the floor. */
document.addEventListener('click', function (event) {
    if (!event.target.closest) return;

    if (event.target.closest('#server-close') || event.target.id === 'server-scrim') {
        const sheet = document.getElementById('server-sheet');
        if (sheet) sheet.hidden = true;
        return;
    }

    if (event.target.closest('#sign-out')) {
        signOut();
        return;
    }

    if (event.target.closest('#lock-set')) {
        if (window.POSNIC && POSNIC.lock) POSNIC.lock.choose().then(paintLock);
        return;
    }

    if (event.target.closest('#lock-off')) {
        /*
         * The current PIN first. Whoever is holding this phone is already
         * past the lock, so this is not stopping them getting in; it stops a
         * phone being handed back with the lock quietly gone.
         */
        if (!(window.POSNIC && POSNIC.lock)) return;
        POSNIC.lock
            .unlock('', { why: 'Enter your PIN to turn the lock off', escape: 'Not now' })
            .then(function (ok) {
                if (ok) POSNIC.lock.clear();
                paintLock();
            });
        return;
    }

    if (event.target.closest('#server-find')) {
        /* The same trip, with a second flag so the sign-in screen starts the
           sweep rather than waiting to be asked. */
        try {
            sessionStorage.setItem('posnic_change_server', '1');
            sessionStorage.setItem('posnic_find_on_wifi', '1');
        } catch (e) {
            /* private mode: the sheet still opens, just on the menu */
        }
        window.location.href = 'index.html';
        return;
    }

    if (event.target.closest('#server-change')) {
        /*
         * NOW it leaves, because now somebody asked it to. The connect sheet
         * stays on index.html: it is three hundred lines of scanning, sweeping
         * and pairing, and a second copy would drift from the first the week
         * after it was made.
         */
        try {
            sessionStorage.setItem('posnic_change_server', '1');
        } catch (e) {
            /* private mode: the page still opens, just without the sheet */
        }
        window.location.href = 'index.html';
    }
});

async function changeBranch() {
    try {
        localStorage.setItem('kiosk_force_branch_select', '1');
        window.location.href = 'index.html';
    } catch (e) {
        console.error('Failed to change branch', e);
    }
}

async function signOut() { return CaptainAccount.change('staff'); }

async function checkBranchCount() {
    try {
        const branchBtn = document.querySelector('.kot-btn-branch');
        if (!branchBtn) return;
        
        // Get branches from localStorage
        const branchesData = localStorage.getItem('kiosk_branch_list');
        let branches = [];
        
        if (branchesData) {
            try {
                branches = JSON.parse(branchesData);
            } catch (e) {
                console.error('Failed to parse kiosk_branch_list', e);
            }
        }
        
        // If only 1 branch, show Sign Out button instead
        if (branches.length === 1) {
            branchBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Sign Out';
            branchBtn.onclick = signOut;
        } else {
            branchBtn.innerHTML = '<i class="fas fa-store"></i> Change Branch';
            branchBtn.onclick = changeBranch;
        }
    } catch (e) {
        console.error('Failed to check branch count', e);
    }
}

function showSectionLoader(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    
    const loader = document.createElement('div');
    loader.className = 'section-loader';
    loader.innerHTML = '<div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div>';
    loader.style.cssText = 'position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(255,255,255,0.9); display: flex; align-items: center; justify-content: center; z-index: 10;';
    
    section.style.position = 'relative';
    section.appendChild(loader);
}

function hideSectionLoader(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    
    const loader = section.querySelector('.section-loader');
    if (loader) loader.remove();
}

function isServerConnectionError(error) {
    const message = error && error.message ? error.message : String(error || '');
    return error?.name === 'AbortError' ||
        /Failed to fetch|NetworkError|timeout|Load failed/i.test(message);
}

/*
 * Text that cannot become markup.
 *
 * A table number is typed by hand on the screen before this one, so it is
 * whatever somebody's thumb produced - and it used to go into an href, a data
 * attribute AND an onclick argument, raw, three times per card.
 */
/**
 * WHAT THE KITCHEN WAS TOLD ABOUT THIS DISH.
 *
 * Owner: "i see notes inside kot print but inside app not showing note (ex.
 * medium spicy). need fix. its important captain know the customization."
 *
 * The note reached the paper and stopped there. A waiter reading an order back
 * to a table could see "Chicken Biryani x2" and nothing about the medium
 * spicy - so the one screen where a mistake is still cheap to catch was the
 * one screen that did not show it.
 *
 * TWO FIELD NAMES, both real. `item_description` is what the till stores and
 * what a saved order comes back with; `notes` is what a line carries while it
 * is still in this phone's cart. A screen that reads only one of them is
 * right half the time, which is worse than being wrong - it works until the
 * moment somebody checks.
 */
function lineNote(item) {
    if (!item) return '';
    return String(item.item_description || item.notes || item.item_note || '').trim();
}

function escapeFloor(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/*
 * "THE GUEST ON TABLE FOUR WOULD LIKE THE BILL."
 *
 * The one half of billing the floor is trusted with. The waiter is standing at
 * the table when the guest asks, and walking to the counter to have somebody
 * else press a button is the errand a handset exists to remove. Every
 * restaurant POS worth the name lets the floor fire this - Toast, Square,
 * Lightspeed, MICROS, Petpooja.
 *
 * WHAT IT DOES NOT DO IS SETTLE. The person who takes the order must not be
 * the person who declares the money received, or a cash bill can be closed and
 * pocketed with nothing in the system to disagree. So this asks, and the
 * cashier settles. Owner: "usually cashier / desktop person only responsible
 * and confirm the settlement not waiter i thought" - which is the standard.
 *
 * AND IT PRINTS AT THE COUNTER, not here and not in the kitchen. The phone
 * never owns a printer: it marks the ticket and the till, which owns the
 * hardware, picks it up and prints on the receipt roll. A till that was
 * switched off catches up when it comes back rather than losing the bill.
 */
document.addEventListener('click', async function (event) {
    const button = event.target.closest && event.target.closest('#ask-for-bill');
    if (!button) return;

    const table = button.getAttribute('data-table') || '';
    if (!table) return;

    button.disabled = true;
    const said = button.textContent;
    button.textContent = 'Asking...';
    try {
        const branchId = localStorage.getItem('branch_id') || null;
        const who = (() => {
            try {
                return JSON.parse(localStorage.getItem('posnic.session') || '{}').name || '';
            } catch (e) {
                return '';
            }
        })();

        const answer = await POSNIC.api.post('/sales/requestBillPrint', {
            branchId,
            table_number: table,
            ...(button.dataset.saleId ? {saleId:button.dataset.saleId} : {}),
            asked_by: who,
            /*
             * Sent only when this phone has been told a number. Left out, the
             * shop's own setting answers - so an older till, or a phone nobody
             * has touched, behaves exactly as it does today. The server clamps
             * whatever arrives, because a phone must not be able to spend a
             * roll of paper on one table.
             */
            ...(storedBillCopies() ? { copies: Number(storedBillCopies()) } : {}),
        });

        /* The server answers "on its way" or "nothing is open on that table",
           and those send a waiter to two different places - so its words are
           shown rather than a cheerful noise of our own. */
        showToast((answer && answer.message) || 'The bill is on its way to the counter');
        if (answer?.type !== 'success' || answer?.data?.status === false || answer?.status === false) {
            button.disabled = false;
            button.textContent = said;
        } else button.textContent = 'Bill asked for';
    } catch (error) {
        button.disabled = false;
        button.textContent = said;

        /*
         * A 404 HERE MEANS THE TILL IS OLD, NOT THAT SOMETHING WENT WRONG.
         *
         * The desktop app carries its own copy of the API inside the exe, so a
         * shop talking to its own till is running whatever version was last
         * installed there. /sales/requestBillPrint does not exist in a build
         * made before it was written, and Express answers a route it has never
         * heard of with 404 - which reached a waiter as a blank failure and
         * cost a round of "it says table not open or something".
         *
         * Saying which machine needs attention is the whole difference between
         * a message somebody can act on and one they can only report.
         */
        const status = error && (error.status || error.statusCode);
        showToast(
            status === 404
                ? 'This till is too old to print bills from a phone. Update POSNIC on the till.'
                : (error && error.message) || 'Could not ask for the bill',
            'error'
        );
    }
});

/* Delegated, so a card carries no code of its own - which is what let the
   table name end an onclick early when somebody typed an apostrophe. */
document.addEventListener('click', function (event) {
    const card = event.target.closest && event.target.closest('.floor-card');
    if (!card) return;
    if (card.dataset.awaitingClose === 'true') return;
    event.preventDefault();
    selectTable(card.getAttribute('data-table-number'), card.hasAttribute('data-takeaway'), {saleId: card.dataset.saleId});
});

let tablesLoading = false;
let tablesRequest = null;
function loadTables() {
    if (!tablesRequest) tablesRequest = loadTablesNow().finally(() => { tablesRequest = null; });
    return tablesRequest;
}
async function loadTablesNow() {
    const container = document.getElementById('tables-list');
    const noOrdersMsg = document.getElementById('no-orders-message');
    
    if (!container || tablesLoading) return;
    tablesLoading = true;
    let status = document.getElementById('floor-connection-status');
    if (!status) {
        status = document.createElement('p');
        status.id = 'floor-connection-status';
        status.setAttribute('role', 'status');
        status.style.cssText = 'font-size:13px;color:#64748b;line-height:1.5;margin:12px 0;';
        status.hidden = true;
        container.before(status);
    }

    try {
        if (!container.querySelector('.floor-card')) showSectionLoader('tables-list');
        // Get branch_id from localStorage
        // kiosk_selected_branch stores the store_id (MongoDB _id) as a plain string
        const branchId = localStorage.getItem('branch_id') || null;

        const data = await POSNIC.api.post('/sales/getTablesWithActiveOrders', {
            branch_id: branchId
        });
        
        if (data.type !== 'success' || !data.data) {
            throw new Error(data.message || 'Tables unavailable');
        }
        status.hidden = true;

        const tables = data.data.tables || [];
        const hasTakeaway = data.data.has_takeaway || false;
        
        // Check if there are any orders (tables or takeaway)
        if (tables.length === 0 && !hasTakeaway) {
            if (noOrdersMsg) noOrdersMsg.style.display = 'block';
            container.innerHTML = '';
            /* And the count with it, or "3 tables open" hangs above a screen
               that has just said nothing is. */
            const empty = document.getElementById('floor-count');
            if (empty) empty.textContent = '';
            window.FloorDashboard?.update(data.data);
            return true;
        }

        if (noOrdersMsg) noOrdersMsg.style.display = 'none';

        /*
         * OLDEST FIRST, and how long each has been waiting.
         *
         * This drew identical boxes in alphabetical order, so table 1 came
         * first whether it had been waiting a minute or an hour - which is the
         * same as no order at all. The two questions somebody walking back
         * onto the floor actually has are which table has waited longest and
         * which is nearly done, and neither could be answered from here.
         *
         * The server was already grouping the open tickets by table and
         * throwing everything but the name away; it sends the count, the age
         * and the total now. A till that has NOT been updated sends only the
         * names, and every card below degrades to exactly what it used to be
         * rather than to nothing.
         */
        const detailed = (data.data.table_details || []).length
            ? FloorView.order(data.data.table_details)
            : tables.map((name) => ({ table_number: name, minutes: null }));

        const card = (name, detail, extraClass) => {
            const awaitingClose = detail?.awaiting_close === true;
            const minutes = awaitingClose ? null : detail ? detail.minutes : null;
            const age = FloorView.age(minutes);
            const said = FloorView.saidAs(minutes);
            const meta = FloorView.summary(detail);
            const safe = escapeFloor(name);

            return '<a href="' + (awaitingClose ? 'tables.html?source=floor&table=' + encodeURIComponent(name) : '#/kot/' + encodeURIComponent(name)) + '"' +
                (awaitingClose ? ' data-awaiting-close="true"' : '') +
                ' class="floor-card' + (extraClass ? ' ' + extraClass : '') + '"' +
                (age ? ' data-age="' + age + '"' : '') +
                /* WHAT IT IS, NOT WHAT IT SAYS. The takeaway card used to be
                   recognised by its own label, and the label here is "Take
                   away" while the code looking for it asked for "Takeaway". */
                (extraClass === 'is-takeaway' ? ' data-takeaway="true"' : '') +
                (detail?.sale_id ? ' data-sale-id="' + escapeFloor(detail.sale_id) + '"' : '') +
                ' data-table-number="' + safe + '">' +
                '<div class="floor-name">' + (extraClass === 'is-takeaway' ? '<i class="fas fa-bag-shopping" aria-hidden="true"></i> ' : '') + safe + '</div>' +
                (detail?.payment_status === 'Paid' ? '<div class="floor-meta">' + escapeFloor(window.I18N?.t('Paid') || 'Paid') + '</div>' : '') +
                (awaitingClose ? '<div class="floor-meta">' + escapeFloor(window.I18N?.t('Paid') || 'Paid') + ' · ' + escapeFloor(window.I18N?.t('Close order') || 'Close order') + '</div>' : '') +
                (said ? '<div class="floor-since">' + escapeFloor(said) + '</div>' : '') +
                (meta ? '<div class="floor-meta">' + escapeFloor(meta) + '</div>' : '') +
                '</a>';
        };

        let html = '';
        detailed.forEach((detail) => {
            html += card(detail.table_number, detail);
        });

        const takeawayOrders = Array.isArray(data.data.takeaway_orders) ? data.data.takeaway_orders : [];
        if (takeawayOrders.length) {
            for (const order of takeawayOrders) {
                html += card('Take Away ' + order.number, {...order, minutes: FloorView.minutesSince(order.since)}, 'is-takeaway');
            }
        } else if (hasTakeaway) {
            const takeaway = data.data.takeaway_detail || null;
            const withMinutes = takeaway
                ? { ...takeaway, minutes: FloorView.minutesSince(takeaway.since) }
                : null;
            html += card('Take away', withMinutes, 'is-takeaway');
        }

        container.innerHTML = html;

        /* One count, said once, so a glance answers "how busy is it". */
        const count = document.getElementById('floor-count');
        if (count) {
            const open = detailed.length + (takeawayOrders.length || (hasTakeaway ? 1 : 0));
            /* Just the number now: the words are on the heading beside it,
               and "3 tables open" under "Active tables" says tables twice. */
            count.textContent = open === 1 ? '1 open' : open + ' open';
        }
        window.FloorDashboard?.update(data.data);
        return true;
    } catch (error) {
        console.error('Error loading tables:', error);
        // Keep the last table view and let background polling recover. A
        // failed request cannot tell us that every table has been settled.
        if (noOrdersMsg) noOrdersMsg.style.display = 'none';
        status.textContent = container.querySelector('.floor-card')
            ? 'Tables may be out of date. Reconnecting… You can still take a new order.'
            : 'Tables are unavailable. Reconnecting… You can still take a new order.';
        status.hidden = false;
        return false;
    } finally {
        tablesLoading = false;
        hideSectionLoader('tables-list');
    }
}

// Open sliding panel
function openSlidingPanel() {
    const panel = document.getElementById('kot-sliding-panel');
    const overlay = document.getElementById('kot-panel-overlay');
    
    if (panel) panel.classList.add('open');
    if (overlay) overlay.classList.add('active');
}

// Close sliding panel
function closeSlidingPanel() {
    floorDetailRevision++;
    floorDetailLoading = false;
    const panel = document.getElementById('kot-sliding-panel');
    const overlay = document.getElementById('kot-panel-overlay');
    
    if (panel) panel.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
    
    // Remove active class from all tables
    document.querySelectorAll('.kot-table-box').forEach(box => {
        box.classList.remove('active');
    });
}

/*
 * IS THIS THE TAKEAWAY QUEUE?
 *
 * Owner: "one order show as take away, when tap, inside shows no active
 * orders."
 *
 * The floor drew that card with the words "Take away" and this screen asked
 * whether the name was "Takeaway" - one space apart, and nothing anywhere said
 * so. The check failed, the else branch ran, and it went looking for a table
 * literally called "Take away". No sale has one: a takeaway carries dine_type,
 * not a table number. So the card was right, the queue was real, and tapping
 * it reported nothing there.
 *
 * The card now says what it IS and this is told directly. The spellings are
 * still accepted as a fallback, because order-history.js has always had to
 * take both - the data uses both - and a caller that has only a name should
 * not be the thing that breaks next.
 */
/**
 * Was this whole ticket cancelled?
 *
 * The till spells it on the ticket, not on its lines, so a cancelled order
 * has to strike every line it carries.
 */
function kotIsCancelled(kot) {
    return String((kot && kot.status) || '').toLowerCase() === 'cancelled';
}

/**
 * Was this one line taken off a live ticket?
 *
 * Spelled more than one way over the years, so all of them are accepted here
 * rather than at each of the places that draws a line.
 */
function itemIsCancelled(item) {
    if (!item) return false;
    if (item.cancelled === true || item.is_cancelled === true) return true;
    if (String(item.status || '').toLowerCase() === 'cancelled') return true;
    const off = Number(item.cancelled_quantity || 0);
    const had = Number(item.item_quantity || item.quantity || 0);
    return off > 0 && had > 0 && off >= had;
}

function isTakeawayName(name) {
    return String(name || '').replace(/\s+/g, '').toLowerCase() === 'takeaway';
}

let floorDetail = null, floorDetailRevision = 0, floorDetailLoading = false;
async function selectTable(tableName, takeaway, options = {}) {
    const revision = ++floorDetailRevision;
    floorDetailLoading = true;
    floorDetail = { id: String(tableName), saleId: options.saleId, takeaway: takeaway === true || isTakeawayName(tableName) };
    const isTakeaway = takeaway === true || isTakeawayName(tableName);
    const panelContent = document.getElementById('sliding-panel-content');
    const panelTitle = document.getElementById('panel-title');
    
    if (!panelContent || !panelTitle) return;

    // Remove active class from all tables
    document.querySelectorAll('.kot-table-box').forEach(box => {
        box.classList.remove('active');
    });

    // Add active class to selected table
    const selectedTable = document.querySelector(`.kot-table-box[data-table-number="${tableName}"]`);
    if (selectedTable) {
        selectedTable.classList.add('active');
    }

    // Update panel title
    panelTitle.textContent = isTakeaway ? (options.saleId ? tableName : 'Takeaway Orders') : `Table ${tableName}`;
    
    // Open the sliding panel
    openSlidingPanel();
    
    // Clear previous content
    if (!options.refresh) panelContent.innerHTML = '';
    window.dispatchEvent(new Event('captain:details'));

    try {
        if (!options.refresh) showSectionLoader('sliding-panel-content');
        let filters = {};
        const branchId = localStorage.getItem('branch_id') || null;
        /*
         * STILL OPEN. The floor already means this and this did not say it.
         *
         * Owner: "how come 3 orders in same table. need to check and fix."
         *
         * getTablesWithActiveOrders draws the floor from
         * `{ sale_process: KOT, payment_status: 'Unpaid' }`, so a table appears
         * because it has ONE open ticket. Tapping it asked only for the table
         * number - no status at all - so the panel answered with every KOT ever
         * written against that table name, including the ones settled and paid
         * at earlier sittings, under a badge that says "Active KOTs".
         *
         * Three tickets on a table is also a perfectly ordinary thing: a table
         * that orders three times has three tickets, and each is printed and
         * cooked separately. The times on the cards tell those apart from these.
         * What was wrong was the word ACTIVE, applied to closed ones.
         *
         * The same shape as the takeaway card: two queries about the same
         * orders, agreeing on one clause and not the other.
         */
        const stillOpen = { sale_process: 'KOT', payment_status: 'Unpaid' };
        if (isTakeaway) {
            // A paid takeaway still needs preparation and handover. Its stable
            // sale ID opens just this customer, without the old unpaid filter.
            filters = options.saleId ? {_id: options.saleId, dine_type: 'Take away'} : { ...stillOpen, dine_type: 'Take away' };
        } else {
            filters = { ...stillOpen, table_number: tableName };
        }
        const data = await POSNIC.api.get(
            `/sales/getListKot?page=1&limit=100` +
            `&filters=${encodeURIComponent(JSON.stringify(filters))}&branchId=${branchId}`);
        
        if (revision !== floorDetailRevision) return false;
        if (data.type !== 'success' || !Array.isArray(data.data?.list)) throw new Error('Failed to load orders');
        if (data.data.list.length === 0) {
            panelContent.innerHTML = '<div class="empty-kot-message"><i class="fas fa-clipboard-list"></i><p>' +
                (isTakeaway ? 'No active takeaway orders' : 'No active orders for this table') +
                '</p></div>';
            currentKotOrders = []; // Clear orders
            return true;
        }

        const kots = data.data.list;
        currentKotOrders = kots; // Store orders globally
        const kotCount = kots.length;
        const targetSaleId = isTakeaway ? String(options.saleId || '') : '';
        const targetAttribute = targetSaleId ? ` data-sale-id="${escapeFloor(targetSaleId)}"` : '';
        const alreadyPaid = isTakeaway && kots.every(kot => kot.payment_status === 'Paid');

        // Header shown once
        let headerHtml = `
            <div class="kot-details-header">
                <span class="active-kot-badge">${kotCount} orders</span>
                ${
                  isTakeaway && (!targetSaleId || alreadyPaid)
                    ? ''
                    : `<div class="floor-bill-actions" ${targetSaleId ? 'hidden data-takeaway-billing="true"' : ''}><button type="button" class="floor-bill-btn" data-review-bill="${escapeFloor(tableName)}"${targetAttribute}>Bill</button><button type="button" class="floor-bill-btn" hidden data-collect-table="${escapeFloor(tableName)}"${targetAttribute}>Collect payment</button><button type="button" class="floor-bill-btn" data-split-table="${escapeFloor(tableName)}"${targetAttribute}>Split bill</button><button type="button" class="floor-bill-btn" id="ask-for-bill"${targetAttribute}
                         data-table="${escapeFloor(tableName)}">Print the bill</button></div>`
                }
            </div>
        `;

        let kotsCardsHtml = '';
        
        kots.forEach((kot, kotIndex) => {
            // Handle MongoDB date format
            let timestamp;
            if (kot.updated_date?.$date) {
                if (typeof kot.updated_date.$date === 'object' && kot.updated_date.$date.$numberLong) {
                    timestamp = parseInt(kot.updated_date.$date.$numberLong);
                } else {
                    timestamp = kot.updated_date.$date;
                }
            } else if (kot.created_date?.$date) {
                if (typeof kot.created_date.$date === 'object' && kot.created_date.$date.$numberLong) {
                    timestamp = parseInt(kot.created_date.$date.$numberLong);
                } else {
                    timestamp = kot.created_date.$date;
                }
            } else {
                timestamp = Date.now();
            }
            
            const kotDate = new Date(timestamp);
            const dateStr = kotDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const timeStr = kotDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
            const pax = kot.person_count || 0;
            const total = parseFloat(kot.sales_total || 0).toFixed(2);
            const items = kot.items || [];

            let itemsHtml = '';
            items.forEach((item, index) => {
                const itemName = item.sale_inline_item_name || item.item_name || 'Item';
                const itemQty = item.item_quantity || item.sale_inline_item_qty || item.quantity || 1;
                /*
                 * A cancelled line is struck through here too.
                 *
                 * Owner: "whenever order cancel or item cancel those line item
                 * name should be strick in the middle." The floor is where a
                 * waiter reads the ticket back to a table, so a dish that is
                 * off has to be visible without opening anything.
                 */
                const off = kotIsCancelled(kot) || itemIsCancelled(item) ? ' is-cancelled' : '';
                /* Escaped, both of them. A dish name comes from the shop's
                   own catalogue, but a note is free text somebody typed at a
                   table - an apostrophe in "don't" or a "<" for "less than
                   medium" would otherwise end the attribute or the tag. */
                const note = lineNote(item);
                itemsHtml += `
                    <div class="kot-item${off}">
                        <span class="item-index">${index + 1}.</span>
                        <span class="item-name" translate="no">${escapeFloor(itemName)}</span>
                        <span class="item-qty">x${itemQty}</span>
                        ${note ? `<span class="item-note" translate="no">${escapeFloor(note)}</span>` : ''}
                        ${window.FloorLineActions?.render(kot,item) || ''}
                    </div>
                `;
            });

            if (window.ServiceRounds && Array.isArray(kot.kitchen_rounds)) {
                itemsHtml = ServiceRounds.render(kot, !kotIsCancelled(kot));
            }

            kotsCardsHtml += `
                <div class="kot-card" data-payment-status="${escapeFloor(kot.payment_status || '')}">
                    <div class="kot-meta">
                        <div class="kot-meta-item">
                            <i class="fas fa-calendar"></i> ${dateStr} ${timeStr}
                        </div>
                        <div class="kot-meta-item">
                            <i class="fas fa-users" aria-hidden="true"></i> <span>Guests</span>: <span translate="no">${pax}</span>
                        </div>
                    </div>
                    <div class="kot-items-list">
                        ${itemsHtml}
                    </div>
                    ${window.OrderPhotos ? OrderPhotos.render(kot) : ""}
                    ${kot.preparation_note ? `<p class="item-note" translate="no">${escapeFloor(kot.preparation_note)}</p>` : ''}
                    <div class="kot-total">
                        <span>Total:</span>
                        <span class="total-amount">${CaptainMoney.html(total)}</span>
                    </div>
                    ${kot.payment_status === 'Paid' || kotIsCancelled(kot) ? '' : `<div class="kot-actions">
                        <button type="button" class="kot-action-btn" onclick="addItemsToOrder('${kot._id}')"><i class="fas fa-plus" aria-hidden="true"></i> Add items</button>
                        ${kot.preparation_notes ? `<button type="button" class="kot-action-btn" data-floor-order-note="${escapeFloor(kot._id)}">Kitchen note</button>` : ''}
                        ${!isTakeaway ? `<button type="button" class="kot-action-btn" data-floor-move-order="${escapeFloor(kot._id)}"><i class="fas fa-arrow-right-arrow-left" aria-hidden="true"></i> Move table</button>` : ''}
                        <button class="kot-action-btn btn-modify" onclick="modifyKot('${kot._id}')">
                            <i class="fas fa-edit"></i> Modify
                        </button>
                        <button class="kot-action-btn btn-cancel" onclick="cancelKot('${kot._id}')">
                            <i class="fas fa-times"></i> Cancel
                        </button>
                    </div>`}
                </div>
            `;
        });

        panelContent.innerHTML = headerHtml + `<div class="kot-cards-container">${kotsCardsHtml}</div>`;
        window.OrderPhotos?.mount(panelContent);
        if (!options.refresh) panelContent.scrollTop = 0;
        return true;
    } catch (error) {
        if (revision !== floorDetailRevision) return false;
        console.error('Error loading KOT details:', error);
        if (!options.refresh) panelContent.innerHTML = '<div class="empty-kot-message"><i class="fas fa-exclamation-circle"></i><p>Failed to load orders. Please try again.</p></div>';
        return false;
    } finally {
        if (revision === floorDetailRevision) {
            floorDetailLoading = false;
            hideSectionLoader('sliding-panel-content');
            window.dispatchEvent(new Event('captain:details'));
        }
    }
}

// Clear KOT details and remove active table selection
function clearKotSelection() {
    // Remove active class from all tables
    document.querySelectorAll('.kot-table-box').forEach(box => {
        box.classList.remove('active');
    });
    
    // Hide KOT details and show empty state
    const detailsSection = document.getElementById('kot-details');
    const emptyState = document.getElementById('empty-state');
    
    if (detailsSection) {
        detailsSection.style.display = 'none';
        detailsSection.innerHTML = '';
    }
    
    if (emptyState) {
        emptyState.style.display = 'flex';
    }
}

// Note: modifyKot function is now provided by order-history/script.js
// which is loaded after this script, so it will override this function
// and provide the Modify order panel

let cancelKotId = null;
let currentKotOrders = []; // Store current KOT orders

function cancelKot(kotId) {
    cancelKotId = kotId;
    const modalElement = document.getElementById('cancelOrderModal');
    if (modalElement && typeof bootstrap !== 'undefined') {
        const modal = new bootstrap.Modal(modalElement);
        modal.show();
    }
}

// Handle cancel confirmation
document.addEventListener('DOMContentLoaded', function() {
    const confirmBtn = document.getElementById('confirm-cancel-order');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', async function() {
            if (!cancelKotId) return;
            let cancellationConfirmed = false;
            
            try {
                /*
                 * The button says what it is doing, and the panel behind it
                 * stays readable.
                 *
                 * Cancelling used to white out the whole app while one request
                 * went to the till. The waiter is looking at the order they
                 * have just decided to cancel; taking it off the screen to say
                 * something is happening removes the only thing that would let
                 * them check they picked the right one.
                 */
                confirmBtn.disabled = true;
                confirmBtn.dataset.said = confirmBtn.textContent;
                confirmBtn.textContent = 'Cancelling...';
                showSectionLoader('sliding-panel-content');
                
                // Find the order from stored currentKotOrders
                const order = currentKotOrders.find(o => o._id === cancelKotId);
                
                if (!order) {
                    console.error('Order not found. cancelKotId:', cancelKotId);
                    console.error('Available orders:', currentKotOrders);
                    throw new Error('Order not found');
                }
                
                console.log('Cancelling order:', order);
                
                const result = await CaptainOrderActions.save( {
                    order_id: cancelKotId,
                    items: order.items,
                    total_amount: order.sales_total || order.total_amount,
                    status: 'cancelled'
                });
                console.log('Cancel response:', result);

                if (result.type !== 'success') {
                    throw new Error(result.message || 'Could not cancel the order');
                }
                cancellationConfirmed = true;
                
                // Close modal
                const modalElement = document.getElementById('cancelOrderModal');
                const modal = bootstrap.Modal.getInstance(modalElement);
                if (modal) modal.hide();
                
                // Close sliding panel
                closeSlidingPanel();
                
                // Clear KOT selection after successful cancellation
                clearKotSelection();
                
                // Show success message
                showToast('Order cancelled', 'success');
                
                // Refresh only the tables list
                setTimeout(async () => {
                    try { await loadTables(); }
                    catch (error) { console.error('Could not refresh tables after cancellation:', error); }
                }, 500);
                
            } catch (error) {
                console.error('Error cancelling order:', error);
                showToast(cancellationConfirmed ? 'Order cancelled' : (error.message || 'Could not cancel the order'),
                    cancellationConfirmed ? 'success' : 'error');
            } finally {
                /* Whatever happened, the button goes back to being a button.
                   A confirm dialog left saying "Cancelling..." for ever is a
                   waiter who cannot try again and cannot tell why. */
                hideSectionLoader('sliding-panel-content');
                confirmBtn.disabled = false;
                if (confirmBtn.dataset.said) confirmBtn.textContent = confirmBtn.dataset.said;
                if (cancellationConfirmed) cancelKotId = null;
            }
        });
    }
});

function showToast(message, type = 'success') {
    const toast = document.getElementById('order-toast');
    const toastMessage = document.getElementById('order-toast-message');
    
    if (!toast || !toastMessage) return;
    
    toastMessage.textContent = message;
    toast.className = `order-toast order-toast-${type}`;
    toast.style.display = 'block';
    
    setTimeout(() => {
        toast.style.display = 'none';
    }, 3000);
}

window.addEventListener('posnic:orders-sent', () => {
    loadTables().catch(() => {});
});

function applyDiscount(kotId) {
    window.location.href = `discount.html?kot=${kotId}`;
}

/*
 * Fetched, then handed to a window, rather than opened by URL.
 *
 * The print route needs the same credential as everything else, and a browser
 * sends no Authorization header on a plain window.open. The alternative the
 * server does support is a token in the query string, which puts a live
 * credential into history and into every proxy log it passes. Not worth it for
 * one receipt.
 */
async function printSale(kotId) {
    try {
        const response = await POSNIC.api.raw(`/sales/${kotId}/print`);
        const html = await response.text();
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            showToast('Allow pop-ups to print this receipt');
            return;
        }
        printWindow.document.write(html);
        printWindow.document.close();
    } catch (error) {
        console.error('Print failed:', error);
        showToast(error.message || 'Could not load the receipt');
    }
}

function printKot(kotId) {
    console.log('Print KOT:', kotId);
}

function settleKot(kotId) {
    window.location.href = `products.html?settle=${kotId}`;
}

function showTableDetails(tableValue) {
    const emptyState = document.getElementById('empty-state');
    const kotDetails = document.getElementById('kot-details');
    
    if (emptyState) emptyState.style.display = 'none';
    if (kotDetails) {
        kotDetails.style.display = 'block';
        kotDetails.innerHTML = `
            <div class="kot-section-title">Table ${tableValue}</div>
            <div style="flex: 1; display: flex; align-items: center; justify-content: center; text-align: center; color: #9ca3af;">
                <div>
                    <i class="fas fa-clipboard-list" style="font-size: 48px; margin-bottom: 12px; color: #374151;"></i>
                    <p style="font-size: 14px;">No active orders for this table</p>
                    <p style="font-size: 13px; margin-top: 8px;">Click <strong style="color: #10b981;">+ Add KOT</strong> to create a new order</p>
                </div>
            </div>
        `;
    }
}

let _kotTablePollInterval = null;

function startKotTablePolling() {
    if (_kotTablePollInterval) return;
    _kotTablePollInterval = setInterval(async () => {
        const panel = document.getElementById('kot-sliding-panel');
        if (panel && panel.classList.contains('open')) return; // skip when panel is open
        await loadTables();
    }, 10000);
}

function stopKotTablePolling() {
    if (_kotTablePollInterval) {
        clearInterval(_kotTablePollInterval);
        _kotTablePollInterval = null;
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopKotTablePolling();
    } else {
        startKotTablePolling();
        // Reads wait for secure-session restoration before contacting the till.
        void loadTables().catch(() => {});
    }
});

window.addEventListener('beforeunload', stopKotTablePolling);

document.addEventListener('DOMContentLoaded', async () => {
    let activeBranch = localStorage.getItem('kiosk_selected_branch') || localStorage.getItem('branch_id');
    if (!activeBranch) {
        // checkBranchAndRedirect may not have finished yet — check IndexedDB directly
        try {
            const branches = await getData(BRANCH_STORE);
            if (branches && branches.length > 0) {
                activeBranch = branches[0].id;
                localStorage.setItem('kiosk_selected_branch', branches[0].id);
                if (branches[0].branch_id) localStorage.setItem('branch_id', branches[0].branch_id);
            }
        } catch (e) { /* ignore */ }
    }
    if (!activeBranch) {
        localStorage.removeItem('kiosk_selected_branch');
        localStorage.removeItem('branch_id');
        window.location.href = 'index.html';
        return;
    }

    // Check branch count and update button
    await checkBranchCount();

    /*
     * THE TABLES LOAD WHERE THE TABLES ARE.
     *
     * Owner: "when table loads or when canceling after clicking yes something
     * waiting for api then show some progress bar. or loading as that
     * component. instead of hiding whole app."
     *
     * showLoader() paints a white sheet over the entire screen, so waiting for
     * one list took the header, the buttons and everything else with it - and
     * on a slow shop Wi-Fi that reads as an app that has crashed rather than
     * one that is fetching a list.
     *
     * loadTables already draws a loader inside #tables-list. This was putting
     * a second one over the top of it.
     */
    await loadTables();

    startKotTablePolling();
});

/* ==================================================================
 * BEING HOME
 * ==================================================================
 *
 * Owner, relaying a client: "due to empty stuff, he try to go back and close
 * the app. i tink he dont have feeling he is in main page dashboard. add some
 * welcome text and few other stuff make him feel he is in dashboard and
 * already in home."
 *
 * A quiet morning drew this screen as the word "Tables" over an empty box.
 * Nothing named the shop, greeted anybody or suggested this was where you were
 * supposed to have arrived - so it read as a screen that had failed to load,
 * and the way out of a screen that has failed to load is the back button.
 *
 * Two lines fix that, and neither is decoration: the greeting says the app is
 * working and knows what time it is, and the branch name says WHICH SHOP this
 * phone is pointed at - which on an estate of handsets is a real question and
 * has been answered nowhere else on this screen.
 */

/** Morning, afternoon or evening, as a person would say it. */
function timeOfDay(now) {
    const hour = (now || new Date()).getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
}

/**
 * The branch this handset is working in.
 *
 * The list and the choice are stored separately - the list came from sign-in,
 * the choice from the branch picker - so the name has to be looked up rather
 * than read. A shop with one branch never saw the picker, so the single entry
 * IS the answer there.
 */
function branchName() {
    try {
        const branches = JSON.parse(localStorage.getItem('kiosk_branch_list') || '[]') || [];
        if (!branches.length) return '';
        const chosen = localStorage.getItem('kiosk_selected_branch');
        const match = branches.find(
            (b) => String(b.store_id) === String(chosen) || String(b.branch_id) === String(chosen)
        );
        return (match || branches[0]).branch_name || '';
    } catch (e) {
        /* A handset mid-setup has no list yet. The greeting still stands. */
        return '';
    }
}

function sayWhereWeAre() {
    const hello = document.getElementById('floor-hello');
    const shop = document.getElementById('floor-shop');
    if (hello) hello.textContent = timeOfDay();

    const name = branchName();
    /* "Your shop" rather than a blank line while the name is unknown: an empty
       heading reopens the hole this was written to close. */
    if (shop) {
        shop.setAttribute('translate', name ? 'no' : 'yes');
        shop.textContent = name || 'Your shop';
    }
}

document.addEventListener('DOMContentLoaded', sayWhereWeAre);

window.addEventListener('captain:back', event => {
    if (event.defaultPrevented || document.querySelector('.modal.show, dialog[open], #posnic-lock.is-open')) return;
    if (document.getElementById('kot-sliding-panel')?.classList.contains('open')) {
        event.preventDefault();
        closeSlidingPanel();
    }
});

window.addEventListener('captain:payment-recorded', event => {
    if (event.detail?.completed) { closeSlidingPanel(); showToast(event.detail.message); }
    loadTables();
});
const captainPaymentButtons = new MutationObserver(() => {
    const button = document.querySelector('[data-collect-table][hidden]:not([data-payment-checked])');
    if (!button || !window.CaptainPayments) return;
    button.dataset.paymentChecked='true';
    CaptainPayments.available({saleId:button.dataset.saleId}).then(enabled => { if (button.isConnected) button.hidden=!enabled; });
    const takeawayActions = button.closest('[data-takeaway-billing]');
    if (takeawayActions) POSNIC.api.get('/captain/v1/payment-options').then(options => {
        if (takeawayActions.isConnected) takeawayActions.hidden = options.takeawayPayments !== true;
    }).catch(() => {});
});
captainPaymentButtons.observe(document.body,{childList:true,subtree:true});

window.FloorMobileDetails = {
    root: () => document.querySelector('#kot-sliding-panel.open'),
    header: '.sliding-panel-header', body: '#sliding-panel-content',
    current: () => floorDetail?.saleId || floorDetail?.id,
    entries: () => [...document.querySelectorAll('#tables-list .floor-card:not([data-awaiting-close])')].map(card => ({id:card.dataset.saleId || card.dataset.tableNumber, label:card.dataset.tableNumber, saleId:card.dataset.saleId, takeaway:card.dataset.takeaway === 'true'})),
    busy: () => floorDetailLoading || !!document.querySelector('[data-serving="true"]'),
    show: entry => selectTable(entry.label, entry.takeaway, {saleId:entry.saleId}),
    refresh: () => floorDetail && selectTable(floorDetail.id, floorDetail.takeaway, {refresh:true, saleId:floorDetail.saleId}),
    dismiss: closeSlidingPanel,
};
