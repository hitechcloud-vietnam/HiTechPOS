document.addEventListener("DOMContentLoaded", async () => {
    // ✅ Open bottom sheet when cart summary clicked
    const discountSummary = document.querySelector('.discount-cart-summary');
    if (discountSummary) {
        discountSummary.addEventListener('click', () => {
            openCartSummarySheet();
        });
    }
});

async function openCartSummarySheet() {
    const sheet = document.getElementById('cart-summary-sheet');
    if (!sheet) return;

    await renderCartSummaryIntoSheet();

    sheet.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeCartSummarySheet() {
    const sheet = document.getElementById('cart-summary-sheet');
    if (!sheet) return;

    sheet.classList.remove('open');
    document.body.style.overflow = '';
}

// Close on backdrop / close button
document.addEventListener('click', (e) => {
    if (e.target.closest('.cart-sheet-close')) {
        closeCartSummarySheet();
    }
    const backdrop = e.target.closest('.cart-sheet-backdrop');
    if (backdrop) {
        closeCartSummarySheet();
    }
});

async function renderCartSummaryIntoSheet() {
    const bodyEl = document.getElementById('cart-sheet-body');
    const subtitleEl = document.getElementById('cart-sheet-subtitle');
    if (!bodyEl || !subtitleEl) return;

    let cart = [];
    try {
        cart = await getCartData();   // from indexedDB.js
    } catch (e) {
        console.error('Failed to read cart for summary', e);
    }

    if (!Array.isArray(cart) || cart.length === 0) {
        subtitleEl.textContent = 'Cart is empty';
        bodyEl.innerHTML = '<p style="font-size:13px;color:#777;">No items in cart.</p>';
        return;
    }

    let itemCount = 0;
    let totalQty = 0;
    let totalSubtotal = 0;        // gross price
    let totalDiscount = 0;
    let totalTax = 0;
    let finalTotal = 0;

    for (const item of cart) {
        const qty = Number(item.quantity || 0);
        if (qty <= 0) continue;

        itemCount += 1;
        totalQty += qty;
        const subtotal = Number(item.subtotal || 0);
        const discountPrice = Number(item.discount_price || 0);
        const taxPrice = Number(item.tax_price || 0);

        const lineSubtotal = subtotal * qty;
        const lineDiscount = discountPrice * qty;
        const lineTax = taxPrice * qty;

        totalSubtotal += lineSubtotal;
        totalDiscount += lineDiscount;
        totalTax += lineTax;

        // if you already store final (after discount+tax) per item, use it
        if (typeof item.final_price !== 'undefined') {
            finalTotal += Number(item.final_price || 0) * qty;
        } else {
            finalTotal += lineSubtotal - lineDiscount + lineTax;
        }
    }

    subtitleEl.textContent = `${itemCount} item${itemCount !== 1 ? 's' : ''} · ${totalQty} qty`;

    bodyEl.innerHTML = `
        <div class="cart-summary-row">
            <div class="cart-summary-chip-row">
                <div class="cart-summary-chip">
                    <div class="cart-summary-chip-label">Items</div>
                    <div class="cart-summary-chip-value">${itemCount}</div>
                </div>
                <div class="cart-summary-chip">
                    <div class="cart-summary-chip-label">Total Qty</div>
                    <div class="cart-summary-chip-value">${totalQty}</div>
                </div>
            </div>

            <div class="cart-summary-chip-row">
                <div class="cart-summary-chip">
                    <div class="cart-summary-chip-label">Subtotal</div>
                    <div class="cart-summary-chip-value">${CaptainMoney.html(totalSubtotal)}</div>
                </div>
                <div class="cart-summary-chip">
                    <div class="cart-summary-chip-label">Discount</div>
                    <div class="cart-summary-chip-value">‑${CaptainMoney.html(totalDiscount)}</div>
                </div>
            </div>

            <div class="cart-summary-chip-row">
                <div class="cart-summary-chip">
                    <div class="cart-summary-chip-label">Tax</div>
                    <div class="cart-summary-chip-value">${CaptainMoney.html(totalTax)}</div>
                </div>
            </div>

            <div class="cart-summary-total">
                <div class="cart-summary-total-label">Final Amount</div>
                <div class="cart-summary-total-amount">${CaptainMoney.html(finalTotal)}</div>
            </div>
        </div>
    `;
}

// ✅ Ensure cart is loaded only once on page load
$(document).ready(async function () {
    const branches = await getData(BRANCH_STORE);
    const branchId = branches[0]?.id;
    await fetchAndStoreBranch(branchId, false);
    let cartData = await getCartData();
    renderCart(cartData);

    // calculate itemCount and totalAmount from cartData
    let itemCount = 0;
    let totalAmount = 0;

    cartData.forEach(item => {
        // adjust property names if different in your cart objects
        const qty = Number(item.quantity || item.qty || 0);
        const price = Number(item.price || item.sale_price || 0);
        itemCount += qty;
        totalAmount += qty * price;
    });

    document.getElementById('cart-qty').textContent = itemCount;
    document.getElementById('cart-total').textContent = totalAmount.toFixed(2);

    // if old summary-display is still used somewhere:
    const summary = document.getElementById('summary-display');
    if (summary) {
        summary.textContent = `${itemCount} Items | ${CaptainMoney.display(totalAmount)}`;
    }
});