// assets/order-history/script.js - Updated for Two-Screen Flow
let allOrders = [];
let filteredOrders = [];
let currentFilter = 'all';
let selectedTable = null; // Track selected table for screen 2
let currentTableFilter = localStorage.getItem('order_history_table_filter') || 'all';
// Set filters to collapsed by default
let tableFiltersExpanded = false;
let currentOrderId = null;
let editingOrder = null;
let pendingCancelOrderId = null;
let currentEditingItemIndex = null;

let _orderHistoryPollInterval = null;

function startOrderHistoryPolling() {
    if (_orderHistoryPollInterval) return;
    _orderHistoryPollInterval = setInterval(() => {
        if (document.hidden || !document.getElementById('order-list-screen')) return;
        if (document.querySelector('#orderDetailsModal.show') || editingOrder) return;
        loadOrderHistory();
    }, 10000);
}

function stopOrderHistoryPolling() {
    if (_orderHistoryPollInterval) {
        clearInterval(_orderHistoryPollInterval);
        _orderHistoryPollInterval = null;
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopOrderHistoryPolling();
    } else {
        startOrderHistoryPolling();
    }
});

window.addEventListener('beforeunload', stopOrderHistoryPolling);

// Initialize page
document.addEventListener('DOMContentLoaded', function () {
    /* The server is already chosen synchronously by config.js; there is
       nothing left to wait for before the first request. */
    // The floor also loads this script for ticket editing, without a history
    // screen. Do not fetch hidden history or show its errors over the floor.
    if (document.getElementById('table-selection-screen')) loadOrderHistory();
    setupEventListeners();
    if (document.getElementById("table-selection-screen")) showOrderListScreen("all");
    restoreTableFilterState(); // Set filters to collapsed by default
    startOrderHistoryPolling();
});

// Screen Navigation Functions
function showTableSelectionScreen() {
    const sel = document.getElementById('table-selection-screen');
    const list = document.getElementById('order-list-screen');
    if (!sel || !list) return;
    sel.style.display = 'flex';
    list.style.display = 'none';
    const headerElement = document.getElementById('header-title');
    if (headerElement) {
        headerElement.textContent = window.I18N?.t('Select Table') || 'Select Table';
    }
    document.getElementById('refresh-btn').style.display = 'block';
    selectedTable = null;
}

function showOrderListScreen(tableNumber) {
    selectedTable = tableNumber;
    document.getElementById('table-selection-screen').style.display = 'none';
    document.getElementById('order-list-screen').style.display = 'flex';

    // Set header title based on table type
    let headerTitle;
    if (tableNumber === 'all') {
        headerTitle = 'All Orders';
    } else if (tableNumber === 'TA') {
        headerTitle = 'Takeaway';
    } else {
        headerTitle = `Table ${tableNumber}`;
    }
    const headerElement = document.getElementById('header-title');
    if (headerElement) {
        headerElement.textContent = window.I18N?.t(headerTitle) || headerTitle;
    }

    document.getElementById('refresh-btn').style.display = 'block';
    filterOrdersBySelectedTable();
}

function handleBackButton() {
    if (selectedTable === 'all') location.href = 'kot-management.html';
    else showOrderListScreen('all');
}

function goBack() {
    window.history.back();
}

// Generate Table Selection Cards
function generateTableCards() {
    const tableGrid = document.getElementById('table-grid');
    if (!tableGrid) return;

    // Get unique tables from orders
    const tableCounts = {};
    const pendingCounts = {};

    allOrders.forEach(order => {
        let table;
        // Check if it's a takeaway order
        if (order.dine_type === 'Take away' || order.dine_type === 'Takeaway') {
            table = 'TA';
        } else {
            table = order.table_number || 'Unknown';
        }
        tableCounts[table] = (tableCounts[table] || 0) + 1;
        if (order.status === 'pending') {
            pendingCounts[table] = (pendingCounts[table] || 0) + 1;
        }
    });

    // Sort tables: TA first, then numeric tables, then others
    const tables = Object.keys(tableCounts).sort((a, b) => {
        if (a === 'TA') return -1;
        if (b === 'TA') return 1;
        const numA = parseInt(a);
        const numB = parseInt(b);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return a.localeCompare(b);
    });

    let html = '';

    // All Tables Card
    const totalOrders = allOrders.length;
    const totalPending = allOrders.filter(o => o.status === 'pending').length;
    html += `
        <div class="table-card all-tables" onclick="showOrderListScreen('all')">
            <div class="table-icon">
                <i class="fas fa-th"></i>
            </div>
            <div class="table-name">All Tables</div>
            <div class="order-count ${totalPending > 0 ? 'has-pending' : ''}">
                ${totalOrders} order${totalOrders !== 1 ? 's' : ''}
            </div>
        </div>
    `;

    // Individual Table Cards
    tables.forEach(table => {
        const count = tableCounts[table];
        const pending = pendingCounts[table] || 0;
        const displayName = table === 'TA' ? 'Takeaway' : `Table ${table}`;
        const icon = table === 'TA' ? 'fa-shopping-bag' : 'fa-utensils';
        html += `
            <div class="table-card" onclick="showOrderListScreen('${table}')">
                <div class="table-icon">
                    <i class="fas ${icon}"></i>
                </div>
                <div class="table-name">${displayName}</div>
                <div class="order-count ${pending > 0 ? 'has-pending' : count === 0 ? 'no-orders' : ''}">
                    ${count} order${count !== 1 ? 's' : ''}
                </div>
            </div>
        `;
    });

    tableGrid.innerHTML = html;
}

// Filter orders by selected table
function filterOrdersBySelectedTable() {
    const search = String(document.getElementById('order-search')?.value || '').trim().toLocaleLowerCase();
    filteredOrders = allOrders.filter(order => {
        const table = String(order.table_number || '');
        const takeaway = ['Take away','Takeaway'].includes(order.dine_type);
        const chosen = selectedTable && selectedTable !== 'all' ? selectedTable : currentTableFilter;
        const matchesTable = chosen === 'all' || !chosen || (chosen === 'TA' ? takeaway : table === String(chosen));
        const matchesSearch = !search || [order.order_id, table, order.customer_name].some(value => String(value || '').toLocaleLowerCase().includes(search));
        return matchesTable && matchesSearch && (currentFilter === 'all' || order.status === currentFilter);
    });
    renderOrders();
}

// Setup event listeners
function setupEventListeners() {
    const searchInput = document.getElementById('order-search');
    if (searchInput) {
        searchInput.addEventListener('input', filterOrders);
    }

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            currentFilter = this.dataset.status;
            filterOrdersBySelectedTable();
            loadOrderHistory({background:true});
        });
    });

    const productSearch = document.getElementById('product-search');
    if (productSearch) {
        productSearch.addEventListener('input', function () {
            searchProducts(this.value);
        });
    }

    const saveBtn = document.getElementById('save-order-changes');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveOrderChanges);
    }

    const editBtn = document.getElementById('edit-order-btn');
    if (editBtn) {
        editBtn.addEventListener('click', openEditOrderModal);
    }



    const confirmCancelBtn = document.getElementById('confirm-cancel-order-btn');
    if (confirmCancelBtn) {
        confirmCancelBtn.addEventListener('click', async function () {
            if (!pendingCancelOrderId || confirmCancelBtn.disabled) return;
            const reasonField = document.getElementById('history-cancel-reason');
            reasonField.value = reasonField.value.trim();
            if (!reasonField.reportValidity()) return;
            const id = pendingCancelOrderId;
            confirmCancelBtn.disabled = true;
            let cancelled;
            try { cancelled = await performCancelOrder(id, reasonField.value); }
            finally { confirmCancelBtn.disabled = false; }
            if (!cancelled) return;
            pendingCancelOrderId = null;
            // close modal
            const modalEl = document.getElementById('cancelConfirmModal');
            if (modalEl && typeof bootstrap !== 'undefined') {
                const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
                modal.hide();
            }
        });
    }

    const confirmRemoveBtn = document.getElementById('confirm-remove-item-btn');
    if (confirmRemoveBtn) {
        confirmRemoveBtn.addEventListener('click', function () {
            confirmRemoveItem();
        });
    }

    const removeItemModal = document.getElementById('removeItemConfirmModal');
    if (removeItemModal) {
        removeItemModal.addEventListener('hidden.bs.modal', function () {
            const editModal = document.getElementById('editOrderModal');
            if (editModal) {
                editModal.classList.remove('modal-behind');
                if (window.InlineOrderEditor?.active && !window.OrderEditor?.dirty()) void window.OrderEditor.cancel();
            }
        });
    }

    const cancelBtn = document.getElementById('cancel-order-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
            if (currentOrderId) {
                cancelOrder(currentOrderId);
            }
        });
    }

    const tableFilterToggle = document.getElementById('table-filter-toggle');
    if (tableFilterToggle) {
        tableFilterToggle.addEventListener('click', toggleTableFilters);
    }
}

// Load order history from real API
let historyRequest = null, historyRequestFilter = null, historyRevision = 0, historyLoaded = false;
function loadOrderHistory(options = {}) {
    if (historyRequest && historyRequestFilter === currentFilter) return historyRequest;
    historyRequestFilter = currentFilter;
    const revision = ++historyRevision;
    const request = loadOrderHistoryNow(options, revision).finally(() => {
        if (historyRequest === request) historyRequest = null;
    });
    historyRequest = request;
    return request;
}
async function loadOrderHistoryNow(options, revision) {
    if (!historyLoaded && !options.background) showLoader();

    try {
        let branchId = localStorage.getItem('branch_id');
        if (!branchId) {
            // checkBranchAndRedirect may not have finished yet — read IndexedDB directly
            try {
                const branches = await getData(BRANCH_STORE);
                if (branches && branches.length > 0) {
                    branchId = branches[0].branch_id || branches[0].id;
                    localStorage.setItem('branch_id', branchId);
                }
            } catch (e) { /* ignore */ }
        }
        if (!branchId) {
            hideLoader();
            return; // no session yet — kot/script.js will redirect to index.html
        }
        const userId = localStorage.getItem('user_id');

        const data = await POSNIC.api.post('/sales/getOrderHistory', {
            branch_id: branchId,
            user_id: userId,
            limit: 50,
            page: 1,
            status: currentFilter === 'all' ? null : currentFilter
        });

        if (revision !== historyRevision) return false;
        if (data.type === 'success') {
            historyLoaded = true;
            allOrders = data.data.orders || [];
            if(allOrders.length) void refreshMergePermission(revision);
            generateTableCards(); // Generate table selection cards
            if (selectedTable !== null) {
                // If on order list screen, filter by selected table
                filterOrdersBySelectedTable();
            }
        } else {
            throw new Error(data.message || 'Failed to load orders');
        }
        return true;
    } catch (error) {
        if (revision !== historyRevision) return false;
        console.error('Error loading order history:', error);
        // A failed refresh says nothing about which orders still exist.
        if (!options.background) showToast('Could not load the order history: ' + error.message, 'error');
        return false;
    } finally {
        hideLoader();
    }
}

// Search products from IndexedDB (no auth, no network, always available)
async function searchProducts(query) {
    const container = document.getElementById('product-suggestions');
    if (!container) return;

    if (!query || query.length < 1) {
        container.innerHTML = '';
        return;
    }

    try {
        const allProducts = await getData(STORE_NAME);

        /*
         * THE SAME SEARCH THE MENU USES, not a second one.
         *
         * This was `name.toLowerCase().includes(q)` with a two-character
         * minimum - the exact substring test the menu screen was rebuilt to
         * get away from. It finds Chicken Biryani from "biry" and from nothing
         * else: not from "cb", which is what somebody selling two hundred a
         * day types, and not from "chick biry", because two words are never
         * one substring.
         *
         * So a waiter who had learned to type "cb" on the menu got nothing
         * here, on the screen where they are already in a hurry because a
         * table is waiting on a correction. Two searches in one app that
         * answer differently is worse than one that is merely blunt.
         */
        const matched = (typeof ItemSearch !== 'undefined'
            ? ItemSearch.search(ItemSearch.index(allProducts), query, { numbers: true })
            : allProducts.filter(p => p.name && p.name.toLowerCase().includes(query.toLowerCase())))
            .slice(0, 10)
            .map(p => ({
                _id: p.id,
                name: p.name,
                selling_price: p.selling_price ?? p.subtotal ?? p.price ?? 0,
                final_price: p.final_price,
                available_quantity: p.available_quantity || 0
            }));

        if (matched.length > 0) {
            renderProductSuggestions(matched);
        } else {
            container.innerHTML = '<div class="p-2 text-muted">No products found</div>';
        }
    } catch (error) {
        console.error('Error searching products:', error);
        container.innerHTML = '<div class="p-2 text-danger">Error searching products</div>';
    }
}

// Store products for reference when adding to order
let searchedProducts = {};

// Render product suggestions
function renderProductSuggestions(products) {
    const container = document.getElementById('product-suggestions');

    const suggestionsHtml = products.map(product => {
        // Store product data for later reference
        searchedProducts[product._id] = product;

        // Use selling_price for display and adding to order
        const sellingPrice = product.selling_price || product.price;

        return `
        <div class="product-suggestion" onclick="addProductToOrderById('${product._id}')">
            <div class="product-info">
                <h6>${product.name}</h6>
                <p class="product-price">${CaptainMoney.html(sellingPrice)}</p>
                <small class="text-muted">Available: ${product.available_quantity}</small>
            </div>
            <button class="add-product-btn">
                <i class="fas fa-plus"></i>
            </button>
        </div>
    `;
    }).join('');

    container.innerHTML = suggestionsHtml;
}

// All repeat paths share the same unsent, unannotated serving. Sent lines
// keep their identity and notes; annotated drafts remain separate preparations.
function addDraftServing(source) {
    const productId = source.product_id || source.item_id || source.id;
    const price = Number(source.price ?? source.selling_price ?? 0);
    const existing = editingOrder.items.find(item => window.OrderEditor?.isAdded(item)
        && String(item.product_id || item.item_id || item.id) === String(productId)
        && Number(item.price) === price
        && !String(item.item_description || item.item_note || item.notes || '').trim()
        && !item.seat && !item.course && !item.held && !(item.allergies || []).length
        && !item.allergy_note && !(item.modifiers || []).length
        && !lineIsCancelled(item, editingOrder));
    if (existing) { existing.quantity = Number(existing.quantity) + 1; window.InlineOrderEditor?.reveal(floorLineKey(existing)); return existing; }
    const fresh = {
        product_id: productId, line_id: crypto.randomUUID(), name: source.name || source.item_name,
        price, selling_price: Number(source.selling_price ?? price), quantity: 1,
        item_description: '', item_note: '', notes: ''
    };
    editingOrder.items.push(fresh);
    window.InlineOrderEditor?.reveal(floorLineKey(fresh));
    return fresh;
}

// Add product to order by ID (retrieves from searchedProducts)
function addProductToOrderById(productId) {
    const product = searchedProducts[productId];
    if (!product) {
        console.error('Product not found:', productId);
        return;
    }

    const sellingPrice = product.selling_price || product.price;
    addProductToOrder(productId, product.name, sellingPrice);
}

// Save order changes to real API
let savingOrderChanges = false;
async function saveOrderChanges() {
    if (!editingOrder || !currentOrderId || savingOrderChanges) return;

    showLoader();
    const discountValue = parseFloat(
        document.getElementById('edit-discount-value').value || 0
    );
    const discountType = document.querySelector(
        'input[name="edit_discount_type"]:checked'
    )?.value || 'percent';

    const desc = document.getElementById('edit-discount-description').value.trim();

    const order = allOrders.find(o => o._id === currentOrderId) || {};
    const priorType = ['amount', 'price', 'fixed'].includes(String(order.extra_discount_type || '').toLowerCase()) ? 'amount' : 'percent';
    const priorValue = Number(order.extra_discount || 0);
    // Hidden discount controls must not replace a bill discount during an item edit.
    const discountChanged = discountValue !== priorValue || (discountValue !== 0 && discountType !== priorType);
    const preserveAllocation = order.transfer_allocated === true && !discountChanged;
    const extraType = preserveAllocation ? null : discountType;
    const extraVal = preserveAllocation ? null : discountValue;
    const dineTypeRadio = document.querySelector('input[name="edit_dine_type"]:checked');
    const dineType = dineTypeRadio ? dineTypeRadio.value : (order.dine_type || 'Dine-in');
    const tableRadio = document.querySelector('input[name="edit_table_no"]:checked');

    let newTableNo = order.table_number || order.kiosk_table_no || '';
    let newTableId = order.table_id || order.kiosk_table_id || '';

    if (tableRadio) {
        if (tableRadio.id === 'edit_table_manual_radio') {
            const manualInput = document.getElementById('edit_manual_table_input');
            const manualVal = manualInput ? manualInput.value.trim().toUpperCase() : '';

            // validation: required + only A–Z,0–9 + max 6
            const isValid = /^[A-Z0-9]{1,6}$/.test(manualVal);

            if (!isValid && dineType === 'Dine-in') {
                hideLoader();
                showToast('Table must be 1–6 letters/numbers (A–Z, 0–9).', 'error');
                if (manualInput) {
                    manualInput.focus();
                    manualInput.select();
                }
                return;
            }

            newTableNo = manualVal;
            newTableId = '';
        } else {
            newTableNo = tableRadio.value;
            newTableId = tableRadio.dataset.id || '';
        }
    } else {
        // Only validate table selection for Dine-in mode
        if (dineType === 'Dine-in' && !newTableNo) {
            hideLoader();
            showToast('Choose a table first.', 'error');
            return;
        }
        // For Takeaway, clear table values if not selected
        if (dineType === 'Take away') {
            newTableNo = '';
            newTableId = '';
        }
    }
    // Takeaway must never retain the hidden selection of its former table.
    if (dineType === 'Take away') { newTableNo = ''; newTableId = ''; }
    savingOrderChanges = true;
    window.OrderEditor?.setSaving(true);
    try {
        const lines = linesForSave(editingOrder.items);
        if (lines.length === 0) {
            /*
             * Every dish struck off. The till reads an order by the lines it
             * still has, so an empty list is not "cancel everything" to it -
             * it is a request with nothing in it, and it is refused. Cancelling
             * the ORDER is the thing the waiter means, and it is one button
             * away, so say that rather than showing them a server error.
             */
            hideLoader();
            showToast('Nothing left on this order. Use Cancel order instead.', 'error');
            return;
        }

        const data = await CaptainOrderActions.save( {
                order_id: currentOrderId,
                items: lines,
                ...(editingOrder.items.some(item => item.cancelled_quantity > 0 && item.cancellation_reason) ? {change_reason: editingOrder.items.filter(item => item.cancelled_quantity > 0 && item.cancellation_reason).map(item => item.cancellation_reason).join('; ').slice(0,200)} : {}),
                total_amount: editingOrder.total_amount,
                extra_discount_type: extraType,
                extra_discount: extraVal,
                discount_description: desc,
                ...(editingOrder.preparation_notes ? {preparation_note:editingOrder.preparation_note || ''} : {}),
                table_number: newTableNo,
                table_id: newTableId,
                dine_type: dineType,
                person_count: dineType === 'Dine-in' ? (editingOrder.person_count || 1) : '',
                seen_at: orderSeenAt(editingOrder)
        });

        if (data.type === 'success') {
            window.CaptainKitchenFeedback?.play();
            showToast(data.message || 'Order updated', 'success');
            window.OrderEditor?.saved();
            const inlineSave = window.InlineOrderEditor?.active === true;
            if (inlineSave) window.InlineOrderEditor.restore();

            // Close modal
            const modalElement = document.getElementById('editOrderModal');
            if (modalElement && typeof bootstrap !== 'undefined') {
                const modal = bootstrap.Modal.getInstance(modalElement);
                if (modal) modal.hide();
            }

            // Check if we're on KOT management page
            const isKotPage = window.location.pathname.includes('kot-management.html');

            if (isKotPage && inlineSave) {
                await loadOrderHistory();
                if (floorDetail) await selectTable(floorDetail.id, floorDetail.takeaway, {saleId:floorDetail.saleId,refresh:true});
            } else if (isKotPage) {
                // Close sliding panel
                if (typeof closeSlidingPanel === 'function') {
                    closeSlidingPanel();
                }

                // Clear KOT selection after successful save
                if (typeof clearKotSelection === 'function') {
                    clearKotSelection();
                }

                // Refresh tables list on KOT page
                if (typeof loadTables === 'function') {
                    setTimeout(async () => {
                        await loadTables();
                    }, 500);
                }

                // Also reload order history so allOrders has fresh data
                await loadOrderHistory();
            } else {
                // Re-load from API for order history page
                await loadOrderHistory();
            }
        } else {
            throw new Error(data.message || 'Failed to update order');
        }
    } catch (error) {
        console.error('Error saving order changes:', error);
        /* Out of date rather than broken. The waiter is shown the order as it
           is now, and nothing they did has been lost: it was never sent. */
        if (isAConflict(error)) {
            await tellThemSomebodyElseGotThere();
            return;
        }

        showToast('Could not update the order: ' + error.message, 'error');
    } finally {
        savingOrderChanges = false;
        window.OrderEditor?.setSaving(false);
        hideLoader();
    }
}

// Filter orders
function filterOrders() { filterOrdersBySelectedTable(); }

// Generate dynamic table filter buttons
function generateTableFilterButtons() {
    const container = document.getElementById('table-filter-buttons');
    if (!container) return;

    // Collect unique table numbers
    const uniqueTables = {};
    allOrders.forEach(order => {
        const tableNum = order.table_number ? order.table_number.toString() : '';
        if (tableNum && tableNum !== '') {
            uniqueTables[tableNum] = true;
        }
    });

    // Keep the "All" button, remove other dynamic buttons
    const allBtn = container.querySelector('button[data-table="all"]');
    container.innerHTML = '';
    if (allBtn) {
        container.appendChild(allBtn);
    }

    // Sort table numbers
    const tableNumbers = Object.keys(uniqueTables).sort((a, b) => {
        const numA = parseInt(a) || 0;
        const numB = parseInt(b) || 0;
        return numA - numB;
    });

    // Add button for each table
    tableNumbers.forEach(tableNum => {
        const btn = document.createElement('button');
        btn.className = 'table-filter-btn';
        btn.setAttribute('data-table', tableNum);
        btn.textContent = 'Table ' + tableNum;
        btn.onclick = () => filterByTable(tableNum);
        container.appendChild(btn);
    });

    // Restore active state
    updateTableFilterButtonStates();

    // Restore collapse state
    restoreTableFilterState();
}

// Filter by table
function filterByTable(tableNumber) {
    currentTableFilter = tableNumber;
    localStorage.setItem('order_history_table_filter', tableNumber);
    updateTableFilterButtonStates();
    filterOrders();
}

// Update table filter button states
function updateTableFilterButtonStates() {
    const buttons = document.querySelectorAll('.table-filter-btn');
    buttons.forEach(btn => {
        if (btn.getAttribute('data-table') === currentTableFilter) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// Toggle table filters expand/collapse
function toggleTableFilters() {
    const container = document.getElementById('all-filters-container');
    const arrow = document.getElementById('table-filter-arrow');

    if (!container || !arrow) return;

    tableFiltersExpanded = !tableFiltersExpanded;

    if (tableFiltersExpanded) {
        container.classList.remove('collapsed');
        arrow.classList.remove('rotated');
    } else {
        container.classList.add('collapsed');
        arrow.classList.add('rotated');
    }

    // Save state to localStorage
    localStorage.setItem('table_filters_expanded', tableFiltersExpanded);
}

// Restore table filter collapse state
function restoreTableFilterState() {
    const container = document.getElementById('all-filters-container');
    const arrow = document.getElementById('table-filter-arrow');

    if (!container || !arrow) return;

    if (!tableFiltersExpanded) {
        container.classList.add('collapsed');
        arrow.classList.add('rotated');
    } else {
        container.classList.remove('collapsed');
        arrow.classList.remove('rotated');
    }
}

// Render orders
function renderOrders() {
    const safe = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const container = document.getElementById('orders-list');
    const emptyState = document.getElementById('empty-state');

    if (!container) return;

    if (filteredOrders.length === 0) {
        container.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    const ordersHtml = filteredOrders.map(order => `
    <div class="order-card ${order.status === 'cancelled' ? 'order-card-cancelled' : ''}"
         data-order-id="${safe(order._id)}">
            <button type="button" class="order-open" data-view-order="${safe(order._id)}">
            <div class="order-header">
                <div class="order-info">
                    <h5>#${safe(order.order_id || order._id)}</h5>
                                        <span class="table-number">
                        <span>Table</span> <bdi translate="no">${safe(order.table_number)}</bdi>
                        · <span>${safe(order.dine_type || 'Dine-in')}</span>
                        ${order.person_count ? ` · <bdi translate="no">${safe(order.person_count)}</bdi> <span>Guests</span>` : ''}
                    </span>
                </div>
                <div class="order-status">
                    <span class="status-badge status-${safe(order.status)}">${safe(order.status)}</span>
                </div>
            </div>
            <div class="order-details">
                <div class="order-meta">
                    <span class="order-time">
                        <i class="fas fa-clock"></i>
                        ${formatDateTime(order.created_at || order.created_date)}
                    </span>
                    <span class="order-total">
                        ${CaptainMoney.html(order.total_amount)}
                    </span>
                </div>
                <div class="order-items-preview">
                    ${(order.items || []).slice(0, 2).map(item =>
        `<span class="item-preview${struck(item, order)}">${safe(item.quantity)}x ${safe(item.name)}</span>`
    ).join(', ')}
                    ${(order.items || []).length > 2 ? `... +${(order.items || []).length - 2} more` : ''}
                </div>
            </div>
            </button>
            ${order.status === 'cancelled' || order.status === 'completed' ? '' : `
        <details class="order-actions-menu"><summary>Order options</summary><div class="order-actions">
            <button class="action-btn edit-btn" data-edit-order="${safe(order._id)}">
                <i class="fas fa-edit"></i> Modify
            </button>
            ${(order.dine_type || 'Dine-in') === 'Dine-in' ? `
            <button class="action-btn move-btn" data-move-order="${safe(order._id)}">
                <i class="fas fa-right-left"></i> Move table
            </button>` : ''}
            ${canMergeOrders() && (order.seating_request_id || (mergePermission.legacy && tableOf(order) && order.dine_type !== 'Take away')) ? `<button class="action-btn move-btn" data-merge-order="${safe(order._id)}">${window.I18N?.t('Merge orders') || 'Merge orders'}</button>` : ''}
            <button class="action-btn cancel-btn" data-cancel-order="${safe(order._id)}">
                <i class="fas fa-times"></i> Cancel order
            </button>
        </div></details>
        `}
    </div>
`).join('');

    container.innerHTML = ordersHtml;
}

document.addEventListener('click', event => {
    const button=event.target.closest('[data-view-order],[data-edit-order],[data-move-order],[data-merge-order],[data-cancel-order]');
    if (!button) return;
    if (button.dataset.viewOrder) viewOrderDetails(button.dataset.viewOrder);
    if (button.dataset.editOrder) editOrder(button.dataset.editOrder);
    if (button.dataset.moveOrder) moveOrder(button.dataset.moveOrder);
    if (button.dataset.mergeOrder) moveOrder(button.dataset.mergeOrder, "merge");
    if (button.dataset.cancelOrder) cancelOrder(button.dataset.cancelOrder);
});

// View order details
function viewOrderDetails(orderId) {
    currentOrderId = orderId;
    const order = allOrders.find(o => o._id === orderId);

    if (!order) return;

    // Calculate totals
    const subtotal = order.subtotal || (order.items || []).reduce((sum, item) => sum + (parseFloat(item.price || 0) * parseInt(item.quantity || 0)), 0);

    // Sum up tax and discount from items if available
    const itemsTax = (order.items || []).reduce((sum, item) => sum + (parseFloat(item.tax_price || 0) * parseInt(item.quantity || 0)), 0);
    const itemsDiscount = (order.items || []).reduce((sum, item) => sum + (parseFloat(item.discount_price || 0) * parseInt(item.quantity || 0)), 0);

    let tax = order.tax || order.tax_amount || order.total_tax || itemsTax || 0;
    let discount = order.discount || order.discount_amount || order.total_discount || itemsDiscount || 0;

    // Fallback for extra_discount if discount is still 0
    if (!discount && order.extra_discount > 0) {
        if (order.extra_discount_type === 'amount') {
            discount = parseFloat(order.extra_discount);
        } else {
            discount = (subtotal * parseFloat(order.extra_discount)) / 100;
        }
    }

    const safe = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const detailsHtml = `
      <section class="history-detail-context"><h2 translate="no">#${safe(order.order_id || order._id)}</h2>
        <p><span>Table</span> <bdi>${safe(order.table_number)}</bdi> · <span>${safe(order.dine_type || 'Dine-in')}</span> · <span>Guests</span> <bdi>${safe(order.person_count || 1)}</bdi></p>
        <p><span>${safe(order.status)}</span> · <time translate="no">${safe(formatDateTime(order.created_at || order.created_date))}</time></p>
        ${order.customer_name ? `<p translate="no">${safe(order.customer_name)}</p>` : ''}
      </section>
      ${window.ServiceRounds && Array.isArray(order.kitchen_rounds) ? ServiceRounds.render(order) : `<section class="history-detail-items">${(order.items || []).map(item => `<div class="${struck(item,order).trim()}"><span><strong translate="no">${safe(item.name)}</strong>${item.note || item.notes ? `<small translate="no">${safe(item.note || item.notes)}</small>` : ''}</span><span translate="no">× ${safe(item.quantity)}</span><span>${CaptainMoney.html(item.price)}</span></div>`).join('')}</section>`}
      ${window.OrderPhotos ? OrderPhotos.render(order) : ""}
      <dl class="history-detail-totals"><div><dt>Subtotal:</dt><dd>${CaptainMoney.html(subtotal)}</dd></div>${discount ? `<div><dt>Discount:</dt><dd>−${CaptainMoney.html(discount)}</dd></div>` : ''}<div><dt>Tax:</dt><dd>${CaptainMoney.html(tax)}</dd></div><div><dt>Total</dt><dd>${CaptainMoney.html(order.total_amount)}</dd></div></dl>
      ${order.status === 'completed' || order.payment_status === 'Paid' ? `<div class="history-receipt-action"><button type="button" class="btn action-btn" data-review-bill="${safe(order.table_number || order.order_id || order._id)}" data-sale-id="${safe(order._id)}" data-receipt="true"><i class="fas fa-print" aria-hidden="true"></i> View / Print bill</button>${order.payment_status ? `<span>${safe(order.payment_status)}</span>` : ''}</div>` : ''}
      ${order.discount_description ? `<section class="history-detail-note"><h3>Order Notes:</h3><p translate="no">${safe(order.discount_description)}</p></section>` : ''}
      ${['completed','cancelled'].includes(order.status) ? '' : `<details class="history-detail-options"><summary>Order options</summary><button type="button" data-cancel-order="${safe(order._id)}">Cancel order</button></details>`}
    `;

    const detailsContent = document.getElementById('order-details-content');
    if (detailsContent) {
        detailsContent.innerHTML = detailsHtml;
        window.OrderPhotos?.mount(detailsContent);
    }

    // Show/hide action buttons based on order status
    const editBtn = document.getElementById('edit-order-btn');
    const cancelBtn = document.getElementById('cancel-order-btn');

    if (order.status === 'completed' || order.status === 'cancelled') {
        if (editBtn) editBtn.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'none';
    } else {
        if (editBtn) editBtn.style.display = 'inline-block';
        if (cancelBtn) cancelBtn.style.display = 'inline-block';
    }

    // Show modal
    const modalElement = document.getElementById('orderDetailsModal');
    if (modalElement && typeof bootstrap !== 'undefined') {
        const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
        modal.show();
        window.dispatchEvent(new Event('captain:details'));
    }
}

// Edit order
function editOrder(orderId) {
    console.log('Edit order clicked:', orderId);
    currentOrderId = orderId;
    openEditOrderModal();
}

// Modify KOT - alias for editOrder to support external onclick handlers
function modifyKot(orderId) {
    console.log('Modify KOT clicked:', orderId);

    currentOrderId = orderId;

    // Load order data if not already loaded
    if (!allOrders || !allOrders.some(order => order._id === orderId)) {
        loadOrderHistory().then(() => {
            openEditOrderModal();
        });
    } else {
        openEditOrderModal();
    }
}

// Make modifyKot globally accessible
window.modifyKot = modifyKot;

let openingOrderItems = false;
async function addItemsToOrder(orderId) {
    if (window.InlineOrderEditor?.adding && currentOrderId === orderId) { await openItemPicker(); return; }
    if (openingOrderItems) return;
    openingOrderItems = true;
    try {
        if (!allOrders?.some(order => order._id === orderId)) await loadOrderHistory();
        const order = allOrders?.find(order => order._id === orderId);
        if (!order || ['cancelled', 'completed'].includes(order.status)) return;
        currentOrderId = orderId;
        const modal = document.getElementById('editOrderModal');
        modal.addEventListener('shown.bs.modal', () => { window.InlineOrderEditor?.additions(); renderCurrentOrderItems(); void openItemPicker(); }, {once:true});
        openEditOrderModal();
    } finally { openingOrderItems = false; }
}
window.addItemsToOrder = addItemsToOrder;

// Direct floor actions use preparation identity, never an array position or
// dish name: two rounds may contain the same dish with different notes.
const floorLineKey = item => {
    const value=item.line_id || item.item_id || item.product_id || item.item || item._id || '';
    return String(value?.$oid || value);
};
function floorLineActions(order, item, { repeatOnly = false } = {}) {
    const key = floorLineKey(item);
    if (!key || lineIsCancelled(item, order) || order.payment_status === 'Paid' || ['cancelled','completed'].includes(order.status)) return '';
    const esc = editorEscape;
    if (repeatOnly) return `<div class="floor-line-actions" data-line-order="${esc(order._id)}" data-line-key="${esc(key)}"><button type="button" data-line-action="more" aria-label="Add again"><i class="fas fa-plus" aria-hidden="true"></i> <span>Add again</span></button></div>`;
    return `<div class="floor-line-actions" data-line-order="${esc(order._id)}" data-line-key="${esc(key)}"><button type="button" data-line-action="note" aria-label="Note" title="Preparation note"><i class="fas fa-pen" aria-hidden="true"></i><span>Note</span></button><button type="button" data-line-action="cancel" aria-label="Cancel item" title="Cancel item"><i class="far fa-trash-alt" aria-hidden="true"></i></button><span class="floor-line-quantity"><button type="button" data-line-action="less" aria-label="Decrease quantity">−</button><button type="button" data-line-action="more" aria-label="Add again"><i class="fas fa-plus" aria-hidden="true"></i> <span>Add again</span></button></span></div>`;
}
window.FloorLineActions = {render:floorLineActions,key:floorLineKey};
document.addEventListener('click', async event => {
    const button=event.target.closest('[data-floor-order-note]');
    if (!button || button.disabled || openingOrderItems) return;
    button.disabled=true;
    try {
        if (!await loadOrderHistory({background:true})) throw new Error('Connection failed');
        const order=allOrders.find(order=>order._id===button.dataset.floorOrderNote);
        if (!order?.preparation_notes || order.payment_status==='Paid' || ['cancelled','completed'].includes(order.status)) throw new Error('Table changed. Refresh and try again.');
        currentOrderId=order._id;
        const modal=document.getElementById('editOrderModal');
        modal.addEventListener('shown.bs.modal',()=>{
            const note=document.getElementById('editor-preparation-note');
            note?.scrollIntoView({block:'center'});note?.focus();
        },{once:true});
        openEditOrderModal();
    } catch(error) {showToast(window.I18N?.t(error.message) || error.message,'error');}
    finally {button.disabled=false;}
});
document.addEventListener('click', async event => {
    const button=event.target.closest('[data-floor-move-order]');
    if (!button || button.disabled || openingOrderItems || moveSaving) return;
    button.disabled=true;
    try {
        if (!await loadOrderHistory({background:true})) throw new Error('Connection failed');
        const order=allOrders.find(order=>order._id===button.dataset.floorMoveOrder);
        if (!order || order.payment_status==='Paid' || ['cancelled','completed'].includes(order.status) || /^take[\s_-]*away$/i.test(order.dine_type || '')) throw new Error('Table changed. Refresh and try again.');
        moveOrder(order._id);
    } catch(error) {showToast(window.I18N?.t(error.message) || error.message,'error');}
    finally {button.disabled=false;}
});
document.addEventListener('click', async event => {
    const button=event.target.closest('[data-line-action]');
    if (!button || openingOrderItems) return;
    const row=button.closest('[data-line-order]');
    if (!row || row.closest('[data-serving="true"]')) return;
    if (window.InlineOrderEditor?.adding && editingOrder && currentOrderId === row.dataset.lineOrder) {
        if (!['more','cancel','note','less'].includes(button.dataset.lineAction)) return;
        const source = editingOrder.items.find(item => floorLineKey(item) === row.dataset.lineKey);
        if (!source || lineIsCancelled(source, editingOrder)) return;
        if (button.dataset.lineAction === 'note') { document.querySelector(`#current-order-items .editor-note-link[data-index="${editingOrder.items.indexOf(source)}"]`)?.click(); return; }
        if (button.dataset.lineAction === 'less') { updateItemQuantity(editingOrder.items.indexOf(source),-1); return; }
        if (button.dataset.lineAction === 'cancel') { removeItem(editingOrder.items.indexOf(source)); return; }
        if (editingOrder.transfer_allocated === true) { await openItemPicker(); return; }
        addDraftServing(source); renderCurrentOrderItems(); updateOrderTotal();
        return;
    }
    openingOrderItems=true;button.disabled=true;
    try {
        // Refresh before starting a draft so desktop changes are included.
        if (!await loadOrderHistory({background:true})) throw new Error('Connection failed');
        const order=allOrders.find(order=>order._id===row.dataset.lineOrder);
        const matches=(order?.items || []).map((item,index)=>({item,index})).filter(({item})=>floorLineKey(item)===row.dataset.lineKey);
        if (!order || order.payment_status==='Paid' || ['cancelled','completed'].includes(order.status) || matches.length!==1 || lineIsCancelled(matches[0].item,order)) throw new Error('Table changed. Refresh and try again.');
        currentOrderId=order._id;
        const index=matches[0].index, modal=document.getElementById('editOrderModal');
        const shown = new Promise(resolve=>modal.addEventListener('shown.bs.modal',()=>{
            if (button.dataset.lineAction==='note') { window.InlineOrderEditor?.additions(); modal.querySelector(`.editor-note-link[data-index="${index}"]`)?.click(); }
            if (button.dataset.lineAction==='cancel') { window.InlineOrderEditor?.additions(); removeItem(index); }
            if (button.dataset.lineAction==='more') {
                if (editingOrder.transfer_allocated === true) { void openItemPicker();resolve();return; }
                const source=editingOrder.items[index];
                // Another serving is a fresh preparation, so its note cannot
                // overwrite the earlier kitchen ticket for this same dish.
                addDraftServing(source);
                window.InlineOrderEditor?.additions();
                renderCurrentOrderItems();updateOrderTotal();
                window.InlineOrderEditor?.reveal();
            }
            if (button.dataset.lineAction==='less') { window.InlineOrderEditor?.additions(); updateItemQuantity(index,-1); }
            resolve();
        },{once:true}));
        openEditOrderModal();
        await shown;
    } catch(error) {showToast(window.I18N?.t(error.message) || error.message,'error');}
    finally {openingOrderItems=false;button.disabled=false;}
});

// Add items to order
// function addItemsToOrder(orderId) {
//     currentOrderId = orderId;
//     openAddItemsModal();
// }
/*
 * THE TABLES THIS SHOP HAS, read once and read the same way everywhere.
 *
 * The till caches them under kiosk_tableorders. The edit sheet parsed that
 * string itself, and the move sheet below would have been a second parser of
 * the same string: two readings of one list is how a table's id goes missing
 * on one screen and not on the other.
 */
function tablesFromStorage(rows) {
    let raw = null;
    try {
        raw = Array.isArray(rows) ? JSON.stringify(rows) : localStorage.getItem('kiosk_tableorders');
    } catch (e) {
        return [];
    }
    if (!raw) return [];

    try {
        return (JSON.parse(raw) || []).map((t, index) => {
            const value = String(t.tableorder_value != null ? t.tableorder_value : index + 1);
            return {
                value,
                label: value,
                ...CaptainTables.metadata(t),
                description: CaptainTables.description(t),
                serviceState: t.status || t.service_state,
                orders: t.orders || [],
                seating: t.seating || null,
                adjacent: (t.adjacent_table_ids || []).map(String),
                closing: Boolean(t.closing),
                id: (typeof t._id === 'string' ? t._id : t._id && t._id.$oid) || t.id || t.tableorder_id || t.table_id || '',
            };
        });
    } catch (e) {
        console.error('Failed to parse kiosk_tableorders:', e);
        return [];
    }
}

/*
 * MOVING AN ORDER TO ANOTHER TABLE.
 *
 * Guests move. A two turns into a four, a table by the door turns out to be
 * under the air conditioner, a party joins another party.
 *
 * This was already possible and almost nobody could find it: Modify, scroll
 * past every dish on the order, find the table strip, change it, Update. That
 * is the screen for adding and cancelling dishes, so moving a table meant
 * walking through the one place where a mis-tap changes what the kitchen
 * cooks. Here it is its own thing, doing the one thing, and the lines go back
 * to the till exactly as they came.
 */
let orderBeingMoved = null;
let moveSaving = false;
let moveLoadVersion = 0, moveTables = [];
let moveSelected = [], movePrimary = "", moveMode = "move", mergeChoice = null;
let moveLegacySupported = false;
let mergeLegacySupported = false;
let moveClosing = false, moveReopen = null;
const usesDurableMove = order => Boolean(order?.seating_request_id ||
    (moveLegacySupported && tableOf(order) && order?.dine_type !== 'Take away'));
let mergePermission = null;
const mergePermissionOwner = () => JSON.stringify([window.POSNIC?.session?.shopKey,window.POSNIC?.session?.user?.id,localStorage.getItem('branch_id')]);
function canMergeOrders() { return mergePermission?.owner === mergePermissionOwner() && mergePermission.value; }
async function refreshMergePermission(revision) {
    const owner=mergePermissionOwner();
    try {
        const result=await POSNIC.api.get('/captain/v1/tables');
        if(revision!==historyRevision || owner!==mergePermissionOwner())return;
        mergePermission={owner,value:result.canMerge===true,legacy:result.capabilities?.legacyTargetMerge===true};
    } catch { if(revision!==historyRevision || owner!==mergePermissionOwner())return; mergePermission={owner,value:false}; }
    if(selectedTable!==null) filterOrdersBySelectedTable();
}

/*
 * BUILT HERE, not written into a page.
 *
 * This file is loaded by the order list AND by the KOT screen, and the button
 * that opens this sheet is drawn by this file, so a sheet living in one
 * page's HTML would be a button that silently does nothing on the other. The
 * markup follows the button.
 */
function ensureMoveSheet() {
    let el = document.getElementById('moveTableModal');
    if (el) return el;

    el = document.createElement('div');
    el.className = 'modal fade';
    el.id = 'moveTableModal';
    el.tabIndex = -1;
    el.innerHTML = `
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Move to another table</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <div class="move-table-now" id="move-table-now"></div>
                    <div id="move-custom-table" class="move-custom-table" hidden>
                        <label for="move-custom-number">Custom table</label>
                        <p id="move-custom-hint">Temporary table? Enter a label such as 6A, 6B or 6C.</p>
                        <div class="move-custom-entry"><input id="move-custom-number" type="text" maxlength="6" pattern="[A-Za-z0-9]{1,6}" placeholder="e.g. 6A" autocomplete="off" autocapitalize="characters" aria-describedby="move-custom-hint"><button type="button" id="move-custom-use" class="btn close-btn">Use table</button></div>
                    </div>
                    <p id="move-table-status" role="status"></p><button type="button" id="move-table-retry" class="btn close-btn" hidden>Retry</button><div class="move-table-list" id="move-table-list"></div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn close-btn" data-bs-dismiss="modal">Back</button>
                    <button type="button" class="btn close-btn" id="move-table-cancel" hidden>Cancel</button>
                    <button type="button" class="btn action-btn edit-btn" id="move-table-go" disabled>
                        Choose a table
                    </button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(el);

    /* One listener on the list: the tables are drawn fresh on every opening,
       so a listener per button would be a listener per opening. */
    el.querySelector('#move-table-list').addEventListener('click', (event) => {
        const button = event.target.closest('.move-table');
        if (button && !button.disabled) chooseMoveTable(button);
    });
    el.querySelector('#move-table-go').addEventListener('click', () => confirmMoveTable());
    el.querySelector('#move-table-cancel').addEventListener('click', () => confirmMoveTable(true));
    el.querySelector('#move-table-retry').addEventListener('click', refreshMoveTables);
    el.querySelector('#move-custom-use').addEventListener('click', useCustomMoveTable);
    el.querySelector('#move-custom-number').addEventListener('input', () => {
        if (moveSaving) return;
        moveSelected = []; movePrimary = '';
        el.querySelectorAll('.move-table.is-chosen').forEach(button => {button.classList.remove('is-chosen');button.setAttribute('aria-pressed','false');});
        el.querySelector('#move-table-go').disabled = true;
        el.querySelector('#move-table-go').textContent = 'Choose a table';
        el.querySelector('#move-custom-number').setCustomValidity('');
    });
    el.querySelector('#move-custom-number').addEventListener('keydown', event => { if(event.key === 'Enter') { event.preventDefault(); void useCustomMoveTable(); } });

    /* Reopened later for a different order, the last choice must not still be
       sitting there ready to move this one. */
    el.addEventListener('hide.bs.modal', event => {
        if (moveSaving) event.preventDefault();
        else moveClosing = true;
    });
    el.addEventListener('hidden.bs.modal', () => {
        orderBeingMoved = null;
        moveLoadVersion++;
        const go = document.getElementById('move-table-go');
        if (go) {
            go.disabled = true;
            go.textContent = 'Choose a table';
        }
        moveClosing = false;
        const reopen = moveReopen;
        moveReopen = null;
        if (reopen) moveOrder(...reopen);
    });

    return el;
}

function moveOrder(orderId, mode = "move") {
    if (moveSaving) return;
    // Bootstrap finishes hiding the backdrop after the dialog becomes invisible.
    // Wait for that cleanup before reopening, so it cannot clear the new order.
    if (moveClosing) { moveReopen = [orderId, mode]; return; }
    const order = (allOrders || []).find((o) => o._id === orderId);
    if (!order) return;

    ensureMoveSheet();
    orderBeingMoved = order;
    moveMode = mode; mergeChoice = null;
    ensureMoveSheet().querySelector(".modal-title").textContent = window.I18N?.t(mode === "merge" ? "Merge orders" : "Move to another table") || (mode === "merge" ? "Merge orders" : "Move to another table");
    void refreshMoveTables();

    const el = ensureMoveSheet();
    if (typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(el).show();
}

async function refreshMoveTables() {
    if (moveSaving || !orderBeingMoved) return;
    const version = ++moveLoadVersion;
    const message = document.getElementById('move-table-status');
    const retry = document.getElementById('move-table-retry');
    const go = document.getElementById('move-table-go');
    document.getElementById('move-custom-table').hidden = true;
    document.getElementById('move-custom-number').value = '';
    moveTables = [];
    moveLegacySupported = false;
    mergeLegacySupported = false;
    moveSelected = []; movePrimary = ""; mergeChoice = null;
    document.getElementById('move-table-list').replaceChildren();
    go.disabled = true;
    retry.hidden = true;
    document.getElementById('move-table-cancel').hidden = true;
    message.textContent = window.I18N?.t('Loading...') || 'Loading...';
    try {
    if (window.CaptainGroupMove?.pending(orderBeingMoved._id)) {
        const pending=CaptainGroupMove.pending(orderBeingMoved._id);
        moveMode=pending.body.targetOrderId ? 'merge' : 'move';
        ensureMoveSheet().querySelector('.modal-title').textContent=window.I18N?.t(moveMode==='merge'?'Merge orders':'Move to another table') || (moveMode==='merge'?'Merge orders':'Move to another table');
        message.textContent = window.I18N?.t('Could not save. Please try again.') || 'Could not save. Please try again.';
        document.getElementById('move-table-cancel').hidden = false;
        go.textContent = window.I18N?.t('Retry') || 'Retry';
        go.disabled = false;
        return;
    }
        const result = await POSNIC.api.get('/captain/v1/tables');
        if (version !== moveLoadVersion || !orderBeingMoved) return;
        if (!Array.isArray(result.tables)) throw new Error('invalid_tables');
        moveLegacySupported = result.capabilities?.legacySourceMove === true;
        mergeLegacySupported = result.capabilities?.legacyTargetMerge === true;
        if(moveMode === "merge" && !result.canMerge) { message.textContent=window.I18N?.t("Permission is required.") || "Permission is required."; return; }
        moveTables = tablesFromStorage(CaptainTables.liveRows(result));
        message.textContent = '';
        document.getElementById('move-custom-table').hidden = moveMode !== 'move';
        renderMoveTables();
    } catch {
        if (version !== moveLoadVersion || !orderBeingMoved) return;
        message.textContent = window.I18N?.t('Connection failed') || 'Connection failed';
        retry.textContent = window.I18N?.t('Retry') || 'Retry';
        retry.hidden = false;
    }
}

/** Where the order is now, however the till spelled it. */
const tableOf = (order) =>
    String((order && (order.table_number || order.kiosk_table_no)) || '');

function renderMoveTables() {
    const order = orderBeingMoved;
    const container = document.getElementById('move-table-list');
    if (!order || !container) return;

    const now = tableOf(order);
    const here = document.getElementById('move-table-now');
    if (here) here.textContent = now ? `Now on table ${now}` : 'Not on a table yet';

    /*
     * Which tables are already working. Moving onto one is allowed, because
     * two parties do share a long table and a waiter knows their own floor
     * better than this does. Saying so first is the difference between a
     * decision and a surprise.
     */
    const busy = new Set(
        (allOrders || [])
            .filter(
                (o) =>
                    o._id !== order._id && o.status !== 'cancelled' && o.status !== 'completed'
            )
            .map(tableOf)
            .filter(Boolean)
    );

    if (moveMode === "merge") { renderMergeTables(); return; }
    if (usesDurableMove(order)) { renderGroupMoveTables(); return; }
    const tables = moveTables;
    for (const table of tables) if (table.orders.some(row => row.id !== order._id)) busy.add(table.value);
    if (!tables.length) {
        container.innerHTML =
            '<div class="text-muted">No tables configured. Whoever set up the till adds them.</div>';
        return;
    }

    container.innerHTML = tables
        .map((t) => {
            const isHere = t.value === now;
            const otherGuests = t.orders.filter(row => row.id !== order._id).reduce((sum,row) => sum + (Number(row.guests) || 0),0);
            const tooSmall = t.max > 0 && Number(order.person_count || 1) + otherGuests > t.max;
            const unavailable = t.closing || ['held','cleaning'].includes(t.serviceState);
            return `
            <button type="button"
                class="move-table${isHere ? ' is-here' : ''}${busy.has(t.value) ? ' is-busy' : ''}"
                data-value="${CaptainTables.esc(t.value)}"
                data-id="${CaptainTables.esc(t.id)}"
                ${isHere || tooSmall || unavailable ? 'disabled' : ''}>
                <span class="move-table-no">${CaptainTables.esc(t.label)}</span>
                ${t.description ? `<span class="move-table-note">${CaptainTables.esc(t.description)}</span>` : ''}
                ${isHere ? '<span class="move-table-note">here now</span>' : ''}
                ${unavailable ? `<span class="move-table-note">${CaptainTables.esc(window.I18N?.t(t.closing ? 'Occupied' : t.serviceState === 'cleaning' ? 'Cleaning' : 'Held') || t.serviceState)}</span>` : ''}
                ${tooSmall ? `<span class="move-table-note">${CaptainTables.esc(window.I18N?.t('Choose a table with enough seats.') || 'Choose a table with enough seats.')}</span>` : ''}
                ${!isHere && busy.has(t.value) ? '<span class="move-table-note">has an order</span>' : ''}
            </button>`;
        })
        .join('');
}

function renderMergeTables() {
    const esc=CaptainTables.esc, t=value=>window.I18N?.t(value)||value;
    const order=orderBeingMoved, list=document.getElementById('move-table-list');
    document.getElementById('move-table-status').textContent=t('Both bills move to the selected table. Items are not sent to the kitchen again.');
    const rows=moveTables.filter(row=>row.orders.length===1 && row.orders[0].id!==order._id && row.value!==tableOf(order));
    list.innerHTML=rows.map(row=>{
        const guests=Number(order.person_count||1)+Number(row.orders[0].guests||0);
        const eligible=!row.closing && !['held','cleaning'].includes(row.serviceState) &&
            (row.seating?.table_ids?.length===1 || (mergeLegacySupported && !row.seating)) && !row.orders[0].paid && row.max>0 && guests<=row.max;
        return `<button type="button" class="move-table${mergeChoice?.id===row.id?' is-chosen':''}" data-id="${esc(row.id)}" aria-pressed="${mergeChoice?.id===row.id}" ${eligible?'':'disabled'}><span class="move-table-no" translate="no">${esc(row.label)}</span><span class="move-table-note">${esc(t('Guests'))}: ${esc(guests)} · ${esc(t('Maximum seats'))}: ${esc(row.max||'—')}</span>${!eligible?`<span class="move-table-note">${esc(t(row.max>0&&guests>row.max?'Choose a table with enough seats.':'Table changed. Refresh and try again.'))}</span>`:''}</button>`;
    }).join('') || `<p>${esc(t('No orders found for this table.'))}</p>`;
    const go=document.getElementById('move-table-go');go.disabled=!mergeChoice;go.textContent=t(mergeChoice?'Merge orders':'Choose a table');
}
function mergeSelection() {
    return {tableIds:[mergeChoice.id],primaryId:mergeChoice.id,guests:Number(orderBeingMoved.person_count||1),targetOrderId:mergeChoice.orders[0].id};
}
function groupMoveSelection() {
    return CaptainGroupMove.selection(moveTables, moveSelected, movePrimary, Number(orderBeingMoved.person_count || 1));
}
function renderGroupMoveTables() {
    const container=document.getElementById('move-table-list');
    const t=key=>window.I18N?.t(key)||key;
    const esc=CaptainTables.esc;
    const current=groupMoveSelection();
    container.innerHTML=moveTables.map(row=>{
        const selected=moveSelected.includes(row.id);
        const otherOrders=row.orders.some(order=>order.id!==orderBeingMoved._id);
        const unavailable=row.closing || ['held','cleaning'].includes(row.serviceState) || otherOrders;
        const adjacent=!moveSelected.length || moveSelected.some(id=>{
            const member=moveTables.find(table=>table.id===id);
            return row.adjacent.includes(id) || member?.adjacent.includes(row.id);
        });
        return `<button type="button" class="move-table${selected?' is-chosen':''}" data-id="${esc(row.id)}" data-value="${esc(row.value)}" aria-pressed="${selected}" ${unavailable||(!selected&&!adjacent)?'disabled':''}>
          <span class="move-table-no">${esc(row.label)}</span><span class="move-table-note">${esc(row.description)}</span>
          ${unavailable?`<span class="move-table-note">${esc(t(row.serviceState==='cleaning'?'Cleaning':row.serviceState==='held'?'Held':'Occupied'))}</span>`:''}
          <span class="move-table-note">${esc(t('Can combine with'))}: ${esc(moveTables.filter(other=>row.adjacent.includes(other.id)||other.adjacent.includes(row.id)).map(other=>other.label).join(', ')||'—')}</span>
        </button>`;
    }).join('');
    if(moveSelected.length){
        container.insertAdjacentHTML('beforeend',`<label class="move-table-primary"><span id="move-primary-label">${esc(t('Main table'))}</span><select aria-labelledby="move-primary-label" id="move-primary" class="form-select">${moveSelected.map(id=>`<option value="${esc(id)}" ${id===movePrimary?'selected':''}>${esc(moveTables.find(row=>row.id===id).label)}</option>`).join('')}</select></label>`);
        container.querySelector('#move-primary').addEventListener('change',event=>{movePrimary=event.target.value;renderGroupMoveTables();});
    }
    const message=document.getElementById('move-table-status');
    message.textContent=moveSelected.length ? t('Seat capacity')+': '+current.maximum+' · '+t('Guests')+': '+current.guests : t('Choose a table');
    const unchanged=orderBeingMoved.seating_request_id
        ? JSON.stringify([...moveSelected].sort())===JSON.stringify([...(orderBeingMoved.seating_table_ids||[])].sort()) && movePrimary===orderBeingMoved.seating_primary_id
        : moveSelected.length===1 && moveTables.find(row=>row.id===moveSelected[0])?.value===tableOf(orderBeingMoved);
    const go=document.getElementById('move-table-go');
    go.disabled=!current.valid||unchanged;
    go.textContent=t('Save');
}

/*
 * Chosen, then confirmed. A tap that moved an order the moment it landed
 * would make a mis-tap into a table change the kitchen hears about, and the
 * floor is not a place where anybody taps carefully.
 */
async function useCustomMoveTable() {
    if (moveSaving || !orderBeingMoved || moveMode !== 'move') return;
    const field = document.getElementById('move-custom-number');
    const label = field.value.trim().toUpperCase();
    field.value = label;
    field.setCustomValidity(/^[A-Z0-9]{1,6}$/.test(label) ? '' : 'Use up to 6 letters or numbers for the table.');
    if (!field.reportValidity()) return;
    const owner = orderBeingMoved;
    const select = () => {
        const button = [...document.querySelectorAll('#move-table-list .move-table')]
            .find(row => row.dataset.value?.toUpperCase() === label);
        if (!button || button.disabled) {
            document.getElementById('move-table-status').textContent = 'This table is not available. Choose another table.';
            return;
        }
        moveSelected = []; movePrimary = '';
        chooseMoveTable(button);
        field.value = label;
        document.getElementById('move-table-go').textContent = `Move to table ${label}`;
        document.getElementById('move-table-status').textContent = `Selected table ${label}. Tap Move to confirm.`;
        document.getElementById('move-table-go').focus();
    };
    if (moveTables.some(row => row.value.toUpperCase() === label)) { select(); return; }
    const controls = [...document.querySelectorAll('#moveTableModal button, #moveTableModal input')].map(node=>({node,disabled:node.disabled}));
    moveSaving = true;
    controls.forEach(({node})=>node.disabled=true);
    try {
        await POSNIC.api.post('/captain/v1/tables/temporary', {tableorder_value:label});
        moveSaving = false;
        if (orderBeingMoved !== owner) return;
        await refreshMoveTables();
        if (orderBeingMoved === owner) select();
    } catch(error) {
        document.getElementById('move-table-status').textContent = error.status === 404
            ? 'The server needs an update to support temporary tables.'
            : (error.message || 'Could not create the table. Please try again.');
    } finally {
        moveSaving = false;
        controls.forEach(({node,disabled})=>{ if(node.id !== 'move-table-go') node.disabled=disabled; });
    }
}

function chooseMoveTable(button) {
    if (moveSaving || button.disabled) return;
    const list = document.getElementById('move-table-list');
    if (!list) return;
    if(moveMode === 'merge') { mergeChoice=moveTables.find(row=>row.id===button.dataset.id); renderMergeTables(); return; }
    if (usesDurableMove(orderBeingMoved)) {
        const id=button.dataset.id;
        moveSelected=moveSelected.includes(id)?moveSelected.filter(value=>value!==id):[...moveSelected,id];
        if(!moveSelected.includes(movePrimary))movePrimary=moveSelected[0]||'';
        renderGroupMoveTables();
        return;
    }
    for (const other of list.querySelectorAll('.move-table')) other.classList.remove('is-chosen');
    button.classList.add('is-chosen');

    const go = document.getElementById('move-table-go');
    if (go) {
        go.disabled = false;
        go.textContent = `Move to table ${button.dataset.value}`;
    }
}

async function confirmMoveTable(cancelPending = false) {
    if (moveSaving) return;
    const chosen = document.querySelector('#move-table-list .move-table.is-chosen');
    const order = orderBeingMoved;
    let pending;
    try {
        pending = order && window.CaptainGroupMove?.pending(order._id);
    } catch (error) {
        showToast(window.I18N?.t('Could not save. Please try again.') || 'Could not save. Please try again.', 'error');
        return;
    }
    if (!order || (!pending && (!chosen || chosen.disabled))) return;
    if (!pending && usesDurableMove(order) && (moveMode === 'merge' ? !mergeChoice : !groupMoveSelection().valid)) return;
    moveSaving = true;
    const sheet = document.getElementById('moveTableModal');
    const controls = [...sheet.querySelectorAll('button,select')].map(button => ({button, disabled:button.disabled}));
    controls.forEach(({button}) => button.disabled = true);
    sheet.setAttribute('aria-busy', 'true');

    const go = document.getElementById('move-table-go');
    if (go) go.disabled = true;

    try {
        showLoader();

        /*
         * The same lines back, unchanged. The endpoint refuses an order with
         * no items, so a move has to carry them; linesForSave is what the
         * edit sheet sends, so a moved order cannot come out of this door
         * shaped differently from a modified one.
         */
        const data = pending ? await (cancelPending ? CaptainGroupMove.cancel(order._id) : CaptainGroupMove.resume(order._id)) : usesDurableMove(order) ? await CaptainGroupMove.move(order._id, moveMode === 'merge' ? mergeSelection() : groupMoveSelection()) : await CaptainOrderActions.save( {
            order_id: order._id,
            items: linesForSave(order.items),
            total_amount: order.total_amount,
            table_number: chosen.dataset.value,
            table_id: chosen.dataset.id || '',
            dine_type: order.dine_type || 'Dine-in',
            person_count: order.person_count || 1,
            seen_at: orderSeenAt(order),
        });

        if (data.type !== 'success') throw new Error(data.message || 'Could not move the order');

        moveSaving = false;
        showToast(data.cancelled ? (window.I18N?.t('Cancelled') || 'Cancelled') : (pending || usesDurableMove(order)) ? (window.I18N?.t('Saved') || 'Saved') : `Moved to table ${chosen.dataset.value}`, 'success');

        const el = document.getElementById('moveTableModal');
        if (el && typeof bootstrap !== 'undefined') {
            const modal = bootstrap.Modal.getInstance(el);
            if (modal) modal.hide();
        }

        if (!data.cancelled && typeof closeSlidingPanel === 'function') closeSlidingPanel();
        if (typeof loadTables === 'function') await loadTables();
        await loadOrderHistory();
    } catch (error) {
        moveSaving = false;
        if (isAConflict(error)) {
            await tellThemSomebodyElseGotThere();
            return;
        }

        showToast(error.message || 'Could not move the order', 'error');
        if (go) go.disabled = false;
    } finally {
        moveSaving = false;
        sheet.removeAttribute('aria-busy');
        controls.forEach(({button, disabled}) => button.disabled = disabled);
        hideLoader();
        // A saved request owns its destination until it is resolved.
        // Never offer another destination while Retry will send the saved one.
        if (sheet.classList.contains('show') && (usesDurableMove(order) || window.CaptainGroupMove?.pending(order._id))) {
            await refreshMoveTables();
        }
    }
}

function renderEditTables(tables, selectedTableNo) {
    const container = document.getElementById('edit-table-list');
    if (!container) return;

    let html = '';
    tables = tables || [];
    const busy = new Set((allOrders || []).filter(order => order._id !== currentOrderId && !['cancelled', 'completed'].includes(order.status)).map(tableOf));

    tables.forEach(t => {
        const value = editorEscape(t.value);
        const radioId = `edit_table_${value}`;
        const tableId = editorEscape(t.id || '');

        html += `
            <div class="table-item">
                <input type="radio"
                    class="table-radio"
                    id="${radioId}"
                    name="edit_table_no"
                    value="${value}"
                    data-id="${tableId}"
                    ${String(value) === String(selectedTableNo) ? 'checked' : ''}>
                <label for="${radioId}" class="table-label"><span translate="no">${value}</span>${busy.has(String(t.value)) ? '<small>has an order</small>' : ''}</label>
            </div>
        `;
    });

    // 🔹 Manual table input – same idea as discount.html
    html += `
        <div class="table-item manual-table">
            <input type="radio" class="table-radio"
                id="edit_table_manual_radio"
                name="edit_table_no"
                value=""
                data-id="">
            <label for="edit_table_manual_radio" class="table-label manual-label">
                <input type="text"
                    id="edit_manual_table_input"
                    class="manual-table-input"
                    placeholder="Other"
                    autocomplete="off">
            </label>
        </div>
    `;

    container.innerHTML = html;
}
function clampPersonCount(n) {
    if (isNaN(n)) n = 1;
    if (n < 1) n = 1;
    if (n > 99) n = 99;
    return n;
}

function setEditPersonCount(n) {
    n = clampPersonCount(n);

    if (editingOrder) {
        editingOrder.person_count = n;
    }

    const buttons = document.querySelectorAll('.edit-person-btn');
    buttons.forEach(btn => {
        const val = parseInt(btn.dataset.person || '0', 10);
        btn.classList.toggle('active', val === n);
    });

    const input = document.getElementById('edit_person_input');
    if (input) {
        if (document.activeElement !== input) {
            // Only set when n > 6, otherwise keep whatever is already there
            if (n > 6) {
                input.value = n.toString();
            }
            // do NOT set input.value = '' for n <= 6
        }
        if (n > 6) input.classList.add('active');
        else input.classList.remove('active');
    }

    // --- HERO ICONS (max 4 icons, show +N for more) ---
    const hero = document.getElementById('edit_person_hero');
    if (hero) {
        hero.innerHTML = '';
        const displayCount = Math.min(n, 4); // max 4 icons
        const remaining = n > 4 ? n - 4 : 0;

        let sizePx;
        if (displayCount <= 3) sizePx = 52;      // 1–3 big
        else sizePx = 38;                        // 4 medium

        for (let i = 0; i < displayCount; i++) {
            const icon = document.createElement('i');
            icon.className = 'fas fa-user-alt person-hero-icon';
            icon.style.fontSize = sizePx + 'px';
            hero.appendChild(icon);
        }

        // Add +N indicator if more than 4
        if (remaining > 0) {
            const plusIndicator = document.createElement('span');
            plusIndicator.className = 'person-plus-indicator';
            plusIndicator.textContent = `+${remaining}`;
            // plusIndicator.style.fontSize = sizePx + 'px';
            plusIndicator.style.marginLeft = '8px';
            plusIndicator.style.fontWeight = 'bold';
            plusIndicator.style.color = '#5c2d1f';
            hero.appendChild(plusIndicator);
        }
    }
}

function initEditPersonControls(initial) {
    const buttons = document.querySelectorAll('.edit-person-btn');
    const input = document.getElementById('edit_person_input');
    if (input?.dataset.initialized) { setEditPersonCount(initial || 1); return; }
    if (input) input.dataset.initialized = 'true';

    buttons.forEach(btn => {
        btn.addEventListener('click', function () {
            const n = parseInt(this.dataset.person || '1', 10);
            setEditPersonCount(n);
        });
    });

    if (input) {
        // auto-select text on focus/click
        input.addEventListener('focus', function () {
            setTimeout(() => this.select(), 0);
        });
        input.addEventListener('click', function () {
            this.select();
        });

        input.addEventListener('input', function () {
            let v = this.value.replace(/\D/g, '');
            if (v.length > 2) v = v.slice(0, 2);
            let n = parseInt(v || '0', 10);
            n = clampPersonCount(n);
            this.value = n.toString();
            setEditPersonCount(n);
        });
        // NEW: focus -> always add active
        input.addEventListener('focus', function () {
            this.classList.add('active');

            // REMOVE active class from all person buttons
            document.querySelectorAll('.edit-person-btn')
                .forEach(btn => btn.classList.remove('active'));
        });

        // NEW: blur -> remove active only if value <= 6 or empty
        input.addEventListener('blur', function () {
            const n = parseInt(this.value || '0', 10);
            if (!n || n <= 6) {
                this.classList.remove('active');
            }
        });
    }

    setEditPersonCount(initial || 1);
}
// Manual table input: allow only A-Z and 0-9, max 6 chars, auto-uppercase
// Manual table input: allow only A-Z and 0-9, max 6 chars, auto-uppercase
$(document).on('input', '#edit_manual_table_input', function () {
    let v = this.value.toUpperCase();      // caps lock auto
    v = v.replace(/[^A-Z0-9]/g, '');       // remove non letters/numbers
    this.value = v.slice(0, 6);            // max 6 characters

    // typing in the box should select "manual table" option
    $('#edit_table_manual_radio').prop('checked', true);
});
// Focus / click on the textbox should also activate manual table radio
$(document).on('focus click', '#edit_manual_table_input', function () {
    $('#edit_table_manual_radio').prop('checked', true);
});
// Open edit order modal
let editorOpenRequest = 0;
function openEditOrderModal() {
    const request = ++editorOpenRequest;
    const closing = window.OrderEditor?.whenClosing();
    if (closing) {
        const requestedOrderId = currentOrderId;
        closing.then(() => {
            if (request !== editorOpenRequest) return;
            currentOrderId = requestedOrderId;
            openEditOrderModal();
        });
        return;
    }
    const order = allOrders.find(o => o._id === currentOrderId);
    console.log(order);
    if (!order) return;

    if (order.status === 'cancelled') {
        showToast('This order was cancelled, so it cannot be changed.', 'error');
        return;
    }

    const type = ['amount', 'price', 'fixed'].includes(String(order.extra_discount_type || '').toLowerCase()) ? 'amount' : 'percent';
    const val = order.extra_discount || 0;

    document.getElementById('edit-discount-value').value = val;
    document.getElementById('edit-discount-description').value =
        order.discount_description || '';

    // set toggle
    const percentRadio = document.getElementById('edit-discount-percent');
    const amountRadio = document.getElementById('edit-discount-amount');

    if (type === 'amount') {
        amountRadio.checked = true;
        percentRadio.checked = false;
    } else {
        percentRadio.checked = true;
        amountRadio.checked = false;
    }

    // Set dine type radios
    const dineType = order.dine_type || 'Dine-in';
    const dineinRadio = document.getElementById('edit-dinein');
    const takeawayRadio = document.getElementById('edit-takeaway');

    if (dineType === 'Take away') {
        if (takeawayRadio) takeawayRadio.checked = true;
        if (dineinRadio) dineinRadio.checked = false;
    } else {
        if (dineinRadio) dineinRadio.checked = true;
        if (takeawayRadio) takeawayRadio.checked = false;
    }

    // Add event listeners for order type change
    document.querySelectorAll('input[name="edit_dine_type"]').forEach(radio => {
        radio.addEventListener('change', handleEditOrderTypeChange);
    });

    // Initial call to set visibility based on current order type
    handleEditOrderTypeChange();

    const currentTableNo = order.table_number || order.kiosk_table_no || '';
    const currentPersons = order.person_count || 1;
    const tables = tablesFromStorage();

    renderEditTables(tables, currentTableNo);
    // current table no listல் இல்லனா → manual input select & prefill
    if (currentTableNo) {
        const existsInList = tables.some(t => t.value === currentTableNo.toString());
        if (!existsInList) {
            const manualRadio = document.getElementById('edit_table_manual_radio');
            const manualInput = document.getElementById('edit_manual_table_input');
            if (manualRadio) manualRadio.checked = true;
            if (manualInput) manualInput.value = currentTableNo;
        }
    }

    setOrderBeingModified(JSON.parse(JSON.stringify(order))); // Deep copy
    editingOrder.person_count = currentPersons || 1;
    if (!Array.isArray(editingOrder.items)) editingOrder.items = [];
    initEditPersonControls(editingOrder.person_count);

    // Normalize item fields — handle both legacy and KOT-inserted items
    editingOrder.items.forEach(item => {
        const unit = parseFloat(item.unit_price || item.item_base_price || item.price || 0);
        item.price = Number.isFinite(unit) ? unit : 0;
        if (!item.selling_price) item.selling_price = item.price;
        item.quantity = lineQuantity(item);
    });

    renderCurrentOrderItems();
    clearNewItems();
    window.OrderEditor?.begin();

    const modalElement = document.getElementById('editOrderModal');
    const inline = window.InlineOrderEditor?.mount(currentOrderId) || false;
    // Inline controls are immediately usable; no modal animation may swallow a fast save.
    modalElement?.classList.toggle('fade', !inline);
    if (modalElement && typeof bootstrap !== 'undefined') {
        bootstrap.Modal.getInstance(modalElement)?.dispose();
        const modal = new bootstrap.Modal(modalElement, inline ? {backdrop:false,focus:false} : {});
        modal.show();
    }
}

// Handle edit order type change to show/hide table and pax sections
function handleEditOrderTypeChange() {
    if (window.OrderEditor) { window.OrderEditor.typeChanged(); return; }
    const orderType = document.querySelector('input[name="edit_dine_type"]:checked')?.value || 'Dine-in';
    const tableSection = document.getElementById('edit-table-section');
    const paxSection = document.getElementById('edit-pax-section');

    if (orderType === 'Dine-in') {
        // Show table and pax sections
        if (tableSection) tableSection.style.display = '';
        if (paxSection) paxSection.style.display = '';
    } else {
        // Hide table and pax sections for Takeaway
        if (tableSection) tableSection.style.display = 'none';
        if (paxSection) paxSection.style.display = 'none';
    }
}

// Open add items modal
// function openAddItemsModal() {
//     openEditOrderModal();
//     setTimeout(() => {
//         const productSearch = document.getElementById('product-search');
//         if (productSearch) productSearch.focus();
//     }, 500);
// }

// Cancel order
function cancelOrder(orderId) {
    const order = allOrders.find(o => o._id === orderId);
    if (!order) return;

    if (order.status === 'cancelled') {
        showToast('This order was already cancelled.', 'error');
        return;
    }
    if (order.status === 'completed') {
        showToast('This order is already done, so it cannot be cancelled.', 'error');
        return;
    }

    pendingCancelOrderId = orderId;
    document.getElementById('history-cancel-reason').value = '';

    const modalElement = document.getElementById('cancelConfirmModal');
    if (modalElement && typeof bootstrap !== 'undefined') {
        const modal = new bootstrap.Modal(modalElement);
        modal.show();
    }
}

async function performCancelOrder(orderId, reason) {
    const order = allOrders.find(o => o._id === orderId);
    if (!order) return;
    let cancellationConfirmed = false;

    showLoader();
    try {
        const data = await CaptainOrderActions.save( {
            order_id: orderId,
            items: order.items,
            total_amount: order.total_amount,
            status: 'cancelled',
            change_reason: reason
        });

        if (data.type === 'success') {
            cancellationConfirmed = true;
            const idx = allOrders.findIndex(o => o._id === orderId);
            if (idx !== -1) {
                allOrders[idx].status = 'cancelled';
            }

            // Refresh list
            filterOrders();

            // If details modal is open for this order, re-render it so buttons hide
            if (currentOrderId === orderId) {
                viewOrderDetails(orderId);
            }

            showToast(data.message || 'Order cancelled', 'success');
        } else {
            showToast(data.message || 'Could not cancel the order', 'error');
        }
    } catch (e) {
        console.error('Error cancelling order:', e);
        showToast(cancellationConfirmed ? 'Order cancelled' : 'Could not cancel the order: ' + e.message,
            cancellationConfirmed ? 'success' : 'error');
    } finally {
        hideLoader();
    }
    return cancellationConfirmed;
}

// Render current order items
function renderCurrentOrderItems() {
    const container = document.getElementById('current-order-items');
    if (!container || !editingOrder) return;

    const entries = editingOrder.items.map((item, index) => ({item, index}));
    entries.sort((a, b) => Number(!!window.OrderEditor?.isAdded(a.item)) - Number(!!window.OrderEditor?.isAdded(b.item)));
    let lastGroup = null;
    const itemsHtml = entries.map(({item, index}) => {
        const added = !!window.OrderEditor?.isAdded(item);
        const groupHeading = lastGroup === added ? '' : `<h3 class="editor-items-heading" data-draft-heading="${added}">${added ? 'New · Not sent' : 'Already sent'}</h3>`;
        lastGroup = added;
        const quantity = parseFloat(item.quantity || 1);

        // Per-unit values from backend
        const perUnitSellingPrice = parseFloat(item.selling_price || 0);
        const perUnitDiscount = parseFloat(item.discount || 0);
        const perUnitTax = parseFloat(item.tax_amount || 0);

        // Calculate total values based on quantity
        const totalSellingPrice = perUnitSellingPrice * quantity;
        const totalDiscount = perUnitDiscount * quantity;
        const totalTax = perUnitTax * quantity;

        if (added && window.InlineOrderEditor?.adding) return `
        ${groupHeading}<div class="order-item-card compact-draft-row service-line" data-line-key="${editorEscape(floorLineKey(item))}" data-draft-line="true">
          <div class="service-dish"><strong class="line-name" translate="no">${editorEscape(item.name)}</strong>${item.item_description ? `<p class="item-notes" translate="no">${editorEscape(item.item_description)}</p>` : ''}</div><span class="service-quantity" translate="no">×${item.quantity}</span>
          <div class="draft-controls floor-line-actions">
            <button type="button" class="editor-note-link item-info" data-index="${index}" aria-label="Note"><i class="fas fa-pen" aria-hidden="true"></i><span>Note</span></button>
            <button type="button" class="draft-remove" aria-label="Remove item" title="Remove unsent item" onclick="removeItem(${index})"><i class="far fa-trash-alt" aria-hidden="true"></i></button>
            ${ServiceDetails.supported() ? `<button type="button" class="preparation-link editor-preparation-action" data-preparation-order="${index}" aria-label="Preparation" title="Preparation"><i class="fas fa-sliders-h" aria-hidden="true"></i></button>` : ''}
            <div class="item-controls"><button type="button" class="qty-btn" aria-label="Decrease quantity" onclick="updateItemQuantity(${index}, -1)">−</button><span class="qty-display">${item.quantity}</span><button type="button" class="qty-btn" aria-label="Increase quantity" onclick="updateItemQuantity(${index}, 1)">+</button></div>
          </div>
        </div>`;
        return `
        ${groupHeading}<div class="order-item-card${struck(item, editingOrder)}" data-draft-line="${added}">
            <div class="item-info">
                <h6><span class="line-name" translate="no">${editorEscape(item.name)}</span>${window.OrderEditor?.isAdded(item) ? '<span class="editor-added">Added</span>' : ''}</h6>
                ${totalSellingPrice > 0 ? `<p class="item-selling-price"><strong>Final: ${CaptainMoney.html(totalSellingPrice)}</strong></p>` : ''}
                ${item.item_description ? `<p class="item-notes small text-muted" translate="no">${editorEscape(item.item_description)}</p>` : ""}
                ${ServiceDetails.summary(item)}
                ${window.OrderEditor && !added && Number(item.quantity) !== OrderEditor.previousQuantity(item) ? `<p class="editor-quantity-change"><span>Already on the order</span>: ${OrderEditor.previousQuantity(item)} · <span>Added</span>: ${Number(item.quantity) - OrderEditor.previousQuantity(item)} · <span>Total</span>: ${Number(item.quantity)}</p>` : ''}
            </div>
            ${!lineIsCancelled(item, editingOrder) ? `<div class="editor-item-actions"><button type="button" class="editor-note-link item-info" data-index="${index}"><i class="fas fa-pen" aria-hidden="true"></i> <span>Note</span></button>${ServiceDetails.supported() ? `<button type="button" class="preparation-link editor-preparation-action" data-preparation-order="${index}" aria-label="Preparation" title="Preparation"><i class="fas fa-sliders-h" aria-hidden="true"></i></button>` : ''}</div>` : ''}
            ${lineIsCancelled(item, editingOrder)
        /*
         * A cancelled line keeps no controls.
         *
         * Its quantity is zero and it is not going back on the bill from
         * here, so a minus that cannot go lower and a plus that would quietly
         * un-cancel it are two ways to be confusing. What is left is the word
         * for what happened, beside a name with a rule through it.
         */
        ? `<div class="item-controls">
                <span class="item-cancelled-mark">Cancelled</span>
            </div>`
        : `<div class="item-controls">
                <button type="button" class="qty-btn" aria-label="Decrease quantity" onclick="updateItemQuantity(${index}, -1)">−</button>
                <span class="qty-display">${item.quantity}</span>
                <button type="button" class="qty-btn" aria-label="${added ? 'Increase quantity' : 'Add again'}" onclick="updateItemQuantity(${index}, 1)">${added ? '+' : '<i class="fas fa-plus" aria-hidden="true"></i><span class="editor-repeat-label"> Add again</span>'}</button>
                <button type="button" class="remove-btn" aria-label="${added ? 'Remove item' : 'Cancel item'}" onclick="removeItem(${index})">
                    <i class="far fa-trash-alt" aria-hidden="true"></i> <span>${added ? 'Remove' : 'Cancel item'}</span>
                </button>
            </div>`}
        </div>
        `;
    }).join('');

    container.innerHTML = itemsHtml;
    if (window.InlineOrderEditor?.adding) {
        const heading = container.querySelector('[data-draft-heading="true"]');
        if (heading) {
            const batch = document.createElement('section');
            batch.className = 'service-round draft-round';
            heading.before(batch);
            batch.append(heading, ...container.querySelectorAll('.compact-draft-row'));
        }
    }
    window.InlineOrderEditor?.cancellations(editingOrder.items);
    window.InlineOrderEditor?.reveal();
    window.OrderEditor?.refresh();
}

function editorEscape(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

// Existing orders offer the same quick preparation notes as menu/cart entry.
const editorNoteSuggestions = ['Less spicy', 'Medium spicy', 'Extra spicy',
    'Less salt', 'Less sweet', 'Less oil', 'No onion', 'No garlic', 'No ice',
    'Extra gravy', 'Half plate', 'One by two'];
function refreshEditorNoteSuggestions() {
    const field = document.getElementById('edit-item-notes-text');
    if (!field) return;
    let host = document.getElementById('edit-note-suggestions');
    if (!host) {
        host = document.createElement('div');
        host.id = 'edit-note-suggestions';
        host.className = 'editor-note-suggestions';
        field.after(host);
        const help=document.createElement("p");help.className="edit-notes-help";help.textContent="Saved notes go with your next kitchen update.";host.after(help);
        host.innerHTML = editorNoteSuggestions.map(note => `<button type="button" data-editor-note="${editorEscape(note)}">${editorEscape(note)}</button>`).join('');
    }
    const selected = field.value.split(',').map(part => part.trim().toLowerCase());
    host.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(selected.includes(button.dataset.editorNote.toLowerCase()))));
    window.I18N?.apply(host);
}
$(document).on('show.bs.modal', '#editItemNotesModal', refreshEditorNoteSuggestions);
$(document).on('input', '#edit-item-notes-text', refreshEditorNoteSuggestions);
$(document).on('click', '[data-editor-note]', function () {
    const field = document.getElementById('edit-item-notes-text');
    const parts = field.value.split(',').map(part => part.trim()).filter(Boolean);
    const note = this.dataset.editorNote;
    const index = parts.findIndex(part => part.toLowerCase() === note.toLowerCase());
    if (index < 0) parts.push(note); else parts.splice(index, 1);
    field.value = parts.join(', ');
    field.dispatchEvent(new Event('input', {bubbles:true}));
});

// Click on item-info → open notes modal
$(document).on('click', '.item-info', function () {
    if (!editingOrder) return;

    const index = parseInt($(this).data('index'), 10);
    if (isNaN(index) || !editingOrder.items[index]) return;

    currentEditingItemIndex = index;
    const item = editingOrder.items[index];

    // Titleல item name
    $('#edit-notes-product-name').text(item.name || 'Item Notes');

    // Existing description/notes load
    const existing = item.item_description || item.notes || '';
    $('#edit-item-notes-text').val(existing);

    const modalEl = document.getElementById('editItemNotesModal');
    const bsModal = new bootstrap.Modal(modalEl);
    bsModal.show();
});

// Apply button → save notes back to editingOrder
$(document).on('click', '#edit-item-notes-apply', function () {
    if (!editingOrder || currentEditingItemIndex === null) return;

    const item = editingOrder.items[currentEditingItemIndex];
    if (!item) return;

    const notes = $('#edit-item-notes-text').val().trim();

    item.item_description = notes;
    window.InlineOrderEditor?.note(floorLineKey(item), notes);
    if ('notes' in item) item.notes = notes;

    // UI refresh
    renderCurrentOrderItems();

    // Modal close
    const modalEl = document.getElementById('editItemNotesModal');
    modalEl.addEventListener('hidden.bs.modal',()=>window.InlineOrderEditor?.reveal(floorLineKey(item)),{once:true});
    const bsModal = bootstrap.Modal.getInstance(modalEl);
    if (bsModal) bsModal.hide();

    currentEditingItemIndex = null;
});
// Update item quantity
let pendingRemovalIndex = null;
let pendingRemovalQuantity = null;

function updateItemQuantity(index, change) {
    if (!editingOrder) return;

    const item = editingOrder.items[index];
    if (change > 0 && editingOrder.transfer_allocated === true && !window.OrderEditor?.isAdded(item)) {
        void openItemPicker();
        return;
    }
    if (change > 0 && !window.OrderEditor?.isAdded(item)) {
        addDraftServing(item);
        renderCurrentOrderItems();
        updateOrderTotal();
        return;
    }
    if (change < 0 && !window.OrderEditor?.isAdded(item)) {
        showRemoveItemConfirmation(index, Math.min(-change, Number(item.quantity)));
        return;
    }
    const newQty = Number(item.quantity) + change;

    if (newQty <= 0) {
        showRemoveItemConfirmation(index);
        return;
    }
    const total = editingOrder.items.reduce((sum, item) => {
        return sum + (item.quantity * item.price);
    }, 0);

    item.quantity = newQty;
    window.InlineOrderEditor?.reveal(floorLineKey(item));
    renderCurrentOrderItems();
    updateOrderTotal();

    // Update sliding panel KOT card in real-time
    if (typeof updateSlidingPanelKotCard === 'function') {
        updateSlidingPanelKotCard();
    }
}

function showRemoveItemConfirmation(index, quantity = null) {
    if (!editingOrder || !editingOrder.items[index]) return;

    if (window.OrderEditor?.isAdded(editingOrder.items[index])) {
        editingOrder.items.splice(index, 1);
        renderCurrentOrderItems(); updateOrderTotal();
        if (!window.OrderEditor?.dirty() && document.getElementById('item-picker')?.hidden) void window.OrderEditor?.cancel();
        return;
    }
    document.getElementById('cancel-item-reason').value = '';
    pendingRemovalIndex = index;
    pendingRemovalQuantity = quantity;
    const item = editingOrder.items[index];

    document.getElementById('remove-item-name').textContent = quantity === null ? item.name : `${quantity} × ${item.name}`;

    const editModal = document.getElementById('editOrderModal');
    if (editModal) {
        editModal.classList.add('modal-behind');
    }

    const modalEl = document.getElementById('removeItemConfirmModal');
    const bsModal = new bootstrap.Modal(modalEl);
    bsModal.show();
}

function removeItem(index) {
    showRemoveItemConfirmation(index);
}

/**
 * HOW MANY OF THIS DISH THE ORDER SHOULD END UP WITH.
 *
 * ZERO IS A NUMBER, and that is the whole point of this function. A cancelled
 * line is kept on the screen with quantity 0 so it can be shown struck through
 * - but it still carries `item_quantity` from the till, its quantity BEFORE
 * the waiter struck it off.
 *
 * The old code read `item.quantity || item.item_quantity`, and 0 is falsy, so
 * a cancelled dish was sent back at its original quantity. The till saw no
 * change, cancelled nothing, printed nothing, and the dish was still there
 * when the waiter opened the order again. Reported from a live floor at Azure
 * on 14-09-2026: "i cancel one item and updated button. it closed. i dont see
 * any print is printed. also i went again inside same order its not
 * cancelled."
 *
 * A reduction from 2 to 1 was never affected - 1 is truthy. Only cancelling
 * was, which is why it went out looking fine.
 */
function lineQuantity(item) {
    if (!item) return 0;
    const said = [item.quantity, item.item_quantity].find(
        (v) => v !== undefined && v !== null && v !== ''
    );
    const n = parseFloat(said);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The lines to send when an order is saved.
 *
 * WHAT IS ABSENT IS WHAT IS CANCELLED. The till rebuilds the order from the
 * lines it receives: a dish that arrives is kept at the quantity given, and a
 * dish that does NOT arrive is struck off and written into the order's history
 * as a cancellation - which is also what puts a fresh ticket in the kitchen.
 *
 * So a cancelled line must be left out, not sent with a zero, and a line the
 * waiter never touched must be sent exactly as it was.
 */
/*
 * WHICH VERSION OF THE ORDER THIS PHONE IS LOOKING AT.
 *
 * A save sends the WHOLE order and the till keeps only what arrives, which is
 * how a cancelled dish gets cancelled. On a floor with several handsets it is
 * also how food goes missing: another waiter adds a biryani while this screen
 * is open, this screen saves a list that never had it, and the till removes a
 * dish the kitchen has already cooked.
 *
 * So the save says what it was looking at, and the till refuses one written
 * against an older version. Nothing is guessed here: this is the order's own
 * timestamp, handed back exactly as it arrived.
 */
function orderSeenAt(order) {
    if (!order) return null;
    return order.updated_date || order.created_date || null;
}

/*
 * SOMEBODY ELSE GOT THERE FIRST.
 *
 * Not an error message. The waiter did nothing wrong, and their change is not
 * lost - it was never sent. What they need to know is that the order in front
 * of them is out of date and is about to be refreshed, so they can look at it
 * and decide again. Only a person knows whether the dish somebody else added
 * was meant to go.
 */
function isAConflict(error) {
    return !!error && (error.status === 409 || error.message === 'order_changed');
}

async function tellThemSomebodyElseGotThere() {
    showToast('Somebody else changed this order. Showing you the latest.', 'error');
    window.OrderEditor?.saved(); // The stale draft must close before loading the latest order.

    for (const id of ['editOrderModal', 'moveTableModal']) {
        const el = document.getElementById(id);
        if (el && typeof bootstrap !== 'undefined') {
            const modal = bootstrap.Modal.getInstance(el);
            if (modal) modal.hide();
        }
    }

    if (typeof loadTables === 'function') await loadTables();
    await loadOrderHistory();
}

function linesForSave(items) {
    return (Array.isArray(items) ? items : [])
        .map((item) => ({ item, quantity: lineQuantity(item) }))
        .filter((row) => row.quantity > 0 && !lineIsCancelled(row.item))
        .map((row) => ({
            ...row.item,
            product_id: row.item.product_id || row.item.item_id || row.item.id || null,
            quantity: row.quantity,
            price: parseFloat(
                row.item.price || row.item.unit_price || row.item.item_base_price || 0
            ),
        }));
}

function confirmRemoveItem() {
    if (!editingOrder || pendingRemovalIndex === null) return;

    const line = editingOrder.items[pendingRemovalIndex];

    /*
     * KEPT AND STRUCK, not deleted - if the kitchen ever knew about it.
     *
     * Owner: "strick not working. i see text without any strick."
     *
     * Because this ran `items.splice(index, 1)`. The line stopped existing, so
     * the rule that strikes cancelled lines was correct and had nothing to be
     * correct about. A dish that simply vanishes is also the thing the strike
     * was asked for INSTEAD of: "it symbolic that we cancelled it" only means
     * something while it is still on the screen.
     *
     * A dish ADDED IN THIS SESSION is different. Nobody cooked it and nobody
     * was told about it, so there is nothing to symbolise - it goes, the way
     * taking something out of a basket does.
     *
     * Quantity 0 is what keeps it off the bill: updateOrderTotal reduces over
     * quantity, and the payload drops zero-quantity lines before they reach
     * the till. A cancelled dish cannot be charged for.
     */
    const wasOrdered = !!line && !window.OrderEditor?.isAdded(line);
    if (wasOrdered) {
        const reasonField = document.getElementById('cancel-item-reason');
        reasonField.value = reasonField.value.trim();
        if (!reasonField.reportValidity()) return;
        line.cancellation_reason = reasonField.value;
        const removed = Math.min(Number(line.quantity), pendingRemovalQuantity ?? Number(line.quantity));
        line.quantity = Math.max(0, Number(line.quantity) - removed);
        line.cancelled_quantity = Math.max(0, window.OrderEditor.previousQuantity(line) - line.quantity);
        line.cancelled = line.quantity === 0;
    } else {
        editingOrder.items.splice(pendingRemovalIndex, 1);
    }
    pendingRemovalIndex = null;

    const modalEl = document.getElementById('removeItemConfirmModal');
    modalEl.addEventListener('hidden.bs.modal',()=>window.InlineOrderEditor?.reveal(floorLineKey(line)),{once:true});
    const bsModal = bootstrap.Modal.getInstance(modalEl);
    if (bsModal) {
        bsModal.hide();
    }

    renderCurrentOrderItems();
    updateOrderTotal();

    // Update sliding panel KOT card in real-time
    if (typeof updateSlidingPanelKotCard === 'function') {
        updateSlidingPanelKotCard();
    }
}

// Add product to order
function addProductToOrder(productId, productName, productPrice) {
    if (!editingOrder) return;

    addDraftServing({product_id: productId, name: productName, selling_price: productPrice, price: productPrice});

    renderCurrentOrderItems();
    updateOrderTotal();

    // Update sliding panel KOT card in real-time
    if (typeof updateSlidingPanelKotCard === 'function') {
        updateSlidingPanelKotCard();
    }

    // Clear search
    const productSearch = document.getElementById('product-search');
    if (productSearch?.value) productSearch.select();
    const pickerSearch = document.getElementById('picker-search-input');
    if (pickerSearch?.value) { pickerSearch.focus({preventScroll:true}); pickerSearch.select(); }
}

// Update order total
function updateOrderTotal() {
    if (!editingOrder) return;

    const total = editingOrder.items.reduce((sum, item) => {
        if (lineIsCancelled(item, editingOrder)) return sum;
        return sum + (item.quantity * item.price);
    }, 0);

    editingOrder.total_amount = CaptainMoney.fromMinor(CaptainMoney.toMinor(total, CaptainMoney.current()), CaptainMoney.current());
    window.OrderEditor?.refresh();
}

// Clear new items
function clearNewItems() {
    const productSearch = document.getElementById('product-search');
    const suggestions = document.getElementById('product-suggestions');
    if (productSearch) productSearch.value = '';
    if (suggestions) suggestions.innerHTML = '';
}

// Utility functions
function formatDateTime(dateString) {
    const raw = dateString?.$date ?? dateString;
    if (raw === undefined || raw === null || raw === '') return '—';
    const date = new Date(raw?.$numberLong !== undefined ? Number(raw.$numberLong) : raw);
    if (!Number.isFinite(date.getTime())) return '—';
    const language = window.I18N?.language() || 'en';
    return date.toLocaleString(language === 'en' ? 'en-IN' : language, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function goBack() {
    if (window.history.length > 1) {
        window.history.back();
    } else {
        // fallback if no history
        window.location.href = 'discount.html'; // or discount.html, as you prefer
    }
}

function refreshOrders() {
    return window.MobileGestures ? MobileGestures.refresh() : loadOrderHistory();
}

function showLoader() {
    const loader = document.getElementById('page-loader');
    if (loader) loader.style.display = 'flex';
}

function hideLoader() {
    const loader = document.getElementById('page-loader');
    if (loader) loader.style.display = 'none';
}
let toastTimeout = null;

function showToast(message, type = 'success', duration = 3000) {
    const toast = document.getElementById('order-toast');
    const msgEl = document.getElementById('order-toast-message');
    if (!toast || !msgEl) return;

    msgEl.textContent = message || '';

    toast.classList.remove('order-toast-success', 'order-toast-error');
    if (type === 'error') {
        toast.classList.add('order-toast-error');
    } else {
        toast.classList.add('order-toast-success');
    }

    toast.style.display = 'block';

    if (toastTimeout) {
        clearTimeout(toastTimeout);
    }
    toastTimeout = setTimeout(() => {
        toast.style.display = 'none';
    }, duration);
}
/* ==================================================================
 * ADDING TO AN ORDER, FROM THE MENU ITSELF
 * ==================================================================
 *
 * Owner, relaying a client: "for adding within that screen so conjested.
 * adding new item should have button like add item and same as first scree
 * menu item list other so many stuff should neatly available. after adding
 * confirmation and add to existing order."
 *
 * The modify screen used to offer a text box and a list of names, squeezed
 * into half a column beside the order, the discount fields, the dine type,
 * the table and the cover count - on a phone. A waiter hunting for a dish got
 * none of what the menu screen gives them: categories, prices, photographs,
 * what is sold out, and a stepper that counts.
 *
 * So this opens the REAL MENU, drawn by the same MenuView the menu screen
 * uses. Not a copy: a copy would drift from the original the week after it was
 * written, and the two would disagree about what is on the card.
 *
 * Nothing is saved from in here. Items land in editingOrder the way they
 * always did, the modify screen shows them, and "Update the order" is still
 * the one button that talks to the till. Adding is a choice; committing is a
 * separate decision, and they stay separate.
 */

/**
 * Has this line been cancelled?
 *
 * Owner: "whenever order cancel or item cancel those line item name should be
 * strick in the middle. it symbolic that we cancelled it."
 *
 * Two ways a line is cancelled and they arrive differently:
 *
 *   THE WHOLE ORDER was cancelled - every line on it is off, and the order
 *   carries the status rather than the lines.
 *   ONE LINE was taken off a live order. The till records that on the item,
 *   and it has been spelled more than one way over the years, so all of them
 *   are accepted here rather than in four different templates.
 *
 * One function, because three screens show these lines and a dish struck
 * through in one view and plain in another is worse than neither.
 */
function lineIsCancelled(item, order) {
    if (order && String(order.status || '').toLowerCase() === 'cancelled') return true;
    if (!item) return false;
    if (item.cancelled === true || item.is_cancelled === true) return true;
    if (String(item.status || '').toLowerCase() === 'cancelled') return true;
    // Edited lines carry their remaining quantity and an explicit full-cancel
    // flag. Comparing the removed amount with the remainder would drop a
    // live serving when, for example, two portions are reduced to one.
    if (item.cancelled === false && Number(item.quantity) > 0) return false;
    /* A line reduced to nothing is a line that was taken off. */
    if (item.cancelled_quantity && Number(item.cancelled_quantity) >= Number(item.quantity || 0)) {
        return true;
    }
    return false;
}

/** The class that strikes a line through, or nothing. */
function struck(item, order) {
    return lineIsCancelled(item, order) ? ' is-cancelled' : '';
}

let pickerMenu = null;
/* The flat list behind the sections, which is what a search ranks over. Kept
   so typing does not have to re-read IndexedDB on every keystroke. */
let pickerAll = [];
/*
 * The same list, PREPARED for searching.
 *
 * ItemSearch.search wants what ItemSearch.index() returns, not raw rows -
 * handing it the rows throws `indexed.words is not iterable`, which in here
 * would have been a sheet that died the moment somebody typed. Built once when
 * the menu loads, because the folding and the word splitting are the expensive
 * half and doing them per keystroke is what makes a cheap Android stutter.
 */
let pickerIndex = null;
/* What is in the box right now. Held rather than read off the input, because
   the redraw that follows a keystroke happens after a debounce and the box may
   have moved on by then. */
let pickerTerm = '';
let pickerGeneration = 0;
function pickerRequestGuard() {
    const current = orderBeingModified(), generation = pickerGeneration;
    const owner = () => JSON.stringify([POSNIC.session?.shopKey, POSNIC.session?.user?.id,
        localStorage.getItem('branch_id'), POSNIC.session?.base || POSNIC.server?.baseUrl]);
    const identity = owner();
    return () => current && current === orderBeingModified() && generation === pickerGeneration
        && identity === owner() && !document.getElementById('item-picker')?.hidden;
}

async function openItemPicker() {
    pickerGeneration++;
    const sheet = document.getElementById('item-picker');
    const body = document.getElementById('item-picker-body');
    const rail = document.getElementById('item-picker-rail');
    if (!sheet || !body) return;

    sheet.hidden = false;
    document.body.classList.add('picker-open');
    body.innerHTML = '<div class="menu-nothing" data-chef-loading role="status">Loading the menu...</div>';
    const valid = pickerRequestGuard();
    pickerAll = []; pickerMenu = []; pickerIndex = null; pickerTerm = '';
    const box = document.getElementById('picker-search-input');
    if (box) box.value = '';
    if (rail) { rail.innerHTML = ''; rail.hidden = true; }

    try {
        const products = await getData(STORE_NAME);
        if (!valid()) return;
        if (!products || !products.length) {
            body.innerHTML = MenuView.nothing(
                'No items for this branch yet',
                'Whoever set up the till needs to add them.'
            );
            return;
        }

        pickerAll = products;
        pickerIndex = (typeof ItemSearch !== 'undefined' && ItemSearch.index)
            ? ItemSearch.index(products)
            : null;
        /* Grouped where the card on the wall groups it, so a dish has one
           number and not one per screen. */
        pickerMenu = MenuView.fromFlat(products);
        drawPicker();
    } catch (error) {
        if (!valid()) return;
        console.error('Could not open the menu', error);
        body.innerHTML = MenuView.nothing('Could not load the menu', 'Try again in a moment.');
    }
}

/**
 * Draw the sheet for whatever is typed in it.
 *
 * Two states, the same two the ordering screen has:
 *
 *   NOTHING TYPED   the whole menu, in the shop's own section order, with the
 *                   rail and the MENU button to move around it
 *   SOMETHING TYPED one flat list, ranked by ItemSearch, with the rail and the
 *                   index hidden - a jump index is meaningless over a result
 *                   set, and leaving it there implies the sections are still
 *                   the thing you are moving through
 *
 * The rows are drawn by MenuView and ranked by ItemSearch: the two modules the
 * ordering screen itself uses. That is the whole reason this looks and behaves
 * the same rather than merely similar.
 */
/**
 * How many of each dish are on the order being modified.
 *
 * MenuView draws a row as `- qty +` whenever the cart it is given has a count
 * for it, and as ADD when it does not. Handing it an empty map - which the
 * first version did - means every row says ADD for ever, however many times it
 * has been tapped, and the only feedback is a word that flashes and goes away.
 *
 * Keyed by product_id, which is what the order carries and what the data-id on
 * a row is. The VALUE is a line object, not a number: MenuView.render reads
 * `cart.get(id).quantity`, so a map of plain counts makes every row draw ADD -
 * correct right after a tap, because that path calls MenuView.dish directly
 * with a number, and wrong after any redraw. That asymmetry is the whole trap.
 */
/**
 * The order currently being modified.
 *
 * One named way to ask, because `editingOrder` is a `let` at the top of this
 * file: a script-scoped binding that SHADOWS any window property of the same
 * name. Anything outside this file - a test, a later screen - that reads
 * `window.editingOrder` gets an object the application never writes to, which
 * is a mistake that has already been made twice here and is invisible both
 * times: the code runs, and quietly describes nothing.
 *
 * A function DECLARATION is reachable on window, so this is the seam.
 */
function orderBeingModified() {
    return editingOrder;
}

/**
 * Start modifying an order.
 *
 * The counterpart to orderBeingModified, and here for the same reason: a `let`
 * at the top of this file cannot be reached from outside it, so without a
 * named way in, nothing - no later screen, no test - can put an order into the
 * modify flow. Two functions, one in and one out, and the binding stops being
 * a thing only this file can talk about.
 */
function setOrderBeingModified(order) {
    editingOrder = order;
    return editingOrder;
}

function pickerCart() {
    const cart = new Map();
    /*
     * `editingOrder`, NOT `window.editingOrder`.
     *
     * It is declared `let` at the top of this file, so it is a script-scoped
     * binding that SHADOWS any window property of the same name. Reading the
     * window one gets an object the application never writes to: every row
     * would draw ADD for ever, exactly as if nothing had been added - the bug
     * this code exists to fix, reintroduced one line lower down.
     */
    const order = orderBeingModified();
    const items = (order && order.items) || [];
    for (const item of items) {
        if (!window.OrderEditor?.isAdded(item) || lineIsCancelled(item, order) || Number(item.quantity) <= 0) continue;
        const id = String(item.product_id || item.id || '');
        if (!id) continue;
        const had = cart.get(id);
        const quantity = (had ? had.quantity : 0) + (Number(item.quantity) || 0);
        cart.set(id, { quantity });
    }
    return cart;
}

/**
 * Redraw ONE row, after its count changed.
 *
 * Not the whole menu: a full redraw loses the scroll position, and losing it
 * after every tap is how adding three dishes becomes three journeys back down
 * the menu.
 */
function showPreviouslyOrderedCounts() {
    const counts = new Map();
    for (const item of orderBeingModified()?.items || []) {
        const quantity = window.OrderEditor?.previousQuantity(item) || 0;
        const id = String(item.product_id || item.item_id || item.id || '');
        if (id && quantity > 0) counts.set(id, (counts.get(id) || 0) + quantity);
    }
    for (const row of document.querySelectorAll('#item-picker-body .dish[data-id]')) {
        row.querySelector('.picker-previous-count')?.remove();
        const count = counts.get(row.dataset.id);
        if (!count) continue;
        const label = document.createElement('small');
        label.className = 'picker-previous-count';
        const text = document.createElement('span'); text.textContent = 'Already ordered';
        label.append(text, document.createTextNode(': ' + count));
        row.querySelector('.dish-name')?.after(label);
    }
}

function pickerRefreshRow(id) {
    /*
     * EVERY row for this dish, not the first one.
     *
     * A dish can be on the screen twice now: once in a shortcut strip at the
     * top and once in its own category below. That is deliberate - the strips
     * are a shortcut, not a replacement, and removing a dish from its section
     * because it happens to be popular would make the menu wrong.
     *
     * But two rows for one dish MUST agree. Refreshing only the first left the
     * other showing ADD for a dish that was already on the order, which is the
     * exact confusion the counter was put there to end.
     */
    const rows = document.querySelectorAll('#item-picker-body .dish[data-id="' + id + '"]');
    if (!rows.length) return;
    const item = pickerItem(id);
    if (!item) return;
    const line = pickerCart().get(String(id));
    /* dish() takes a NUMBER; render() takes the line. Same map, two shapes. */
    /* With the numbers, like every other row on this sheet. Without them a
       dish LOSES its number the moment somebody taps it, which is worse than
       never having shown one: the column goes ragged under the thumb. */
    const fresh = MenuView.dish(item, line ? line.quantity : 0, {
      numbers: MenuView.numbers(pickerMenu),
    });
    for (const row of rows) {
        const holder = document.createElement('div');
        holder.innerHTML = fresh;
        if (holder.firstElementChild) row.replaceWith(holder.firstElementChild);
    }
    showPreviouslyOrderedCounts();
}

function drawPicker() {
    const body = document.getElementById('item-picker-body');
    const rail = document.getElementById('item-picker-rail');
    const indexBtn = document.getElementById('picker-index-btn');
    if (!body) return;

    const term = String(pickerTerm || '').trim();

    /* Every dish's number, from the shop's own menu order - the same on every
       handset, because it is derived rather than assigned. */
    const numbers = MenuView.numbers(pickerMenu);

    if (!term) {
        if (rail) {
            rail.innerHTML = MenuView.rail(pickerMenu, {});
            rail.hidden = false;
        }
        if (indexBtn) indexBtn.hidden = !(pickerMenu && pickerMenu.length > 1);
        /*
         * The shortcuts, then the whole menu. A waiter who wants the card
         * scrolls past three short strips; one who wants another water has
         * already found it.
         */
        const cart = pickerCart();
        const onTable = new Map(cart);
        const order = orderBeingModified();
        for (const item of order?.items || []) {
            if (lineIsCancelled(item, order) || !window.OrderEditor?.previousQuantity(item)) continue;
            const id = String(item.product_id || item.item_id || item.id || '');
            if (id) onTable.set(id, { quantity: Number(item.quantity) || 0 });
        }
        body.innerHTML = MenuView.render(
            [...pickerShortcuts(pickerMenu, onTable), ...pickerMenu],
            cart,
            { numbers }
        );
        showPreviouslyOrderedCounts();
        return;
    }

    if (rail) rail.hidden = true;
    if (indexBtn) indexBtn.hidden = true;

    const hits = pickerIndex
        ? ItemSearch.search(pickerIndex, term, {
            /* "chicken sixty five" finds Chicken 65, the way it does on the
               ordering screen. Typed numerals only - no phonetic guessing,
               which belongs to speech and not to a keyboard. */
            numbers: true,
        })
        : pickerAll.filter((i) => String(i.name || '').toLowerCase().includes(term.toLowerCase()));

    /*
     * A NUMBER TYPED IS A NUMBER MEANT - and also, sometimes, a name.
     *
     * Owner: "if enter 33 then it shows." Typing 33 puts dish 33 at the top.
     *
     * But it does NOT replace the search, because in an Indian kitchen a
     * number IS a dish name: type 65 and a waiter may well want Chicken 65,
     * which the text search finds and which no numbering scheme should take
     * away from them. So the numbered dish goes FIRST, labelled, and every
     * name match follows it. Both readings are offered and the waiter picks;
     * neither is guessed at on their behalf.
     */
    const byNumber = /^[0-9]{1,4}$/.test(term) ? MenuView.atNumber(pickerMenu, term) : null;
    const rest = byNumber ? hits.filter((i) => String(i.id) !== String(byNumber.id)) : hits;

    if (!hits.length && !byNumber) {
        body.innerHTML = MenuView.nothing(
            'Nothing matches "' + term + '"',
            'Try fewer letters, the first letters of each word, or a dish number.'
        );
        return;
    }

    /*
     * One section, because a search result is one list. Given a name rather
     * than left blank so the rows sit under a heading like every other row on
     * this screen - a result list with no heading reads as a different screen.
     */
    const sections = [];
    if (byNumber) {
        sections.push({ key: 'number', name: 'No. ' + term, items: [byNumber] });
    }
    if (rest.length) {
        sections.push({
            key: 'found',
            name: rest.length + (rest.length === 1 ? ' match' : ' matches'),
            items: rest,
        });
    }

    body.innerHTML = MenuView.render(sections, pickerCart(), { numbers });
    showPreviouslyOrderedCounts();
}

/** Every category with a count, for the MENU sheet. */
function pickerIndexRows() {
    return (pickerMenu || [])
        .map(function (section) {
            return '<button type="button" class="menu-index-row" data-category="' + editorEscape(section.key) + '">'
                + '<span class="menu-index-name" translate="no">' + editorEscape(section.name) + '</span>'
                + '<span class="menu-index-count">' + section.items.length + '</span>'
                + '</button>';
        })
        .join('');
}

function openPickerIndex() {
    const sheet = document.getElementById('picker-index');
    const list = document.getElementById('picker-index-list');
    if (!sheet || !list) return;
    list.innerHTML = pickerIndexRows();
    sheet.hidden = false;
    list.scrollTop = 0;
    const panel = sheet.querySelector('.ui-sheet');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    sheet.querySelector('.ui-sheet-title').id = 'picker-index-title';
    panel.setAttribute('aria-labelledby', 'picker-index-title');
    document.getElementById('picker-index-btn')?.setAttribute('aria-expanded', 'true');
    document.getElementById('picker-index-close')?.setAttribute('aria-label', window.I18N?.t('Close') || 'Close');
    [...sheet.parentElement.children].filter(node => node !== sheet && !node.inert).forEach(node => { node.inert = true; node.dataset.pickerIndexInert = 'true'; });
    document.getElementById('picker-index-close')?.focus({preventScroll:true});
}

function closePickerIndex() {
    const sheet = document.getElementById('picker-index');
    if (sheet) sheet.hidden = true;
    document.querySelectorAll('[data-picker-index-inert]').forEach(node => { node.inert = false; delete node.dataset.pickerIndexInert; });
    document.getElementById('picker-index-btn')?.setAttribute('aria-expanded', 'false');
    if (sheet && !document.getElementById('item-picker')?.hidden) document.getElementById('picker-index-btn')?.focus({preventScroll:true});
}

document.addEventListener('keydown', event => {
    const sheet = document.getElementById('picker-index');
    if (!sheet || sheet.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closePickerIndex(); }
    if (event.key === 'Tab') {
        const buttons = [...sheet.querySelectorAll('button:not(:disabled)')];
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
}, true);
window.addEventListener('captain:back', event => {
    const sheet = document.getElementById('picker-index');
    if (event.defaultPrevented || !sheet || sheet.hidden || document.querySelector('dialog[open], #posnic-lock.is-open')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closePickerIndex();
}, true);

/** Scroll the sheet to a section, the way the rail does. */
function pickerGoTo(key) {
    const section = document.getElementById('sec-' + key);
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelectorAll('#item-picker-rail .menu-chip').forEach(function (chip) {
        chip.classList.toggle('is-here', chip.dataset.category === key);
    });
}

function closeItemPicker() {
    closePickerIndex();
    pickerGeneration++;
    const sheet = document.getElementById('item-picker');
    if (sheet) sheet.hidden = true;
    document.body.classList.remove('picker-open');
    window.InlineOrderEditor?.reveal();
    window.OrderEditor?.refresh();
    document.getElementById('open-item-picker')?.focus({ preventScroll: true });
}

/*
 * TYPING, debounced.
 *
 * Ranking a two hundred item menu is microseconds, but re-rendering it on
 * every keystroke is not - and the phone a restaurant actually buys shows that
 * as a keyboard that lags behind the thumb. 120ms is under the threshold where
 * somebody notices a wait and well above the gap between two fast keystrokes.
 */
let pickerTyping = null;
document.addEventListener('input', function (event) {
    if (!event.target || event.target.id !== 'picker-search-input') return;
    const value = event.target.value;
    const clear = document.getElementById('picker-search-clear');
    if (clear) clear.hidden = !value;
    clearTimeout(pickerTyping);
    pickerTyping = setTimeout(function () {
        pickerTerm = value;
        drawPicker();
    }, 120);
});

/* One listener for the whole sheet, because the rows are redrawn. */
document.addEventListener('click', function (event) {
    if (!event.target.closest) return;

    if (event.target.closest('#open-item-picker')) {
        openItemPicker();
        return;
    }
    if (event.target.closest('#item-picker-close') || event.target.closest('#item-picker-done')) {
        closeItemPicker();
        return;
    }

    /* The MENU sheet: every category at once, with counts. */
    if (event.target.closest('#picker-index-btn')) {
        openPickerIndex();
        return;
    }
    if (event.target.id === 'picker-index-scrim' || event.target.closest('#picker-index-close')) {
        closePickerIndex();
        return;
    }
    const indexRow = event.target.closest('.menu-index-row');
    if (indexRow && indexRow.closest('#picker-index')) {
        closePickerIndex();
        /* After the sheet is gone, or the scroll lands against a screen that
           is about to change height. */
        setTimeout(function () { pickerGoTo(indexRow.dataset.category); }, 60);
        return;
    }

    /* A chip jumps to its section, the way the menu screen's rail does. */
    const chip = event.target.closest('.menu-chip');
    if (chip && chip.closest('#item-picker-rail')) {
        pickerGoTo(chip.dataset.category);
        return;
    }

    /* The cross in the search box. */
    if (event.target.closest('#picker-search-clear')) {
        const box = document.getElementById('picker-search-input');
        if (box) {
            box.value = '';
            box.focus();
        }
        pickerTerm = '';
        const clear = document.getElementById('picker-search-clear');
        if (clear) clear.hidden = true;
        drawPicker();
        return;
    }

    /*
     * ADD, from inside the picker.
     *
     * Scoped to the sheet: .btn-add is the menu screen's own class and this
     * page must not start answering for taps that are not in here.
     */
    /*
     * ONE FEWER, from inside the menu.
     *
     * A waiter who taps once too often should not have to close the menu, find
     * the line on the order behind it and take one off there. Routed through
     * updateItemQuantity so the removal confirmation, the totals and the KOT
     * card all behave exactly as they do on the order screen.
     */
    const less = event.target.closest('.btn-decrease');
    if (less && less.closest('#item-picker')) {
        const id = less.getAttribute('data-id');
        const order = orderBeingModified();
        const items = (order && order.items) || [];
        const matches = items.map((item, index) => ({ item, index })).filter(({ item }) =>
            String(item.product_id || item.item_id || item.id) === String(id) && !lineIsCancelled(item, order));
        // Undo a plain portion added in this edit before touching served or
        // specially prepared portions. Ambiguous reductions belong in review.
        const added = matches.slice().reverse().find(({ item }) => window.OrderEditor?.isAdded(item)
            && !String(item.item_description || item.notes || '').trim()
            && !item.seat && !item.course && !item.held && !(item.allergies || []).length
            && !item.allergy_note && !(item.modifiers || []).length);
        const at = added ? added.index : -1;
        if (at < 0 && matches.length) {
            closeItemPicker();
            document.querySelectorAll('#current-order-items .order-item-card')[matches[0].index]?.querySelector('.qty-btn')?.focus({ preventScroll: true });
            return;
        }
        if (at > -1) {
            updateItemQuantity(at, -1);
            pickerRefreshRow(id);
        }
        return;
    }

    const add = event.target.closest('.btn-add, .btn-increase');
    if (add && add.closest('#item-picker')) {
        const id = add.getAttribute('data-id');
        if (!id) return;

        /*
         * Named from the menu this sheet drew, NOT from searchedProducts.
         *
         * addProductToOrderById reads a map the SEARCH box fills in. Nothing
         * in here fills it, so routing through that helper would have logged
         * "Product not found" to a console nobody is looking at and added
         * nothing - with a row that said "Added" over the top of it.
         */
        const found = pickerItem(id);
        if (!found) return;

        /*
         * The same question the ordering screen asks, in the same words.
         *
         * A second round added to a table can be a whole fish just as easily
         * as the first one was, and a sheet that skipped the question would
         * put it on the order at nothing.
         */
        if (typeof MenuView !== 'undefined' && MenuView.askPrice && MenuView.askPrice(found)) {
            const valid = pickerRequestGuard();
            POSNIC.askPrice(found.name).then((asked) => {
                if (!asked || !valid()) return;
                rememberRecent(id);
                addProductToOrder(id, found.name, asked);
                pickerRefreshRow(id);
            });
            return;
        }

        rememberRecent(id);
        addProductToOrder(id, found.name, found.selling_price || found.price || 0);
        /*
         * The row becomes a counter. No "Added" flash and no second ADD: the
         * count IS the feedback, and it is the same thing the ordering screen
         * shows, so a waiter does not have to learn this screen separately.
         */
        pickerRefreshRow(id);
        return;
    }
});

/*
 * AN EMPTY SEARCH IS NOT AN EMPTY MENU.
 *
 * Owner: "how to make ux of searching best while add item? when user goes to
 * search show recent items? or show top selling or signature items? i want
 * some big options behind search."
 *
 * Opening the sheet used to show the whole card from the top - which is the
 * one thing a waiter already knows how to do and the slowest way to reach
 * anything. Before a single letter is typed there are three faster answers,
 * and between them they cover most of what a second round actually is:
 *
 *   ON THIS TABLE    what this order already has. A second round is usually
 *                    another of something, and this is one tap.
 *   YOU ADDED LATELY what this handset has been adding all shift. A waiter
 *                    working the same section sells the same twenty dishes.
 *   SELLING TODAY    the shop's own best sellers, which the app already
 *                    fetches for the ordering screen's ranking.
 *
 * Each is small and each disappears when it has nothing to say. A strip that
 * is sometimes empty and sometimes not teaches a waiter to ignore the top of
 * the screen, so an empty one is not drawn at all.
 *
 * The whole menu still follows underneath, unchanged. This adds a shortcut; it
 * does not take the long way round away from anybody.
 */

const RECENT_KEY = 'posnic.recent_items';
const RECENT_KEEP = 8;

/** What this handset has added lately, most recent first. */
function recentItemIds() {
    try {
        const said = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
        return Array.isArray(said) ? said.map(String) : [];
    } catch (e) {
        /* Storage blocked or corrupt. The sheet simply has one strip fewer. */
        return [];
    }
}

/** Remember one, at the front, without letting the list grow for ever. */
function rememberRecent(id) {
    const key = String(id || '');
    if (!key) return;
    try {
        const kept = [key, ...recentItemIds().filter((other) => other !== key)].slice(0, RECENT_KEEP);
        localStorage.setItem(RECENT_KEY, JSON.stringify(kept));
    } catch (e) {
        /* Nothing to remember it with; the strip is absent rather than wrong. */
    }
}

/**
 * The strips above the menu, in the order a waiter would want them.
 *
 * Deduplicated across the three: a dish already on the table is not also
 * offered as recent and as popular, because three copies of one row is a
 * screen that looks full and says little.
 *
 * @param {Array} menu     the sections this sheet is showing
 * @param {Map}   onOrder  what the order being modified already holds
 */
function pickerShortcuts(menu, onOrder) {
    const byId = new Map();
    for (const section of menu || []) {
        for (const item of section.items || []) byId.set(String(item.id), item);
    }

    const taken = new Set();
    const pick = (ids, limit) => {
        const out = [];
        for (const id of ids) {
            const key = String(id);
            if (taken.has(key)) continue;
            const item = byId.get(key);
            if (!item) continue;
            taken.add(key);
            out.push(item);
            if (out.length >= limit) break;
        }
        return out;
    };

    const strips = [];

    const onTable = pick([...(onOrder ? onOrder.keys() : [])], 6);
    if (onTable.length) {
        strips.push({ key: 'on-table', name: 'On this table', items: onTable });
    }

    const recent = pick(recentItemIds(), 6);
    if (recent.length) {
        strips.push({ key: 'recent', name: 'You added lately', items: recent });
    }

    /* The shop's own answer, already fetched for the ordering screen. A Set,
       so the order it arrived in is not preserved - which is fine: these are
       all popular, and the menu order is a defensible way to show them. */
    const popular = window._frequentItemIds instanceof Set ? [...window._frequentItemIds] : [];
    const selling = pick(popular, 6);
    if (selling.length) {
        strips.push({ key: 'selling', name: 'Selling today', items: selling });
    }

    return strips;
}

/** The dish behind a row, out of the menu this sheet is showing. */
function pickerItem(id) {
    for (const section of pickerMenu || []) {
        const hit = (section.items || []).find((item) => String(item.id) === String(id));
        if (hit) return hit;
    }
    /*
     * And the flat list, which is what a SEARCH RESULT was drawn from.
     *
     * Today every searchable item is also in a section, so this rarely runs.
     * It is here because the failure if it ever stops being true is silent:
     * the row says "Added", nothing reaches the order, and the waiter finds
     * out when the kitchen does not.
     */
    return (pickerAll || []).find((item) => String(item.id) === String(id)) || null;
}

/*
 * What a tap did, said on the row that was tapped.
 *
 * The order it lands on is behind this sheet, so without a word here a waiter
 * taps ADD and nothing whatsoever happens in front of them.
 */
function say(button) {
    const said = button.textContent;
    button.textContent = 'Added';
    button.disabled = true;
    setTimeout(() => {
        button.textContent = said;
        button.disabled = false;
    }, 700);
}

/*
 * QUICK SALE FROM THE SHEET, not only from the menu screen.
 *
 * Owner: "inside menu pop up menu add + button or some symbol to do quick
 * sales." Everything below the price is the ordinary add path - the same one
 * the ADD buttons in this sheet use - so the line, the ticket and the bill
 * know nothing unusual happened.
 */
document.addEventListener('click', async function (event) {
    if (!event.target || !event.target.closest) return;
    if (!event.target.closest('#picker-quick-sale')) return;

    const valid = pickerRequestGuard();
    const box = document.getElementById('picker-search-input');
    const said = box ? box.value.trim() : '';

    /*
     * Nothing typed is a question, not a refusal: the same sheet that asks the
     * price asks what it is called.
     */
    const name = said || (await POSNIC.askName(''));
    if (!name || !valid()) return;

    let entry;
    try { entry = await POSNIC.quickSale.ask(name); }
    catch (error) { if (valid()) showErrorPopup(error.message); return; }
    if (!entry || !valid()) return;
    const price = entry.amount;

    try {
        /*
         * `name`, NOT `said`. A test caught this the minute it was written:
         * with an empty box `said` is '' and the till would have been asked to
         * create an item with no name, which it refuses - so the button would
         * have looked broken in a new way.
         */
        const made = await POSNIC.quickSale.createOneOff(name, price, entry.tax);
        if (!valid()) return;

        /* saveOne, never saveData: saveData clears the store first and would
           delete the menu this sheet is drawing from. */
        if (typeof saveOne === 'function' && typeof STORE_NAME !== 'undefined') {
            await saveOne(STORE_NAME, [made]);
        }

        if (!valid()) return;
        addProductToOrder(made.id, made.name, price);
        if (box) box.value = '';

        const sheet = document.getElementById('item-picker');
        if (sheet) sheet.hidden = true;
    } catch (error) {
        if (!valid()) return;
        /* showErrorPopup is what this screen already uses; POSNIC.popup has no
           such function, and an error path that throws is an error nobody
           ever sees. */
        const why = (error && error.message) || 'The till would not add it. Try again.';
        if (typeof showErrorPopup === 'function') showErrorPopup(why);
        else console.error('quick sale failed:', error);
    }
});

// System Back follows the same history-screen hierarchy as the visible button.
window.addEventListener('captain:back', event => {
    if (event.defaultPrevented || document.querySelector('.modal.show, dialog[open]')) return;
    if (document.getElementById('order-list-screen') && selectedTable !== null) {
        event.preventDefault();
        handleBackButton();
    }
});

window.HistoryMobileDetails = {
    root: () => document.querySelector('#orderDetailsModal.show'),
    header: '.modal-header', body: '.modal-body',
    current: () => currentOrderId,
    entries: () => filteredOrders.map(order => ({id:order._id})),
    busy: () => !!editingOrder,
    show: entry => { viewOrderDetails(entry.id); document.querySelector('#orderDetailsModal .modal-body')?.scrollTo(0,0); },
    refresh: async () => {
        const id = currentOrderId;
        if (!await loadOrderHistory({background:true})) return false;
        if (!document.querySelector('#orderDetailsModal.show') || currentOrderId !== id) return false;
        if (allOrders.some(order => order._id === id)) viewOrderDetails(id);
        else bootstrap.Modal.getInstance(document.getElementById('orderDetailsModal'))?.hide();
        return true;
    },
    dismiss: () => bootstrap.Modal.getInstance(document.getElementById('orderDetailsModal'))?.hide(),
};
