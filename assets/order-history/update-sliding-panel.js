// Function to update the sliding panel KOT card in real-time when editing
function updateSlidingPanelKotCard() {
    // The editor owns an unsaved draft. Floor cards show only confirmed orders.
    if (window.OrderEditor) return;
    // Only update if we're on KOT management page and editing an order
    const isKotPage = window.location.pathname.includes('kot-management.html');
    if (!isKotPage || !editingOrder || !currentOrderId) return;
    
    // Find the KOT card in the sliding panel for this order
    const kotCards = document.querySelectorAll('.kot-card');
    if (!kotCards || kotCards.length === 0) return;
    
    // Find the card that matches the current order being edited
    // We need to match by checking the Edit button's onclick attribute
    let targetCard = null;
    kotCards.forEach(card => {
        const editBtn = card.querySelector('.btn-modify');
        if (editBtn && editBtn.getAttribute('onclick')?.includes(currentOrderId)) {
            targetCard = card;
        }
    });
    
    if (!targetCard) return;
    
    // Update the items list in the card
    const itemsList = targetCard.querySelector('.kot-items-list');
    if (!itemsList) return;
    
    let itemsHtml = '';
    editingOrder.items.forEach((item, index) => {
        const itemName = item.name || item.sale_inline_item_name || item.item_name || 'Item';
        const itemQty = item.quantity || 1;
        /*
         * THE SAME LINE THE FLOOR CARD DRAWS, note and all.
         *
         * This redraws a card in place after a modification, so a note that is
         * shown when the screen loads and gone the moment somebody changes a
         * quantity is worse than never showing it: a waiter would learn to
         * distrust the screen. lineNote and escapeFloor come from
         * assets/kot/script.js, which is loaded on the same page.
         */
        const note = typeof lineNote === 'function' ? lineNote(item) : '';
        const safe = typeof escapeFloor === 'function' ? escapeFloor : (v) => String(v == null ? '' : v);
        itemsHtml += `
            <div class="kot-item">
                <span class="item-index">${index + 1}.</span>
                <span class="item-name" translate="no">${safe(itemName)}</span>
                <span class="item-qty">x${itemQty}</span>
                ${note ? `<span class="item-note">${safe(note)}</span>` : ''}
            </div>
        `;
    });
    
    itemsList.innerHTML = itemsHtml;
    
    // Update the total
    const totalElement = targetCard.querySelector('.total-amount');
    if (totalElement && editingOrder.total_amount) {
        totalElement.textContent = CaptainMoney.display(editingOrder.total_amount);
    }
}
