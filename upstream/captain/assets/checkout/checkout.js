function showCartLoader() {
    const el = document.getElementById('page-loader');
    if (el) el.style.display = 'flex';
}

function hideCartLoader() {
    const el = document.getElementById('page-loader');
    if (el) el.style.display = 'none';
}

/*
 * ONE ORDER PER TAP.
 *
 * Reported from a live floor: an order sent from a handset for table 5 showed
 * up twice on the till, and cancelling one cancelled both.
 *
 * The loader appeared but the button stayed live, so a second tap during the
 * second or two this takes started a whole second checkout. On a slow shop
 * network that is not a rare accident - it is what anybody does when nothing
 * seems to be happening.
 *
 * TWO GUARDS, BECAUSE THEY FAIL DIFFERENTLY. This latch stops a second request
 * ever leaving the handset. The key the CART carries (see currentOrderKey in
 * indexedDB.js) stops a request that DID leave - on a dropped connection, or
 * from a second handset at the same table - from becoming a second ticket.
 *
 * Ported from Table_Order, where it was written first.
 */
let kioskOrderInFlight = false;

async function kioskPlaceOrder() {
    if (kioskOrderInFlight) {
        console.debug('[order] already sending; this tap is ignored');
        return;
    }
    kioskOrderInFlight = true;

    /* The button off as well as the latch: a disabled button says why nothing
       is happening, which a silent no-op does not. */
    const button = document.getElementById('next-btn');
    if (button) button.disabled = true;

    try {
        showCartLoader();

        // All discount/table/person details already saved from discount.html
        const transactionId = generateUniqueToken(); // from indexedDB.js
        await checkout(transactionId);

        // success: next page (thankyou) will load; loader disappears with this page
    } catch (e) {
        console.error("Error during checkout:", e);

        showErrorPopup("Failed to place order. Please try again.");
    } finally {
        // always hide loader if we are still on this page
        hideCartLoader();
        kioskOrderInFlight = false;
        if (button) button.disabled = false;
    }
}
