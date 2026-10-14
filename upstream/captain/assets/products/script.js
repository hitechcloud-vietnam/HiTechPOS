let currentNotesProductId = null;
let currentNotesProductName = "";

function isApkRuntime() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ||
        /Android/i.test(navigator.userAgent || '');
}

function getLocalImageUrl(src) {
    /* assets/images/placeholder.png has never existed in this repo, so every
       item with no photograph drew a broken-image glyph in the Frequently
       Ordered strip. This one is actually shipped. */
    if (!src) return 'images/default-product.webp';

    let localOrigin = '';
    try {
        /* Images come from whichever server is answering, so the origin they
           resolve against moves with it. */
        localOrigin = POSNIC.server.imageOrigin || '';
    } catch (e) {
        localOrigin = '';
    }

    const resolvedUrl = localOrigin
        ? src.replace(/^http:\/\/(localhost|127\.0\.0\.1):5555/i, localOrigin)
        : src;

    try {
        if (!/^https?:\/\//i.test(resolvedUrl)) return resolvedUrl;
        const cacheKey = localStorage.getItem('POSNIC_IMAGE_CACHE_BUST');
        if (!cacheKey) return resolvedUrl;
        const url = new URL(resolvedUrl);
        url.searchParams.set('_posnic_img', cacheKey);
        return url.toString();
    } catch (e) {
        return resolvedUrl;
    }
}

async function setKioskImagesFromIndexedDB() {
    try {
        const images = await getKioskImages();
        if (images) {
            updateKioskImageUI(images);
        }
    } catch (error) {
        console.warn("⚠ Could not load kiosk images:", error);
    }
}

// Add this function to your existing products script
function openOrderHistory() {
    window.location.href = 'order-history.html';
}

async function refreshProductsPage(button) {
    const selectedBranch = localStorage.getItem('kiosk_selected_branch');
    if (!selectedBranch) {
        showErrorPopup('No branch is selected. Please select a branch first.');
        return false;
    }

    const icon = button ? button.querySelector('i') : null;
    if (button) button.disabled = true;
    if (icon) icon.classList.add('fa-spin');

    try {
        localStorage.setItem('POSNIC_IMAGE_CACHE_BUST', String(Date.now()));
        const refreshed = await fetchAndStoreBranch(selectedBranch, false, true, true);
        if (refreshed === false) return false;
        await setKioskImagesFromIndexedDB();
        return true;
    } catch (error) {
        console.error('Failed to refresh product data:', error);
        if (button) showErrorPopup('Unable to refresh products. Check the server connection and try again.');
        return false;
    } finally {
        if (icon) icon.classList.remove('fa-spin');
        if (button) button.disabled = false;
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    /*
     * The rail, the index sheet and the resize handlers, attached once.
     * Before the first draw, or the chips it draws have nothing listening.
     *
     * ASKED FOR, NOT ASSUMED. This file is shared: the menu screen loads it,
     * and so do the cart and the discount screen, for the add-item flow the
     * three have in common. MenuScreen comes from products/menu.js, which
     * only the menu screen loads - so on the other two this line threw
     * "MenuScreen is not defined" and took the whole startup with it:
     * loadProducts, the database, the images and every listener below.
     *
     * The handler is async, so the throw was an unhandled rejection nobody
     * was shown, and both screens went on working on their fallbacks. That is
     * the same guard already used at setRow below, for the same reason.
     */
    if (typeof MenuScreen !== 'undefined') MenuScreen.start();

    await loadProducts();
    loadFrequentItems();
    /* After the menu, so an item can be matched to it; awaited so the cart
       check is against the real cart rather than an empty one mid-load. */
    await renderRepeatLastOrder();
    await openDB();
    await setKioskImagesFromIndexedDB();

    const searchInput = document.getElementById('product-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            applyProductFilter();
        });
    }

    /*
     * A way out of a search that is not the backspace key.
     *
     * Clearing a mistyped term meant holding backspace, which on a phone means
     * watching the results flicker through six wrong answers on the way to
     * none. One tap instead, and the keyboard stays up because the likeliest
     * next thing is typing something else.
     */
    const clearBtn = document.getElementById('product-search-clear');
    if (clearBtn && searchInput) {
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            applyProductFilter();
            searchInput.focus();
        });
    }

    /*
     * A chip means "take me there", so the search box has to let go first.
     *
     * Tapping Desserts while a search is running used to jump to a section
     * that was not on the screen, because the screen was showing results.
     */
    const categoryList = document.getElementById('category-list');
    if (categoryList) {
        categoryList.addEventListener('click', async (e) => {
            const chip = e.target.closest('.menu-chip');
            if (!chip) return;

            const searchEl = document.getElementById('product-search-input');
            if (searchEl && searchEl.value) {
                searchEl.value = '';
                /* The menu back before the jump, or there is nothing to jump
                   to. MenuScreen.goTo runs again after, on the real list. */
                await applyProductFilter();
                MenuScreen.goTo(chip.dataset.category);
            }
        });
    }
    // ✅ Open bottom sheet when cart summary clicked
    const discountSummary = document.querySelector('.discount-cart-summary');
    if (discountSummary) {
        discountSummary.addEventListener('click', () => {
            openCartSummarySheet();
        });
    }

    // Scrolling, keyboard resize and pointer hover must not end a search.
    // Only an explicit focus change or the keyboard's own dismissal does.
    let pointerStart = null;
    const menuTarget = target => {
        const row = target.closest?.('.dish, .frequent-card') || null;
        const action = target.closest?.('button, a') || null;
        return {
            row, action,
            itemId: row?.dataset.id,
            addAction: action?.matches('.btn-add') ? 'add' :
                action?.matches('.btn-increase') ? 'increase' : null,
        };
    };
    document.addEventListener('pointerdown', event => {
        pointerStart = menuTarget(event.target);
        // Adding a result or clearing a query should not collapse the keyboard
        // between pointer-down and click, moving the controls under the finger.
        if (document.activeElement === searchInput &&
            (event.target.closest?.('#product-search-clear') ||
             (pointerStart.row && pointerStart.action))) {
            event.preventDefault();
        }
    }, true);
    document.addEventListener('pointercancel', () => { pointerStart = null; }, true);
    document.addEventListener('click', event => {
        const start = pointerStart;
        pointerStart = null;
        // Keyboard/assistive activation has no pointer gesture to compare.
        if (!start || event.detail === 0) return;
        const end = menuTarget(event.target);
        // A menu refresh may replace the DOM nodes without changing the dish
        // or action under the finger. Preserve that tap, but never redirect it
        // to another dish or from Add to a different control.
        const sameAdd = start.itemId && start.itemId === end.itemId &&
            start.addAction && start.addAction === end.addAction;
        if (end.row && !sameAdd && (start.row !== end.row || start.action !== end.action)) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);
});

async function loadFrequentItems() {
    const section = document.getElementById('frequent-section');
    const container = document.getElementById('frequent-items');
    if (!section || !container) return;

    try {
        const branchId = localStorage.getItem('branch_id');
        if (!branchId) {
            return; // no branch, nothing to show
        }

        const data = await POSNIC.api.post('/sales/getFrequentItems', {
            branch_id: branchId,
            limit: 10
        });
        if (data.type !== 'success' || !data.data || !data.data.items || data.data.items.length === 0) {
            section.style.display = 'none';
            return;
        }

        /* Remembered for the search ranking: these are the shop's own answer
           to which of two equally-good text matches somebody meant. */
        window._frequentItemIds = new Set((data.data.items || []).map(i => String(i.id)));
        renderFrequentItems(data.data.items);
        section.style.display = 'block';
    } catch (e) {
        console.error('Failed to load frequent items:', e);
        section.style.display = 'none';
    }
}

function renderFrequentItems(items) {
    const container = document.getElementById('frequent-items');
    if (!container) return;

    // Flatten global products map into a simple array
    const flatProducts = [];
    for (const itemsArr of Object.values(products || {})) {
        itemsArr.forEach(p => flatProducts.push(p));
    }

    const html = items.map(it => {
        const product = flatProducts.find(p => p.id === it.product_id);
        if (!product) return '';

        const allowNegative = product.negative_stock === true;
        const available = product.available_quantity ?? product.stock ?? 0;

        // ❌ If no negative stock AND quantity <= 0 → skip from frequent list
        if (!allowNegative && available <= 0) {
            return '';
        }

        // Display stock label
        const initialStock = allowNegative ? '∞' : available;
        const stockNumeric = allowNegative ? -1 : available;   // -1 means infinite

        /* Never empty: getLocalImageUrl answers with the placeholder, and an
           empty src makes a browser re-request the page itself. */
        const imageUrl = getLocalImageUrl(product.img || product.image || product.item_image);

        return `
    <div class="frequent-card" data-id="${product.id}">
        <div class="frequent-stock-badge"
            id="frequent-stock-${product.id}"
            data-initial-stock="${stockNumeric}">
            Stock: ${initialStock}
        </div>
        <div class="frequent-inner">
            <div class="frequent-img">
                <img src="${imageUrl}" alt="${MenuView.escape(window.ItemLanguage.name(product))}" translate="no">
            </div>
            <div class="frequent-info">
                <div class="frequent-name" translate="no">
                    ${MenuView.escape(window.ItemLanguage.name(product))}
                </div>
                <div class="frequent-price">${CaptainMoney.html(MenuView.displayPricing(product).now)}${MenuView.priceLabel(MenuView.displayPricing(product))}</div>
            </div>

            <div class="frequent-cart-empty" id="frequent-empty-${product.id}">
                <button class="frequent-add-btn"
                        onclick="event.stopPropagation(); onFrequentAdd('${product.id}')">
                    ADD
                </button>
            </div>

            <div class="frequent-cart-controls" id="frequent-controls-${product.id}" style="display:none;">
                <button class="frequent-decrease"
                        onclick="event.stopPropagation(); onFrequentChange('${product.id}', -1)">-</button>
                <span id="frequent-qty-${product.id}">0</span>
                <button class="frequent-increase"
                        onclick="event.stopPropagation(); onFrequentChange('${product.id}', 1)">+</button>
            </div>
        </div>
    </div>`;
    }).join('');

    container.innerHTML = html;
    items.forEach(it => syncFrequentQtyFromMain(it.product_id));
}

async function syncFrequentQtyFromMain(id) {
    let q = 0;

    // 1️⃣ Try to read qty from visible main product card
    const mainQtyEl = document.getElementById('qty-' + id);
    if (mainQtyEl) {
        q = parseInt(mainQtyEl.textContent || '0', 10) || 0;
    } else if (typeof getCartData === 'function') {
        // 2️⃣ If not visible in current category, read from cart (IndexedDB)
        try {
            const cart = await getCartData();
            const item = cart.find(c => c.id === id);
            if (item && item.quantity) {
                q = item.quantity;
            }
        } catch (e) {
            console.error('Failed to read qty from cart for', id, e);
        }
    }

    const emptyBox = document.getElementById('frequent-empty-' + id);
    const controlsBox = document.getElementById('frequent-controls-' + id);
    const freqQtyEl = document.getElementById('frequent-qty-' + id);
    const stockBadge = document.getElementById('frequent-stock-' + id);

    if (!freqQtyEl || !emptyBox || !controlsBox) return;

    // toggle ADD / - qty +
    if (q > 0) {
        freqQtyEl.textContent = q;
        emptyBox.style.display = 'none';
        controlsBox.style.display = 'flex';
    } else {
        freqQtyEl.textContent = '0';
        emptyBox.style.display = 'block';
        controlsBox.style.display = 'none';
    }

    // update Stock: value on frequent badge
    if (stockBadge) {
        const initialRaw = stockBadge.getAttribute('data-initial-stock') || '0';
        const initial = parseInt(initialRaw, 10);

        if (initial === -1) {
            stockBadge.textContent = 'Stock: ∞';
        } else {
            let remaining = initial - q;
            if (remaining < 0) remaining = 0;
            stockBadge.textContent = 'Stock: ' + remaining;
        }
    }

    // also update main/search product card stock badge (if visible)
    updateStockBadgeForProduct(id);
}

async function onFrequentAdd(id) {
    await updateQuantity(id, 1);
    await syncFrequentQtyFromMain(id);
}

async function onFrequentChange(id, delta) {
    // delta > 0 & cartல இன்னும் item இல்லையா / notes இல்லையா என்றால் → default notes set
    if (delta > 0 && typeof getCartData === 'function') {
        const cart = await getCartData();
        const item = cart.find(c => c.id === id);
        if (!item || !item.notes) {
            const notes = await getDefaultNotesForProduct(id);
            if (notes) {
                await setCartItemNotes(id, notes);
            }
        }
    }

    await updateQuantity(id, delta);
    await syncFrequentQtyFromMain(id);
}

// function addFrequentItemToOrder(productId) {
//     const flatProducts = [];
//     for (const itemsArr of Object.values(products || {})) {
//         itemsArr.forEach(p => flatProducts.push(p));
//     }

//     const product = flatProducts.find(p => p.id === productId);
//     if (!product) {
//         console.warn('Product not found for frequent item', productId);
//         return;
//     }
//     addToCart(product);   // your existing add-to-cart logic
// }

// ✅ Click anywhere on the product card to increase quantity (excluding buttons)
// $(document).on("click", ".product-card", async function (e) {
//     if ($(e.target).hasClass("btn-increase") || $(e.target).hasClass("btn-decrease")) {
//         return; // Don't trigger if user clicked the buttons
//     }

//     const $button = $(this);
//     const $productCard = $button.closest(".product-card");
//     const productId = $(this).data("id");

//     const $originalImg = $productCard.find("img").first();
//     const offset = $originalImg.offset();
//     const $img = $originalImg.clone().css({
//         position: "absolute",
//         width: $originalImg.width(),
//         height: $originalImg.height(),
//         zIndex: 1000,
//         top: offset.top,
//         left: offset.left,
//         pointerEvents: "none"
//     });

//     $("body").append($img);

//     const $cart = $(".floating-cart");
//     const cartOffset = $cart.offset();

//     $img.animate({
//         top: cartOffset.top + 10,
//         left: cartOffset.left + 10,
//         width: 30,
//         height: 30,
//         opacity: 0.1
//     }, 800, "swing", function () {
//         $img.remove();
//     });

//     await updateQuantity(productId, 1);
// });
// Click on a dish row (except +/-/ADD buttons) → open notes modal
$(document).on("click", ".dish", function (e) {
    if (
        $(e.target).hasClass("btn-add") ||
        $(e.target).hasClass("btn-increase") ||
        $(e.target).hasClass("btn-decrease") ||
        $(e.target).closest(".dish-action").length
    ) {
        return; // quantity buttons click panna modal open ஆகக்கூடாது
    }

    const $card = $(this);
    const productId = $card.data("id");
    const productName = $card.find(".dish-name").text().trim();

    notesEditorSession += 1;
    currentNotesProductId = productId;
    currentNotesProductName = productName;
    loadExistingNotesForProduct(productId);

    buildNoteChips();
    $("#notes-product-name").text(productName);
    $("#product-notes-modal").css("display", "flex");
});
// Click on frequent card → open same notes modal
$(document).on("click", ".frequent-card", function (e) {
    // safety: if somehow +/-/ADD buttons bubble, ignore
    if (
        $(e.target).closest('.frequent-add-btn').length ||
        $(e.target).closest('.frequent-increase').length ||
        $(e.target).closest('.frequent-decrease').length
    ) {
        return;
    }

    const $card = $(this);
    const productId = $card.data("id");
    const productName = $card.find(".frequent-name").text().trim();

    notesEditorSession += 1;
    currentNotesProductId = productId;
    currentNotesProductName = productName;

    loadExistingNotesForProduct(productId);

    buildNoteChips();
    $("#notes-product-name").text(productName);
    $("#product-notes-modal").css("display", "flex");
});
// Cancel → close & clear
$(document).on("click", "#notes-cancel-btn", function () {
    $("#product-notes-text").val("");
    $("#product-notes-modal").hide();
    currentNotesProductId = null;
});

// Capture the dish at the tap; an asynchronous save must never follow a
// later editor selection or close a newly opened editor.
let notesSaving = false;
let notesEditorSession = 0;
$(document).on("click", "#notes-apply-btn", cartAction(async function () {
    if (!currentNotesProductId || notesSaving) return;
    const search = searchAtAdd();
    const id = currentNotesProductId;
    const session = notesEditorSession;
    const notes = $("#product-notes-text").val().trim();
    notesSaving = true;
    $("#notes-apply-btn").prop('disabled', true);
    try {
        const added = await setCartItemNotes(id, notes, true);
        await updateCart();
        if (session === notesEditorSession) {
            $("#product-notes-text").val("");
            $("#product-notes-modal").hide();
            currentNotesProductId = null;
            if (added) await prepareNextItem(search);
        }
    } catch (error) {
        console.error('Could not save item note', error);
        showErrorPopup("Failed to save notes. Please try again.");
    } finally {
        notesSaving = false;
        $("#notes-apply-btn").prop('disabled', false);
    }
}));
// Set / update notes for a cart item
function setCartItemNotes(id, notes, addIfMissing = false) {
    return queueCartMutation(async () => {
        await setCartItemNotesNow(id, notes);
        if (addIfMissing) {
            const cart = await getCartData();
            if (!cart.find(item => item.id === id && item.quantity > 0)) {
                return updateQuantityNow(id, 1);
            }
        }
    });
}
async function setCartItemNotesNow(id, notes) {
    let cartData = await getCartData();
    let item = cartData.find(i => i.id === id);

    if (!item) {
        const storedProducts = await getData("products");
        const p = storedProducts.find(x => x.id === id);
        if (!p) throw new Error("Failed to save notes. Please try again.");
        item = {
            id: p.id,
            name: p.name,
            ...window.PosnicItemText.snapshot(p),
            price: Number(p.price || 0),
            discount_price: Number(p.discount_price || 0),
            tax_price: Number(p.tax_price || 0),
            final_price: Number(p.final_price || 0),
            img: p.img,
            icon: p.icon || "",
            quantity: 0,
            notes: notes || ""
        };
        cartData.push(item);
    } else {
        item.notes = notes || "";
    }

    await saveCartData(cartData);
}
/*
 * THE NOTE ALREADY ON THE LINE, AND NOTHING ELSE.
 *
 * This used to fall back to the dish's own description and hand it back as a
 * "default note", and three callers stored it on the line. So a dish arrived
 * carrying its menu copy as a note, the till stored it, and the kitchen
 * printed it:
 *
 *   MIXED TANDOORI CHICKEN PLATTER                                x1
 *     ** A platter of the tandoor's chicken: kebabs, tikka and wings,
 *     served sizzling with onion and lime. Built to share. **
 *
 * Owner, holding that ticket: "those are item details. not notes."
 *
 * He is right, and it matters more than tidiness. That is writing for a guest
 * choosing dinner; a cook needs "no onion". A ticket that long for two dishes
 * is one somebody stops reading, and the line that mattered is in the middle
 * of it.
 *
 * The description has not gone anywhere. It is on the menu row, where a waiter
 * choosing the dish reads it - which is the one place it was ever for.
 */
async function getDefaultNotesForProduct(id) {
    const cartData = await getCartData();
    const item = cartData.find(i => i.id === id);

    return (item && item.notes) || "";
}
/*
 * THE NOTE IS THE WAITER'S, NOT THE MENU'S.
 *
 * Owner: "why notes already filled with some text. it supposed enter by waiter
 * right?"
 *
 * This used to fall back to the dish's own description when the cart had no
 * note - so opening the box on a Chicken Biryani typed "Long grain rice, slow
 * cooked" into it, and a waiter who then pressed Apply sent the shop's own
 * marketing copy to the kitchen as an instruction. To write a real note you
 * first had to notice that and delete it.
 *
 * The description is worth SHOWING - it is what is in the dish, which is the
 * question a table actually asks - so it is still read, and put above the box
 * where it cannot be mistaken for something somebody typed.
 */
function dishDescription(id) {
    let desc = "";
    if (typeof products !== "undefined" && products) {
        // products = { categoryId: [ items... ], ... }
        for (const itemsArr of Object.values(products)) {
            const p = itemsArr.find(p => p.id === id);
            if (p) {
                desc = p.item_description || p.description || "";
                break;
            }
        }
    }
    if (!desc) return "";
    // HTML entities (&lt; &gt;) decode + basic tag strip
    const tmp = document.createElement("textarea");
    tmp.innerHTML = desc;            // "&lt;p&gt;hi&lt;/p&gt;" → "<p>hi</p>"
    return tmp.value
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<\/?[^>]+>/g, "")
        .trim();
}

/*
 * WHICH OPENING THIS IS.
 *
 * loadExistingNotesForProduct reads the cart, which is a round trip to
 * IndexedDB, and then writes the answer into the box. The box is on screen the
 * whole time - so a waiter who opens the notes and starts typing straight away
 * had their words replaced by the answer to a question asked before they
 * started. On a desk the read finishes first and nobody sees it; on a busy
 * handset it does not.
 *
 * A CI runner is slow in the same way, which is how this surfaced: a test that
 * typed into the box and checked the chips lit went red in Actions and stayed
 * green locally.
 */
let notesOpening = 0;

async function loadExistingNotesForProduct(id) {
    const mine = ++notesOpening;
    const about = $("#notes-about");
    const desc = dishDescription(id);
    if (about.length) {
        about.text(desc);
        about.toggle(!!desc);
    }
    /* A chip is only "on" for as long as the box it wrote into is open. */
    $(".notes-chip").removeClass("is-on");

    try {
        const cartData = await getCartData();
        /* Opened again, or typed into, while this was reading. Either way the
           answer is stale and writing it would take away something a person
           put there. */
        if (mine !== notesOpening) return;
        const box = $("#product-notes-text");
        if (box.val()) {
            markChips();
            return;
        }
        const item = cartData.find(i => i.id === id);
        /* What is already on the line, and nothing else. An empty box is the
           honest state for a dish nobody has asked anything about. */
        box.val((item && item.notes) || "");
        markChips();
    } catch (e) {
        console.error("Error loading notes:", e);
        if (mine === notesOpening && !$("#product-notes-text").val()) {
            $("#product-notes-text").val("");
        }
    }
}

/*
 * THE THINGS PEOPLE ACTUALLY ASK FOR.
 *
 * Owner: "when focus show some common template text like less medium, less
 * sweet and etc."
 *
 * Typing "less spicy" on a phone keyboard between two tables is the reason
 * notes go unwritten. These are one tap each, and they are deliberately the
 * SAME WORDS voice-order.js already understands - its MARKERS crossed with its
 * TASTE set, plus its PORTIONS - so a note tapped here and the same note
 * spoken into the microphone arrive at the kitchen worded identically. A
 * printed ticket should not reveal which way the waiter's hands were full.
 */
const NOTE_SUGGESTIONS = [
    "Less spicy", "Medium spicy", "Extra spicy",
    "Less salt", "Less sweet", "Less oil",
    "No onion", "No garlic", "No ice",
    "Extra gravy", "Half plate", "One by two",
];

/** Draw them once, the first time the modal is opened. */
function buildNoteChips(selector = "#notes-chips") {
    const host = $(selector);
    if (!host.length || host.children().length) return;
    host.html(
        NOTE_SUGGESTIONS.map(
            (say) =>
                '<button type="button" class="notes-chip" data-say="' +
                say.replace(/"/g, "&quot;") +
                '">' +
                say +
                "</button>"
        ).join("")
    );
}

/** The note as a list of parts, so a chip can be taken back off. */
function notePieces(field = "#product-notes-text") {
    return String($(field).val() || "")
        .split(",")
        .map((piece) => piece.trim())
        .filter(Boolean);
}

/** Light the chips that are already in the box, however they got there. */
function markChips(field = "#product-notes-text") {
    if (typeof field !== "string") field = "#" + field.target.id;
    const said = notePieces(field).map((piece) => piece.toLowerCase());
    $(field).closest(".notes-modal").find(".notes-chip").each(function () {
        const say = String($(this).data("say") || "").toLowerCase();
        $(this).toggleClass("is-on", said.indexOf(say) !== -1).attr("aria-pressed", String(said.indexOf(say) !== -1));
    });
}

/* A chip adds its words, and takes them away again if it is already on. Both
   directions matter: the commonest correction to a tap is the same tap. */
$(document).on("click", ".notes-chip", function () {
    const say = String($(this).data("say") || "");
    if (!say) return;
    const field = "#" + $(this).closest(".notes-modal").find("textarea").attr("id");
    const pieces = notePieces(field);
    const at = pieces.findIndex((piece) => piece.toLowerCase() === say.toLowerCase());
    if (at === -1) pieces.push(say);
    else pieces.splice(at, 1);
    $(field).val(pieces.join(", "));
    markChips(field);
});

/* Typed by hand, or edited after a tap: the chips still have to agree with
   the box, or one of them is lying. */
$(document).on("input", "#product-notes-text, #cart-notes-text", markChips);
// ADD button → behaves like first + click
/**
 * Show how many the next tap will add, when it is more than one.
 *
 * Without it, typing "3 cb" and tapping add looks identical to adding one,
 * and the difference only shows up on the bill.
 */
/**
 * Put the last order back in the cart.
 *
 * "Same again" is a normal thing to say at a table, and doing it by hand
 * means finding every item a second time. Only offered when the remembered
 * order belongs to this branch and the cart is empty, so it can never
 * quietly double an order somebody is part way through building.
 *
 * Items no longer on the menu are skipped and counted, rather than added as
 * ids the kitchen cannot resolve.
 */
async function repeatLastOrder() {
    let last = null;
    try { last = JSON.parse(localStorage.getItem('posnic.last-order') || 'null'); }
    catch (e) { last = null; }

    const branchId = localStorage.getItem('kiosk_selected_branch');
    if (!last || !Array.isArray(last.items) || !last.items.length) return;
    if (last.branch && branchId && String(last.branch) !== String(branchId)) return;

    const known = new Map();
    for (const itemsArr of Object.values(products || {})) {
        for (const p of itemsArr) known.set(String(p.id), p);
    }

    let added = 0;
    let missing = 0;
    for (const line of last.items) {
        const product = known.get(String(line.item_id));
        if (!product) { missing += 1; continue; }
        await updateQuantity(product.id, Number(line.item_quantity) || 1);
        added += 1;
    }

    if (typeof showToast === 'function') {
        showToast(missing
            ? `Added ${added} items. ${missing} are no longer on the menu.`
            : `Added ${added} items from the last order.`);
    }
}

/** Offered only when it can do something: same branch, and an empty cart. */
async function renderRepeatLastOrder() {
    const host = document.querySelector('.product-search');
    if (!host) return;
    document.getElementById('repeat-last')?.remove();

    let last = null;
    try { last = JSON.parse(localStorage.getItem('posnic.last-order') || 'null'); }
    catch (e) { return; }
    if (!last || !Array.isArray(last.items) || !last.items.length) return;

    const branchId = localStorage.getItem('kiosk_selected_branch');
    if (last.branch && branchId && String(last.branch) !== String(branchId)) return;

    const cart = await getCartData();
    if (cart && cart.length) return;

    const button = document.createElement('button');
    button.id = 'repeat-last';
    button.type = 'button';
    button.textContent = `Repeat last order (${last.items.length} items)`;
    button.style.cssText =
        'display:block;width:100%;margin:8px 0 0;padding:10px;border:1.5px solid #d1d5db;' +
        'border-radius:8px;background:#fff;color:#111827;font-weight:600;cursor:pointer;';
    button.addEventListener('click', async () => {
        button.disabled = true;
        await repeatLastOrder();
        button.remove();
    });
    host.appendChild(button);
}

function showQuantityHint(quantity) {
    let hint = document.getElementById('qty-hint');
    if (!hint) {
        const search = document.querySelector('.product-search-inner');
        if (!search) return;
        hint = document.createElement('span');
        hint.id = 'qty-hint';
        hint.style.cssText =
            'margin-left:8px;padding:2px 9px;border-radius:999px;background:#2563eb;' +
            'color:#fff;font-size:12px;font-weight:700;white-space:nowrap;';
        search.appendChild(hint);
    }
    hint.hidden = !(quantity > 1);
    hint.textContent = quantity > 1 ? `x${quantity}` : '';
}

/*
 * A ONE-OFF, ASKED FOR AND PRICED AT THE TABLE.
 *
 * The till creates a real item marked INSTANT - which is why it never appears
 * on anybody's menu - and this then adds it to the order like any other dish.
 * Nothing downstream needs to know it was unusual.
 */
/*
 * THE PERMANENT WAY IN.
 *
 * Owner: "quick sale is not adding product which not exist or not matching in
 * the item list. Example I can add item like Fish but Fish Curry item already
 * exist. how can i add now? its blocker."
 *
 * He is right and the old design was wrong. Offering this only when a search
 * found NOTHING covers "birthday cake" and misses the case a restaurant
 * actually hits: a short word that matches something longer. "Fish" finds Fish
 * Curry, so the search is not empty, so the offer never appeared, and there was
 * no other door at all.
 *
 * The button is always there and takes whatever is in the box as the name,
 * because by the time somebody wants this they have usually just typed it.
 */
$(document).on('click', '#product-quick-sale', async function () {
    const box = document.getElementById('product-search-input');
    const said = box ? box.value.trim() : '';

    /*
     * Nothing typed is not a failure, it is a missing first step. Asking for a
     * price for an item with no name would produce a line on a kitchen ticket
     * that says nothing, which is worse than being sent back to the box.
     */
    /*
     * NOTHING TYPED IS A QUESTION, NOT A REFUSAL.
     *
     * Owner: "quick sale not clickable until text added."
     *
     * This nudged the placeholder and did nothing else, which reads as a dead
     * button - and a button that does nothing IS a dead button, however good
     * its reason. It asks now, on the same sheet the price is asked on.
     */
    if (!said) {
        const named = await POSNIC.askName('');
        if (!named) return;
        addOneOff(named);
        return;
    }

    addOneOff(said);
});

$(document).on('click', '[data-quick-sale]', async function () {
    addOneOff(this.getAttribute('data-quick-sale') || '');
});

async function addOneOff(said) {
    if (!said) return;

    /* The same sheet a fish priced at the market uses. A waiter should not
       learn two ways to type a number into this app. */
    let entry;
    try { entry = await POSNIC.quickSale.ask(said); }
    catch (error) { showErrorPopup(error.message); return; }
    if (!entry) return;
    const price = entry.amount;

    /*
     * THE HELPERS THIS SCREEN ACTUALLY HAS.
     *
     * showLoader, hideLoader and showToast live in the KOT, order-list and
     * login scripts - not here. Written against them, this threw
     * "hideLoader is not defined" and the dish was never added, silently,
     * because the failure happened inside the handler's own error path.
     * popup.js is what the menu screen loads and what it already uses.
     */
    try {
        const made = await POSNIC.quickSale.createOneOff(said, price, entry.tax);

        /*
         * Kept where every screen here reads its menu from, so the row can be
         * drawn, counted and sent exactly like the rest.
         *
         * saveOne, NOT saveData. saveData clears the store first - it is the
         * door the whole menu arrives through - so this used to delete every
         * dish and leave the one that had just been added.
         */
        await saveOne(STORE_NAME, [made]);
        await loadProducts();
        await updateQuantity(made.id, 1);

        const box = document.getElementById('product-search-input');
        if (box) {
            box.value = '';
            applyProductFilter();
        }
    } catch (error) {
        showErrorPopup(error.message || 'Could not add it');
    }
}

/*
 * A LONG PRESS ON A DISH SAYS IT HAS RUN OUT.
 *
 * The kitchen tells the floor before it tells anybody with a keyboard. A
 * waiter who hears "no more fish" had to find whoever runs the till, and in
 * the minutes that took, three more tables ordered it, three more tickets
 * printed, and three tables were told no after they had chosen.
 *
 * NOT A BUTTON ON THE ROW. Forty rows with an extra control on each is a
 * slower screen for every waiter, every service, to serve something that
 * happens twice a night. A long press is the phone idiom for "the other thing
 * you can do to this", and a stray press in an apron pocket does not reach it.
 *
 * Held on the row rather than on ADD, so the gesture never fights the tap that
 * adds a dish.
 */
(function () {
    const HELD_FOR_MS = 550;
    let timer = null;
    let held = false;

    const rowOf = (target) => (target.closest ? target.closest('.dish, .frequent-card') : null);

    async function offerToTakeItOff(row) {
        const id = row.getAttribute('data-id');
        if (!id) return;

        const product = await getProductById(id);
        if (!product || typeof POSNIC === 'undefined' || !POSNIC.askRunOut) return;

        const answer = await POSNIC.askRunOut(product);
        if (answer === null) return;

        try {
            const branchId = localStorage.getItem('branch_id') || '';
            const data = await POSNIC.api.post('/items/soldOut', {
                item: id,
                off: answer,
                branch: branchId
            });

            if (data.type !== 'success') throw new Error(data.message || 'Could not change it');

            /*
             * The cached menu is what every screen here draws from, so it is
             * updated before anything is redrawn. The next sync from the till
             * confirms it; this is so the waiter who just said it sees it.
             */
            const stored = await getProductById(id);
            if (stored) {
                stored.sold_out_today = answer;
                /* saveOne, NOT saveData: saving one dish through the whole-menu
                   door deleted the menu and left this row alone. */
                await saveOne(STORE_NAME, [stored]);
            }

            await loadProducts();
            if (typeof applyProductFilter === 'function') applyProductFilter();
        } catch (error) {
            /* popup.js, because showToast lives on the KOT and order screens
               and not on this one. Written against it once already, this threw
               inside its own error path and said nothing at all. */
            showErrorPopup(error.message || 'Could not change it');
        }
    }

    const start = (event) => {
        const row = rowOf(event.target);
        /* Not while they are aiming at a control: the stepper and ADD are taps,
           and a slow tap on them is still a tap. */
        if (!row || event.target.closest('button, input, a')) return;

        held = false;
        timer = setTimeout(() => {
            held = true;
            /* A short buzz, so the sheet is not a surprise arriving from
               nowhere while a thumb is still down. */
            if (window.CaptainPhone) CaptainPhone.vibrate(12);
            else if (navigator.vibrate) navigator.vibrate(12);
            offerToTakeItOff(row);
        }, HELD_FOR_MS);
    };

    const stop = () => {
        if (timer) clearTimeout(timer);
        timer = null;
    };

    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchend', stop);
    document.addEventListener('touchmove', stop, { passive: true });
    document.addEventListener('mousedown', start);
    document.addEventListener('mouseup', stop);
    document.addEventListener('mouseleave', stop);

    /* A press that became the sheet must not also be a tap that adds a dish. */
    document.addEventListener(
        'click',
        (event) => {
            if (!held) return;
            held = false;
            if (rowOf(event.target)) {
                event.stopPropagation();
                event.preventDefault();
            }
        },
        true
    );
})();

// Select only the search that produced this add. A slow save must not select
// the next query the waiter has already started typing.
function searchAtAdd() {
    const input = document.getElementById('product-search-input');
    return input ? { input, query: input.value, revision: productSearchRevision } : null;
}
async function prepareNextItem(search) {
    if (!search || !search.query.trim() || search.input.value !== search.query ||
        search.revision !== productSearchRevision) return;
    search.input.focus({ preventScroll: true });
    search.input.select();
}

function showAddBubbles(rect, effect = 'bubble') {
    if (!rect || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const burst = document.createElement('span');
    burst.className = 'menu-add-burst' + (effect === 'bubble' ? '' : ' menu-quantity-' + effect);
    burst.setAttribute('aria-hidden', 'true');
    burst.style.left = (rect.left + rect.width / 2) + 'px';
    burst.style.top = (rect.top + rect.height / 2) + 'px';
    const bubble = document.createElement('i');
    if (effect !== 'bubble') bubble.textContent = effect === 'heart' ? '💚' : '🙁';
    burst.appendChild(bubble);
    document.body.appendChild(burst);
    setTimeout(() => burst.remove(), effect === 'sad' ? 950 : 520);
}

$(document).on("click", ".btn-add", cartAction(async function () {
    const burstRect = this.getBoundingClientRect();
    const id = $(this).data("id");
    const search = searchAtAdd();

    /* Whatever the search asked for, then back to one: a quantity typed for
       one item must not silently apply to the next thing touched. */
    const quantity = window._pendingQuantity || 1;

    /*
     * A DISH PRICED ON THE DAY IS ASKED ABOUT BEFORE IT GOES ON.
     *
     * Owner, from a live table: two fish reached the kitchen worth nothing.
     * The catalogue cannot carry a price for a whole fish, so the waiter is
     * asked for the one they were told this morning.
     *
     * Asked BEFORE the quantity changes, so backing out of the question leaves
     * the order exactly as it was rather than adding a free dish and then
     * taking it off.
     */
    const product = await getProductById(id);
    let askedPrice = 0;
    if (typeof MenuView !== 'undefined' && MenuView.askPrice && MenuView.askPrice(product)) {
        askedPrice = await POSNIC.askPrice(window.ItemLanguage.name(product));
        if (!askedPrice) return;
    }

    /*
     * AND WHAT THE TABLE WANTS ON IT.
     *
     * Asked once, when the dish first goes on the order - not every time the
     * count goes up, because "two biryanis" is one question about two plates
     * and asking twice is how a waiter learns to skip the extras.
     *
     * Backing out leaves the order exactly as it was, the same rule the price
     * question follows above: null is a decision, an empty list is an answer.
     */
    let extras = [];
    if (typeof POSNIC !== 'undefined' && POSNIC.askOptions) {
        extras = await POSNIC.askOptions(product);
        if (extras === null) return;
    }

    const added = await updateQuantity(id, quantity, { askedPrice, modifiers: extras });
    if (added) { showAddBubbles(burstRect); await prepareNextItem(search); }

    if (typeof syncFrequentQtyFromMain === 'function') {
        syncFrequentQtyFromMain(id);
    }
}));
/*
 * ONE MORE, ONE FEWER.
 *
 * WHAT WAS HERE. Both buttons used to clone the dish's photograph and animate
 * it across the screen to the cart icon, then update the quantity. Three
 * things were wrong with that by the time the menu was rebuilt.
 *
 * It crashed. `$(...).find("img").offset()` is undefined when the row has no
 * photograph - which is now most rows, because a dish without one draws an
 * icon instead - and reading `.top` off undefined threw before the quantity
 * was ever changed. The button simply did nothing, silently.
 *
 * It aimed at something that is gone. The flight ended at
 * `.discount-cart-summary`, which the bill bar replaced.
 *
 * And it was answering a question the screen no longer has. The animation
 * existed to show WHERE a tapped item went, back when the total lived in a
 * corner. The row itself now turns into a stepper showing the count, and the
 * bill bar rises with the total on it, so the answer is already on the screen
 * twice before any picture could arrive.
 */
$(document).on("click", ".btn-increase", cartAction(async function () {
    const burstRect = this.getBoundingClientRect();
    const search = searchAtAdd();
    const $button = $(this);
    const productId = $button.data("id") || $button.closest(".dish, .frequent-card").data("id");

    const product = await getProductById(productId);
    if (!product) return;

    const cartData = await getCartData();
    const cartItem = cartData.find(item => item.id === productId);
    const currentCartQty = cartItem ? cartItem.quantity : 0;

    /* A shop that allows negative stock is never at its limit. */
    const availableQty = product.available_quantity || 0;
    const allowNegativeStock = product.negative_stock === true || product.negative_stock === 1;
    if (!allowNegativeStock && currentCartQty >= availableQty) {
        $button.prop('disabled', true).addClass('disabled');
        return;
    }

    const added = await updateQuantity(productId, 1);
    if (added) { showAddBubbles(burstRect, 'heart'); await prepareNextItem(search); }
    if (typeof syncFrequentQtyFromMain === 'function') {
        syncFrequentQtyFromMain(productId);
    }

    /* The row is redrawn by MenuScreen.setRow, so the button that was just
       pressed may be a different element now. Ask for it again. */
    if (!allowNegativeStock && currentCartQty + 1 >= availableQty) {
        $('.btn-increase[data-id="' + productId + '"]').prop('disabled', true).addClass('disabled');
    }
}));

$(document).on("click", ".btn-decrease", cartAction(async function () {
    const burstRect = this.getBoundingClientRect();
    const $button = $(this);
    const productId = $button.data("id") || $button.closest(".dish, .frequent-card").data("id");

    const removed = await updateQuantity(productId, -1);
    if (removed) showAddBubbles(burstRect, 'sad');
    if (typeof syncFrequentQtyFromMain === 'function') {
        syncFrequentQtyFromMain(productId);
    }

    /* Going down always makes room to go back up. */
    $('.btn-increase[data-id="' + productId + '"]').prop('disabled', false).removeClass('disabled');
}));


async function openCartSummarySheet() {
    const sheet = document.getElementById('cart-summary-sheet');
    if (!sheet) return;

    await renderCartSummaryIntoSheet();

    if (matchMedia('(min-width: 900px)').matches) return;
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

let cartSummaryGeneration = 0;
async function renderCartSummaryIntoSheet(snapshot) {
    const ticket = ++cartSummaryGeneration;
    const bodyEl = document.getElementById('cart-sheet-body');
    const subtitleEl = document.getElementById('cart-sheet-subtitle');
    if (!bodyEl || !subtitleEl) return;
    let cart;
    try { cart = snapshot || await getCartData(); }
    catch { if (ticket === cartSummaryGeneration) subtitleEl.textContent = 'Could not load the bill.'; return; }
    if (ticket !== cartSummaryGeneration) return;
    const lines = Array.isArray(cart) ? cart.filter(item => Number(item.quantity) > 0) : [];
    const quantity = lines.reduce((sum,item) => sum + Number(item.quantity),0);
    subtitleEl.textContent = quantity === 1 ? '1 item' : `${quantity} items`;
    bodyEl.replaceChildren();
    if (!lines.length) {
        const empty = document.createElement('p'); empty.textContent = 'No items in cart.'; bodyEl.append(empty); return;
    }
    const list = document.createElement('ul'); list.className = 'menu-basket-lines';
    for (const item of lines) {
        const row = document.createElement('li');
        const details = document.createElement('div');
        const name = document.createElement('strong'); name.translate = false;
        name.textContent = `${item.quantity} × ${window.ItemLanguage?.name(item) || item.name || ''}`;
        details.append(name);
        if (item.notes) { const note = document.createElement('p'); note.translate = false; note.textContent = item.notes; details.append(note); }
        const amount = document.createElement('span'); amount.translate = false;
        amount.textContent = CaptainMoney.display(Number(item.quantity) * unitPrice(item));
        row.append(details,amount); list.append(row);
    }
    const total = document.createElement('div'); total.className = 'menu-basket-total';
    const label = document.createElement('strong'); label.textContent = 'Total';
    const amount = document.createElement('strong'); amount.translate = false;
    amount.textContent = CaptainMoney.display(lines.reduce((sum,item)=>sum+Number(item.quantity)*unitPrice(item),0));
    total.append(label,amount); bodyEl.append(list,total);
}

/*
 * How many matched, in one small line.
 *
 * It had a heading's worth of space around it, which is a lot of a phone
 * screen to spend telling somebody how many things they can already see.
 */
function setSearchCount(text) {
    let line = document.getElementById('search-count');
    if (!line) {
        const host = document.querySelector('.product-search');
        if (!host) return;
        line = document.createElement('div');
        line.id = 'search-count';
        line.className = 'search-count';
        host.appendChild(line);
    }
    line.textContent = text || '';
}

/*
 * What somebody typed, ranked.
 *
 * THE ROWS ARE DRAWN BY MenuView, the same as the menu itself. They used to be
 * built here, separately, by a second copy of the card markup - and the two
 * copies had already drifted: one knew about discounts and the other did not,
 * and one subtracted what was in the cart from the stock count while the other
 * did not. Nobody decided either of those. They happened because the same
 * thing was written twice.
 */
let productSearchRevision = 0;
async function applyProductFilter() {
    const input = document.getElementById('product-search-input');
    if (!input) return;
    const revision = ++productSearchRevision;
    const query = input.value;
    const isCurrent = () => revision === productSearchRevision && input.value === query;

    /* "3 cb" is three of whatever "cb" finds. The number is remembered for
       the next add, then forgotten, so it cannot leak into a later tap. */
    const typed = ItemSearch.parseTerm(input.value.trim());
    window._pendingQuantity = typed.quantity;
    const term = typed.term.trim().toLowerCase();
    showQuantityHint(typed.quantity);
    if (term) window.MealMenu?.reset();

    /*
     * Searching is a different screen, and the keyboard has already taken
     * half of it. Everything that is not a result steps aside while there is
     * something in the box - see .is-searching in products/style.css.
     */
    const wasSearching = document.body.classList.contains('is-searching');
    document.body.classList.toggle('is-searching', !!term);
    setSearchCount('');

    const clear = document.getElementById('product-search-clear');
    if (clear) clear.hidden = !input.value;

    /* The header and the rail come and go with this state, so the sticky
       offsets they sit at are no longer the ones that were measured. */
    MenuScreen.stick();

    // 🔁 Box empty → the whole menu back, at the top of it
    if (!term) {
        await loadProducts(isCurrent);
        if (!isCurrent()) return;
        /* At the top, and only when a search actually ended. Leaving a search
           returns you to the menu, and the top is the honest place to be put
           back down - but scrolling on every keystroke that happens to clear
           the box would fight somebody who is still typing. */
        if (wasSearching) window.scrollTo({ top: 0 });
        return;
    }

    /*
     * Ranked search, not a substring test.
     *
     * `name.includes(term)` finds Chicken Biryani from "biry" and from nothing
     * else: not from "chick biry", because two words are never one substring,
     * and not from "cb", which is what somebody selling two hundred a day
     * actually types. See assets/common/item-search.js for the ranking.
     */
    const allFlatProducts = [];
    for (const [categoryKey, itemsArr] of Object.entries(products || {})) {
        if (categoryKey === 'all') continue;
        itemsArr.forEach(p => {
            allFlatProducts.push({ ...p, _categoryKey: categoryKey });
        });
    }

    /* Indexed once per render of the menu, not once per keystroke. */
    if (!window._itemSearchIndex || window._itemSearchIndexSize !== allFlatProducts.length) {
        window._itemSearchIndex = ItemSearch.index(allFlatProducts);
        window._itemSearchIndexSize = allFlatProducts.length;
    }

    const filtered = ItemSearch.search(window._itemSearchIndex, term, {
        /* What the shop actually sells, from the frequent items already
           fetched for the shortcuts row. Breaks ties only. */
        popular: window._frequentItemIds instanceof Set ? window._frequentItemIds : new Set(),
        /*
         * "chicken sixty five" finds Chicken 65 when typed out too.
         *
         * A deterministic rewrite, not a guess, and it runs only when the term
         * as typed found nothing - so no search that works today changes. NOT
         * `heard`: phonetic matching stays off for typing, because somebody
         * who types has seen what they typed and the same keystrokes must
         * always give the same order.
         */
        numbers: true,
    });

    // Load cart so qty / stock status stay correct
    const storedCart = await getCartData();
    if (!isCurrent()) return;
    const cartMap = cartProductMap(storedCart);

    const seenIds = new Set();
    const hits = [];
    for (const product of filtered) {
        if (seenIds.has(product.id)) continue;
        seenIds.add(product.id);
        hits.push(product);
    }

    const listEl = document.getElementById('product-list');

    /*
     * THE NUMBER ON THE WALL, ON THE SCREEN A WAITER SEARCHES.
     *
     * Owner: "number card use of that? how to use? i tried to search with that
     * number nothing happened."
     *
     * Nothing happened because the number lookup was only ever wired into the
     * Add item sheet. The card is printed for the whole shop and the screen
     * most orders start on could not answer it, so the feature was half built
     * and looked broken - which it was, from where he was standing.
     *
     * The same derivation as the card and the sheet: MenuView.numbers over the
     * shop's own menu order, so all three agree without anybody assigning
     * anything.
     */
    const menuForNumbers = Object.entries(products || {})
        .filter(([key]) => key !== 'all')
        .map(([key, items]) => ({
            key,
            name: (items[0] && items[0].category_name) || key,
            items,
        }));
    const numbers = MenuView.numbers(menuForNumbers);

    /*
     * THE LOOKUP, NOT THE BADGE.
     *
     * Passing `numbers` here draws the number on every row, which turned every
     * dish name into "1Chicken Biryani" and changed the look of the screen a
     * waiter uses forty times a service. He asked to be able to USE the
     * number, not to see it on every line. The Add item sheet still shows
     * them, because that is the screen somebody opens with the card in front
     * of them.
     */
    const options = {
        image: getLocalImageUrl,
        popular: window._frequentItemIds instanceof Set ? window._frequentItemIds : new Set(),
    };

    if (listEl) {
        /*
         * Results BEST FIRST, in one list, not regrouped by category.
         *
         * The menu is sectioned because a person browsing it is looking for a
         * kind of thing. Somebody who has typed four letters is looking for
         * one thing, and putting a heading above each result buries the best
         * match under the name of its category.
         */
        /*
         * THE OFFER BELONGS UNDER THE RESULTS TOO.
         *
         * Owner, twice, the second time furious: "i told you already... i
         * cant add 'fish' coz already fish briyani there and no way to add."
         *
         * It was offered only when a search found NOTHING, which is the rare
         * case. The common one is a search that finds something ELSE: typing
         * Fish finds Fish Curry, so the offer never came, and the + beside the
         * box is a 28px circle he has now looked straight past twice.
         *
         * So it is offered whenever what was typed is not the name of a dish
         * on the menu, under the results, where somebody who has just read
         * them and not found what they wanted is already looking.
         *
         * An exact name match suppresses it, because then the dish IS on the
         * menu and offering to invent a second one with the same name is how
         * a menu grows duplicates.
         */
        const typed = input.value.trim();
        const exact = hits.some(
            (p) => String(p.name || '').trim().toLowerCase() === typed.toLowerCase()
        );

        /*
         * A NUMBER TYPED IS A NUMBER MEANT - and also, sometimes, a name.
         *
         * The same rule the Add item sheet follows. Typing 33 puts dish 33
         * first, labelled; it does NOT replace the search, because in an
         * Indian kitchen a number IS a dish name - type 65 and a waiter may
         * well want Chicken 65. Both readings are offered and the waiter
         * picks, rather than one being guessed on their behalf.
         */
        const byNumber = /^[0-9]{1,4}$/.test(typed)
            ? MenuView.atNumber(menuForNumbers, typed)
            : null;
        const rest = byNumber
            ? hits.filter((p) => String(p.id) !== String(byNumber.id))
            : hits;

        const offer =
            '<div class="menu-quick-sale">' +
            '<button type="button" class="menu-quick-sale-btn" data-quick-sale="' +
            MenuView.escape(typed) +
            '">Add &ldquo;' +
            MenuView.escape(typed) +
            '&rdquo; with a price</button>' +
            '<p class="menu-quick-sale-why">For something the menu does not have. It is charged on this bill and stays off the menu.</p>' +
            '</div>';

        const numbered = byNumber
            ? '<div class="menu-section-head"><span class="menu-section-name"><span>No.</span> <bdi translate="no">' +
              MenuView.escape(typed) +
              '</bdi></span></div>' +
              '<div class="menu-section-items">' +
              MenuView.dish(byNumber, (cartMap.get(byNumber.id) || {}).quantity || 0, options) +
              '</div>'
            : '';

        listEl.innerHTML = (byNumber || rest.length)
            ? numbered +
              (rest.length
                ? '<div class="menu-section-items">' +
                  rest.map(p => MenuView.dish(p, (cartMap.get(p.id) || {}).quantity || 0, options)).join('') +
                  '</div>'
                : '') +
              (typed && !exact ? offer : '')
            : MenuView.nothing(
                'Nothing matches "' + input.value.trim() + '"',
                'Try fewer letters, or the first letters of each word - "cb" finds Chicken Biryani.'
              ) +
              /*
               * AND THE WAY OUT, WHERE THE WAITER ALREADY IS.
               *
               * Owner: "able to add item and price on demand."
               *
               * This is the exact moment somebody discovers the thing is not
               * on the menu - a bottle somebody brought in, a cake the kitchen
               * agreed to plate. Offering it here costs no room on a screen
               * used forty times a service, and it already knows what to call
               * it, because they just typed the name.
               */
              offer;
    }

    /* Said quietly, and only while it is worth saying. */
    setSearchCount(
        seenIds.size === 0
            ? ''
            : seenIds.size === 1
                ? '1 item'
                : seenIds.size + ' items'
    );

    const loader = document.getElementById('page-loader');
    if (loader) loader.style.display = 'none';

    // Sync frequent cards (if function exists)
    if (typeof syncFrequentQtyFromMain === 'function') {
        hits.forEach(p => syncFrequentQtyFromMain(p.id));
    }
}

/*
 * What is left of a dish, kept honest after a change.
 *
 * The row shows a count only when it is nearly gone: "47 left" is not
 * information a waiter needs while taking an order, and "2 left" is the whole
 * order. MenuView.stock decides where that line falls, so this and the row's
 * first draw cannot disagree about it.
 */
function updateStockBadgeForProduct(id) {
    let product;
    outer: for (const [key, itemsArr] of Object.entries(products || {})) {
        if (key === 'all') continue;
        for (const p of itemsArr) {
            if (p.id === id) {
                product = p;
                break outer;
            }
        }
    }
    if (!product) return;

    const shown = document.getElementById('qty-' + id);
    const quantity = shown ? parseInt(shown.textContent || '0', 10) || 0 : 0;
    if (typeof MenuScreen !== 'undefined') MenuScreen.setRow(id, quantity, product);
}

async function changeBranch() {
    try {
        // Flag: next time index.html opens, go to branch select
        localStorage.setItem('kiosk_force_branch_select', '1');

        // DO NOT remove kiosk_selected_branch here –
        // index.js will ignore it when force flag is set

        // Clear IndexedDB branch + products + cart
        const db = await getDB();
        const tx = db.transaction(
            [BRANCH_STORE, STORE_NAME, CART_STORE],
            'readwrite'
        );

        tx.objectStore(BRANCH_STORE).clear();
        tx.objectStore(STORE_NAME).clear();
        tx.objectStore(CART_STORE).clear();

        // Optional: wait for transaction to finish
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });

        // Go back to branch selection page
        window.location.href = 'index.html';
    } catch (e) {
        console.error('Failed to change branch:', e);
        // fallback: still try to go back
        window.location.href = 'index.html';
    }
}

// Back dismisses the top menu layer; it must not throw away the current cart.
window.addEventListener('captain:back', event => {
    if (event.defaultPrevented || document.querySelector('.modal.show, dialog[open]')) return;
    const cartNotes = document.getElementById('cart-notes-modal');
    if (cartNotes && cartNotes.style.display !== 'none' && cartNotes.getClientRects().length) {
        event.preventDefault(); document.getElementById('cart-notes-cancel-btn')?.click(); return;
    }
    const cancelOrder = document.getElementById('cancelModal');
    if (cancelOrder && cancelOrder.style.display !== 'none' && cancelOrder.getClientRects().length) {
        event.preventDefault(); closeCancelModal(); return;
    }
    const notes = document.getElementById('product-notes-modal');
    if (notes && notes.style.display !== 'none' && notes.getClientRects().length) {
        event.preventDefault();
        document.getElementById('notes-cancel-btn')?.click();
        return;
    }
    if (document.getElementById('menu-index') && !document.getElementById('menu-index').hidden) {
        event.preventDefault(); MenuScreen.closeIndex(); return;
    }
    if (document.getElementById('cart-summary-sheet')?.classList.contains('open')) {
        event.preventDefault(); closeCartSummarySheet(); return;
    }
    const search = document.getElementById('product-search-input');
    if (search && search.value) {
        event.preventDefault(); search.value = ''; applyProductFilter();
    }
});

matchMedia('(min-width: 900px)').addEventListener('change', () => {
    closeCartSummarySheet();
    void renderCartSummaryIntoSheet();
});
