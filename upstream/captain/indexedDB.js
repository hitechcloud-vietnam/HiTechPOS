// Serialize complete read/modify/write operations, not only IndexedDB writes.
// Otherwise two quick taps can save snapshots that erase each other's dishes.
let cartMutationTail = Promise.resolve();
function queueCartMutation(operation) {
    const pending = cartMutationTail.then(operation);
    cartMutationTail = pending.catch(() => {});
    return pending;
}
const cartActions = new Set();
function trackCartAction(action) {
    const pending = (async () => action())();
    cartActions.add(pending);
    pending.then(() => cartActions.delete(pending), () => cartActions.delete(pending));
    return pending;
}
function cartAction(action) {
    return function (...args) {
        return trackCartAction(() => action.apply(this, args));
    };
}
async function waitForCartMutations() {
    while (cartActions.size) await Promise.all(Array.from(cartActions));
    await cartMutationTail;
}

const DB_NAME = "KioskDB";
const DB_VERSION = 3;
const STORE_NAME = "products";
const BRANCH_STORE = "branch";
const CART_STORE = "cart";
const PHONEPE_STORE = "phonepe";
const IMAGE_STORE = "images";
const PAYMENT_STORE = "payment";

let db;
let cart = {}; // ✅ Cart stored in IndexedDB
let products = {};

/*
 * A thumbnail that is always SOMETHING.
 *
 * The cart line and the Frequently Ordered strip render a bare <img>, and a
 * dish with no photograph now carries an empty path rather than a placeholder
 * one - which would make those an `<img src="">`, and an empty src makes a
 * browser re-request the page itself.
 *
 * The menu does not use this: a row with no photograph draws the dish's icon,
 * which is better than a grey square forty times over. See
 * assets/common/menu-view.js.
 */
function thumbUrl(src) {
    return resolveLocalImageUrl(src) || "images/default-product.webp";
}

function resolveLocalImageUrl(src) {
    if (!src || typeof src !== "string") return src;

    let localOrigin = "";
    try {
        /* Images come from whichever server is answering, so the origin they
           resolve against moves with it. */
        localOrigin = POSNIC.server.imageOrigin || "";
    } catch (e) {
        localOrigin = "";
    }

    let resolvedUrl = localOrigin
        ? src.replace(/^http:\/\/(localhost|127\.0\.0\.1):5555/i, localOrigin)
        : src;

    /*
     * A RELATIVE PATH IS RELATIVE TO THE SERVER, NOT TO THE APP.
     *
     * Items carry paths like `/uploads/demo/rtl-sta-002.jpg`. In a browser
     * served BY the shop's server that resolves correctly and always has. In
     * the packaged app the page is served from http://localhost - so the same
     * path resolved to http://localhost/uploads/..., which is inside the APK,
     * and every item on the menu drew a broken image.
     *
     * Nothing in a browser test could see it: there the app and the images
     * share an origin, which is exactly the assumption the WebView breaks.
     */
    if (/^\//.test(resolvedUrl) && localOrigin) {
        resolvedUrl = localOrigin.replace(/\/+$/, '') + resolvedUrl;
    }

    try {
        if (!/^https?:\/\//i.test(resolvedUrl)) return resolvedUrl;
        const cacheKey = localStorage.getItem("POSNIC_IMAGE_CACHE_BUST");
        if (!cacheKey) return resolvedUrl;
        const url = new URL(resolvedUrl);
        url.searchParams.set("_posnic_img", cacheKey);
        return url.toString();
    } catch (e) {
        return resolvedUrl;
    }
}

function clearKioskLocalCache(options = {}) {
    const redirectTo = options.redirectTo || "index.html";
    const keepServer = options.keepServer !== false;

    const savedApiUrl = keepServer ? localStorage.getItem("POSNIC_API_URL") : null;
    const savedImageOrigin = keepServer ? localStorage.getItem("POSNIC_IMAGE_ORIGIN") : null;
    const imageCacheBust = String(Date.now());

    [
        "kiosk_takeaway_reservation",
        "kiosk_selected_branch",
        "kiosk_branch_list",
        "kiosk_force_branch_select",
        "branch_id",
        "kiosk_tableorders",
        "kiosk_table_service",
        "orderType",
        "lastActiveCategory",
        "kiosk_table_no",
        "kiosk_table_id",
        "kiosk_discount_percentage",
        "kiosk_discount_amount",
        "kiosk_discount_description"
    ].forEach(key => localStorage.removeItem(key));

    /* Changing servers outright also drops the sign-in credential: it names a
       user on the server being left behind. */
    if (!keepServer) localStorage.removeItem("POSNIC_TOKEN");

    if (keepServer && savedApiUrl) localStorage.setItem("POSNIC_API_URL", savedApiUrl);
    if (keepServer && savedImageOrigin) localStorage.setItem("POSNIC_IMAGE_ORIGIN", savedImageOrigin);
    localStorage.setItem("POSNIC_IMAGE_CACHE_BUST", imageCacheBust);

    return new Promise(resolve => {
        try {
            if (db) {
                db.close();
                db = null;
            }
        } catch (e) { /* ignore */ }

        try {
            const req = indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
        } catch (e) {
            resolve();
        }
    }).then(() => {
        window.location.href = redirectTo;
    });
}

async function refreshKioskData() {
    await clearKioskLocalCache({ keepServer: true, redirectTo: "index.html" });
}

// ✅ Open IndexedDB
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            let db = event.target.result;

            if (!db.objectStoreNames.contains("products")) {
                let productStore = db.createObjectStore("products", { keyPath: "id" });
                productStore.createIndex("category_name", "category_name", { unique: false });
            }

            if (!db.objectStoreNames.contains("branch")) {
                db.createObjectStore("branch", { keyPath: "id" });
            }

            if (!db.objectStoreNames.contains("cart")) {
                db.createObjectStore("cart", { keyPath: "id" });
            }

            if (!db.objectStoreNames.contains("images")) {
                db.createObjectStore("images", { keyPath: "id" }); // ✅ this is your missing one
            }

            if (!db.objectStoreNames.contains("phonepe")) {
                db.createObjectStore("phonepe", { keyPath: "id" });
            }

            if (!db.objectStoreNames.contains("payment")) {
                db.createObjectStore("payment", { keyPath: "id" });
            }

        };


        request.onsuccess = () => {
            db = request.result;
            console.log("✅ IndexedDB Opened Successfully");
            resolve(db);
        };

        request.onerror = (event) => {
            console.error("❌ IndexedDB Error:", event.target.error);
            reject(event.target.error);
        };
    });
}

async function saveKioskPaymentToIndexedDB(paymentData) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(PAYMENT_STORE, "readwrite");
        const store = tx.objectStore(PAYMENT_STORE);
        store.put({ id: "payment_type", ...paymentData });

        tx.oncomplete = () => {
            console.log("✅ Kiosk payment types saved to IndexedDB");
            resolve();
        };
        tx.onerror = (err) => {
            console.error("❌ Failed to save payment types:", err);
            reject(err);
        };
    });
}
async function getKioskPayment() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(PAYMENT_STORE, "readonly");
        const store = tx.objectStore(PAYMENT_STORE);
        const req = store.get("payment_type");

        req.onsuccess = () => resolve(req.result);
        req.onerror = (err) => reject(err);
    });
}

// ✅ Get IndexedDB instance
async function getDB() {
    if (!db) {
        db = await openDB();
    }
    return db;
}

// ✅ Fetch data from IndexedDB
async function getData(storeName) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readonly");
        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = (error) => reject(error);
    });
}

// ✅ Save Data to IndexedDB (Now Removes Outdated Products)
/**
 * PUT SOME ROWS WITHOUT THROWING THE REST AWAY.
 *
 * `saveData` below is a REPLACE: it clears the store and writes what it was
 * handed, which is exactly right for "here is the whole menu from the API" and
 * catastrophic for anything else.
 *
 * Two callers used it to save ONE dish. Owner, on the first: "i added one item
 * and try to search other items add nothing listed." He was not describing a
 * search bug. Adding a one-off item had deleted the entire menu and left the
 * one row behind, and search was reporting that honestly.
 *
 * The second was the sold-out long press, which meant a waiter marking one
 * dish as finished wiped every dish on the handset until the next full sync.
 * That shipped in v1.2.30.
 *
 * So: one door that replaces, one that does not, and the difference is in the
 * name rather than in a flag somebody has to remember.
 */
async function saveOne(storeName, rows) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);

        (Array.isArray(rows) ? rows : [rows]).forEach((row) => {
            if (row && row.id !== undefined) store.put(row);
        });

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

async function saveData(storeName, newData) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);

        // ✅ Fetch existing records
        const getAllRequest = store.getAll();
        getAllRequest.onsuccess = async () => {
            const existingData = getAllRequest.result;
            const existingIds = existingData.map(item => item.id);
            const newIds = newData.map(item => item.id);

            /*
             * WHAT THE MENU DOES NOT CARRY, AND SHOULD NOT LOSE.
             *
             * A quick sale item is INSTANT at the till, which keeps it out of
             * the menu this data comes from. Clearing the store therefore
             * deleted it, and every screen that looks a cart line up by id -
             * the stepper, the bill, the send - found nothing.
             *
             * Kept only for the CURRENT session's lines. These are not menu
             * rows and they are not stock; they exist because somebody sold
             * one this evening.
             */
            const keepInstant = existingData.filter(
                (row) => row && row.instant === true && !newIds.includes(row.id)
            );

            // ✅ Remove outdated items that are no longer in API response
            existingIds.forEach(id => {
                if (!newIds.includes(id)) {
                    store.delete(id);
                    console.log(`🗑️ Removed outdated product: ${id}`);
                }
            });

            // ✅ Clear and insert new data
            store.clear();
            newData.forEach(item => store.put(item));
            keepInstant.forEach(item => store.put(item));

            transaction.oncomplete = () => {
                console.log(`✅ Updated ${storeName} in IndexedDB`);
                resolve();
            };
            transaction.onerror = (error) => {
                console.error("❌ Transaction Error:", error);
                reject(error);
            };
        };
        getAllRequest.onerror = reject;
    });
}

async function saveKioskImagesToIndexedDB(images) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IMAGE_STORE, "readwrite");
        const store = tx.objectStore(IMAGE_STORE);
        store.put({ id: "kiosk", ...images });

        tx.oncomplete = () => {
            console.log("✅ Kiosk images saved to IndexedDB");
            updateKioskImageUI(images);
            resolve();
        };
        tx.onerror = (err) => {
            console.error("❌ Failed to save kiosk images:", err);
            reject(err);
        };
    });
}

async function getKioskImages() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IMAGE_STORE, "readonly");
        const store = tx.objectStore(IMAGE_STORE);
        const req = store.get("kiosk");

        req.onsuccess = () => resolve(req.result);
        req.onerror = (err) => reject(err);
    });
}

function updateKioskImageUI(data = {}) {
    const getImagePath = (val, fallback) => {
        try {
            if (!val || typeof val !== "string" || val.trim() === "") return `images/${fallback}`;
            return val.startsWith("http") ? val : `images/${val}`;
        } catch (err) {
            console.warn("⚠️ Error in getImagePath fallback:", err);
            return `images/${fallback}`;
        }
    };

    // ✅ Company Logo
    const logoPath = getImagePath(data.logo, "logo.png");
    $('img[alt="Company Logo"]').attr("src", logoPath);

    // ✅ Advertisement
    const adPath = getImagePath(data.advertisement, "banner1.jpg");
    $('img[alt="Advertisement"]').attr("src", adPath);

    // ✅ Banner background (e.g. top section)
    const bannerPath = getImagePath(data.banner, "banner.jpg");
    $('.top-banner').css("background-image", `url("${bannerPath}")`);

    // ✅ Homepage background image
    if (document.body.classList.contains("home-page")) {
        // const homeBanner = getImagePath(data.homebanner, "home.webp");
        const homeBanner = "images/home.webp";
        document.body.style.background = `url('${homeBanner}') no-repeat center center fixed`;
        document.body.style.backgroundSize = "cover";
    }

    console.log("✅ Kiosk UI Images Updated", {
        logoPath, adPath, bannerPath, homebanner: data.homebanner
    });
}




// ✅ Fetch and Store Branch Data
async function fetchAndStoreBranch(branchId, redirect = true, refreshUI = true, preserveCart = false) {
    try {
        const db = await getDB();
        const existingBranches = await getData(BRANCH_STORE);

        if (existingBranches.some(b => b.id === branchId)) {
            console.log("🔹 Branch exists. Checking for product updates...");
        }

        // ✅ Fetch products from API
        const result = await POSNIC.api.post("/items/accessQr", { branch: branchId });

        if (!localStorage.getItem("POSNIC_IMAGE_CACHE_BUST")) {
            localStorage.setItem("POSNIC_IMAGE_CACHE_BUST", String(Date.now()));
        }
        console.log("🔄 API Response:", result);

        if (result.type === "success" && result.data) {
            if (result.data.money && window.CaptainMoney) {
                CaptainMoney.remember(result.data.money);
                CaptainMoney.remember(result.data.money, branchId);
            }
            window.ServiceDetails?.remember?.(result.data.restaurant_service_v1, branchId);
            let products = [];

            const categories = result.data.products;
            const kioskImages = result.data.kiosk_images;
            const tableorders = result.data.tableorders || [];
            localStorage.setItem('kiosk_tableorders', JSON.stringify(tableorders));

            /*
             * WHETHER THIS SHOP DOES TABLE SERVICE AT ALL.
             *
             * An empty floor plan means two completely different things: a
             * restaurant that has not typed its tables in yet, and a shop that
             * does not seat anybody. Both arrived as an empty array, so the
             * handset drew the same bare "Enter Table Number" box for a waiter
             * at a restaurant mid-setup and for somebody signing in at a
             * grocer, and told neither of them which.
             *
             * The server sends the branch's own switch now, so the screen can
             * say the true thing. Stored as a string because localStorage has
             * no other kind, and read back with an explicit compare - '' and
             * 'false' are both truthy here, which is how a switch ends up
             * permanently on.
             */
            localStorage.setItem(
                'kiosk_table_service',
                result.data.table_service === true ? 'yes' : 'no'
            );

            /*
             * What this SHOP decided about voice ordering.
             *
             * Kept separately from what this DEVICE was told, because they are
             * different decisions and the device's own wins: a handset with a
             * broken microphone can be switched off without touching the shop.
             * See assets/common/speech.js for the order they are read in.
             *
             * Where the audio goes and in what language, never which vendor
             * transcribes it and never a key. The server derives it; a phone
             * that knew the vendor is a phone that would eventually be asked
             * to hold the key for it.
             */
            try {
                localStorage.setItem('posnic.voice.shop', JSON.stringify(result.data.voice || {}));
            } catch (e) {
                /* private mode: this session still runs on the default */
            }

            // 🔴 IF NO PRODUCTS → show error, then force Choose Branch AFTER OK
            if (!Array.isArray(categories) || categories.length === 0) {
                // Refresh failures preserve the current shop, cached menu and draft.
                if (!redirect) return false;
                /*
                 * AN EMPTY MENU IS NOT A REASON TO FORGET WHICH SHOP THIS IS.
                 *
                 * This used to clear the branch and force the picker on the
                 * next load - so a waiter whose menu failed to load was asked
                 * to choose a branch, about a problem choosing cannot fix. For
                 * a shop with one branch it asked them to choose between one
                 * thing, which is not a question.
                 *
                 * Only offered where it could possibly help: more than one
                 * branch to move between. Otherwise the branch is kept and the
                 * waiter is told what is actually wrong.
                 */
                let branchCount = 1;
                try {
                    branchCount = (JSON.parse(localStorage.getItem("kiosk_branch_list") || "[]") || []).length;
                } catch (e) {
                    branchCount = 1;
                }

                if (branchCount > 1) {
                    localStorage.removeItem("kiosk_selected_branch");
                    localStorage.setItem("kiosk_force_branch_select", "1");
                }

                hideLoader();

                showErrorPopup(
                    branchCount > 1
                        ? "This branch has no items to sell yet. Try another branch, or ask your manager to add items."
                        : "This shop has no items to sell yet. Ask your manager to add them, then try again.",
                    function () {
                        // user OK button press pannina apram dhaan redirect / reload
                        if (!window.location.pathname.endsWith("index.html")) {
                            window.location.href = "index.html";
                        } else {
                            window.location.reload();
                        }
                    }
                );

                return;  // don't save / don't redirect
            }
            if (kioskImages) {
                const extractFilename = (url, fallback) => {
                    try {
                        if (url && typeof url === 'string' && url.trim() !== '') {
                            const file = url.split('/').pop().split('?')[0];
                            return file || fallback;
                        }
                    } catch (e) {
                        console.warn("❌ Invalid URL for kiosk image:", url);
                    }
                    return fallback;
                };

                await saveKioskImagesToIndexedDB({
                    homebanner: extractFilename(kioskImages.homebanner, "home.webp"),
                    logo: extractFilename(kioskImages.logo, "logo.png"),
                    banner: extractFilename(kioskImages.banner, "banner.jpg"),
                    advertisement: extractFilename(kioskImages.advertisement, "banner1.jpg")
                });
            }

            /*
             * THE SHOP'S OWN ORDER, KEPT.
             *
             * A menu is not alphabetical and it is not arbitrary: starters
             * come before mains and desserts come last, because that is the
             * order somebody eats in and the order the shop arranged its card
             * in. The server sends the categories that way.
             *
             * It was thrown away here, and IndexedDB's getAll() hands rows back
             * sorted by id - so the menu came out in whatever order the items
             * happened to be created, which put Desserts second on a real
             * shop's menu. Both positions are recorded so the screen can put
             * the card back the way the shop wrote it.
             */
            categories.forEach((category, categoryIndex) => {
                category.items.forEach((item, itemIndex) => {
                    /*
                     * NO PHOTOGRAPH MEANS NO PHOTOGRAPH.
                     *
                     * This used to substitute images/default-product.webp, so
                     * a shop that had uploaded no pictures - which is most of
                     * them - got the same grey square forty times down the
                     * menu. That reads as an app that failed to load rather
                     * than a menu without pictures.
                     *
                     * Left empty, the row draws the dish's own icon instead,
                     * chosen on the server so this app, the kiosk and a QR
                     * code all show the same thing for the same dish. See
                     * assets/common/menu-view.js.
                     */
                    const photo = item.img || item.image || item.item_image;
                    const hasPhoto = typeof photo === 'string' && photo.trim() !== '' && photo !== 'item.svg';

                    products.push({
                        id: item.id?.$oid || item.id?.toString() || Date.now(),
                        name: item.name || "Unknown",
                        ...window.PosnicItemText.snapshot(item),
                        available_quantity: item.available_quantity || 0,
                        negative_stock: !!item.negative_stock,
                        // ✅ use backend fields as-is
                        price: parseFloat(item.final_price) || 0,   // display amount
                        selling_price: Number(item.price),
                        discount_price: parseFloat(item.discount_price) || 0,  // 6.56
                        tax_price: parseFloat(item.tax_price) || 0,   // 44.10
                        tax: Math.max(0, Number(item.tax) || 0),
                        tax_type: item.tax_type,
                        subtotal: parseFloat(item.price) || 0,   // 164.06
                        final_price: parseFloat(item.final_price) || 0,   // 201.60
                        img: hasPhoto ? resolveLocalImageUrl(photo) : "",
                        /*
                         * The emoji for this dish, picked from its name by the
                         * server. Empty when the name suggests nothing, which
                         * is an honest answer rather than a gap.
                         */
                        icon: item.icon || "",
                        serving_periods: Array.isArray(item.serving_periods) ? item.serving_periods : [],
                        serving_time_zone: item.serving_time_zone || "",
                        category_name: category.category_name,
                        category_sort: categoryIndex,
                        item_sort: itemIndex,
                        /*
                         * The veg mark and the kitchen's timing. Both have been
                         * in this response for months and neither was ever
                         * stored, so the screen could not have shown them even
                         * once it had somewhere to put them.
                         */
                        diet: item.diet || "",
                        prep_minutes: Number(item.prep_minutes) || 0,
                        /* The dish's own description, for the menu row. */
                        description: item.description || "",
                        /*
                         * NOT THE NOTE. THE NOTE IS WHAT A WAITER TYPED.
                         *
                         * This used to seed item_description with the dish's
                         * own description, calling it a default note. But
                         * item_description is the note everywhere else: the
                         * till stores the waiter's words in it, the KOT view
                         * reads it as a note, and the notes box writes it.
                         *
                         * So every dish arrived carrying its menu copy as a
                         * note, and the kitchen printed it:
                         *
                         *   MIXED TANDOORI CHICKEN PLATTER            x1
                         *     ** A platter of the tandoor's chicken: kebabs,
                         *     tikka and wings, served sizzling with onion and
                         *     lime. Built to share. **
                         *
                         * That is writing for a guest choosing dinner, not an
                         * instruction for somebody cooking it. A ticket that
                         * long for two dishes is one a cook stops reading, and
                         * the one line that mattered - no onion - would be
                         * somewhere in the middle of it.
                         *
                         * The description is still carried above, for the menu
                         * row that is meant to show it.
                         */
                        /*
                         * HOW THIS DISH IS PRICED.
                         *
                         * `open_price` means the price is settled at the
                         * counter, every time. `daily_price` means it comes
                         * from the morning's market, and `price_set_on` says
                         * when somebody last entered it - priced today it is
                         * an ordinary dish, priced yesterday it is not,
                         * because yesterday's rate for a pomfret is not
                         * today's.
                         *
                         * THIS LIST IS A WHITELIST, and that is the whole
                         * reason these are here. A field the server sends and
                         * this loop does not name is gone by the time any
                         * screen sees it - open_price was read by the menu row
                         * for months and never once arrived. See askPrice in
                         * assets/common/menu-view.js.
                         */
                        open_price: item.open_price === true,
                        daily_price: item.daily_price === true,
                        price_set_on: item.price_set_on || "",
                        /*
                         * The shop's option sets for this dish - extra cheese,
                         * half plate, how spicy - whole, with their prices.
                         *
                         * A field this loader does not NAME is dropped. That is
                         * how open_price was dead for months, and how the
                         * extras stayed invisible here while the till offered
                         * them and expected somebody to charge for them.
                         */
                        modifier_groups: Array.isArray(item.modifier_groups)
                            ? item.modifier_groups
                            : []
                    });
                });
            });

            // ✅ Save branch & products in IndexedDB
            // also persist the MongoDB branch_id (may differ from storeId/branchId)
            const actualBranchId = localStorage.getItem('branch_id') || branchId;
            await saveData(BRANCH_STORE, [{ id: branchId, branch_id: actualBranchId, kioskPayment: result.data.kiosk_payment }]);
            await saveData(STORE_NAME, products);

            console.log("✅ Product data updated successfully!");

            const kioskPayment = result.data.kiosk_payment;
            if (kioskPayment) {
                await saveKioskPaymentToIndexedDB(kioskPayment);
            }

            // ✅ Only validate cart + reload UI when we are actually refreshing the screen
            // ✅ Update cart + UI based on mode
            if (preserveCart) {
                // A deliberate menu refresh never discards the order being taken.
                await loadProducts();
            } else if (refreshUI) {
                // normal flow (login / first load / manual refresh): clean cart + reload UI
                await validateCartWithProducts(products);
                await loadProducts();
            } else {
                // background flow: clean cart ONLY, UI stays as-is
                await syncCartSilently(products);
                console.log("✅ Products and cart updated silently in background");
            }

            if (redirect) {
                // set a default order type since home.html will be skipped
                if (!localStorage.getItem("orderType")) {
                    localStorage.setItem("orderType", "Dine-in"); // or "PARCEL"
                }
                hideLoader();
                window.location.href = "kot-management.html";
                return;
            }
        } else {
            console.warn("❌ No data received from API.");
            return false;
        }
    } catch (error) {
        console.error("❌ Error updating product data:", error);
        throw error;
    }
}


function validateCartWithProducts(updatedProducts) {
    return queueCartMutation(() => validateCartWithProductsNow(updatedProducts));
}
async function validateCartWithProductsNow(updatedProducts) {
    const cartData = await getCartData();
    const productMap = new Map(updatedProducts.map(p => [p.id, p])); // 🔁 Map for quick access

    // 🔄 Update cart items with latest product info
    const syncedCart = cartData
        .map(item => {
            const updatedProduct = productMap.get(cartProductId(item));

            /*
             * A ONE-OFF HAS NO DISH BEHIND IT, AND THAT IS NOT AN ERROR.
             *
             * The same rule as syncCartSilently below, and this is the copy
             * that actually ran: the cart page refreshes the branch in the
             * FOREGROUND, so fixing only the silent one left the line being
             * deleted on the way to the screen meant to show it. Two functions
             * doing one job, and a fix that landed in one of them.
             *
             * A quick sale is INSTANT at the till, which keeps it off the menu
             * on purpose. The line carries its own name and price, which is
             * all the bill and the kitchen ticket need.
             */
            if (!updatedProduct && item && item.instant === true) {
                return item;
            }

            // product not found in latest list → remove from cart
            if (!updatedProduct) {
                return null;
            }

            const allowNegative = updatedProduct?.negative_stock === true;
            if (updatedProduct && (allowNegative || (updatedProduct.available_quantity || 0) > 0)) {
                return {
                    ...item,
                    name: updatedProduct.name,
                    ...window.PosnicItemText.snapshot(updatedProduct),
                    img: updatedProduct.img,
                    icon: updatedProduct.icon || "",
                    price: Number(updatedProduct.price || item.price || 0),
                    selling_price: updatedProduct.selling_price ?? updatedProduct.subtotal,
                    discount_price: Number(updatedProduct.discount_price || item.discount_price || 0),
                    tax_price: Number(updatedProduct.tax_price || item.tax_price || 0),
                    subtotal: Number(updatedProduct.subtotal || item.subtotal || 0),
                    final_price: Number(updatedProduct.final_price || item.final_price || 0),
                };
            }
            return null; // Item no longer exists OR disabled for kiosk
        })
        .filter(Boolean);

    if (syncedCart.length !== cartData.length) {
        console.log("🗑️ Removed outdated cart items.");
    } else {
        console.log("🔄 Synced cart items with latest product data.");
    }

    await saveCartData(syncedCart);
    if (window.location.pathname.includes('cart.html')) {
        renderCart(syncedCart);
    }
}

function syncCartSilently(updatedProducts) {
    return queueCartMutation(() => syncCartSilentlyNow(updatedProducts));
}
async function syncCartSilentlyNow(updatedProducts) {
    const cartData = await getCartData();
    const productMap = new Map(updatedProducts.map(p => [p.id, p]));

    const syncedCart = cartData
        .map(item => {
            const updatedProduct = productMap.get(cartProductId(item));
            if (updatedProduct) {
                return {
                    ...item,
                    name: updatedProduct.name,
                    ...window.PosnicItemText.snapshot(updatedProduct),
                    img: updatedProduct.img,
                    icon: updatedProduct.icon || "",
                    price: updatedProduct.price,
                    selling_price: updatedProduct.selling_price ?? updatedProduct.subtotal,
                    subtotal: updatedProduct.subtotal,
                    final_price: updatedProduct.final_price,
                    tax_price: updatedProduct.tax_price,
                };
            }
            /*
             * A ONE-OFF HAS NO DISH BEHIND IT, AND THAT IS NOT AN ERROR.
             *
             * This dropped any line whose product is not in the latest menu,
             * which is right for a dish the shop has deleted and wrong for a
             * quick sale: those are INSTANT at the till precisely so they stay
             * off the menu. The line carries its own name and price, which is
             * everything the bill and the kitchen ticket need.
             */
            if (item && item.instant === true) return item;

            // product not found in latest list → remove from cart
            return null;
        })
        .filter(Boolean);

    if (syncedCart.length !== cartData.length) {
        console.log("🗑️ [silent] Removed outdated cart items.");
    }

    await saveCartData(syncedCart);   // no renderCart, no redirect
}

// ✅ Optimized renderCart function
/*
 * THE BILL. The screen a waiter reads back to the table.
 *
 * Rewritten with the menu, because tapping "View bill" used to leave one
 * design and arrive in another, and an app that changes character between two
 * screens somebody crosses forty times a night does not read as one app.
 *
 * Three things were wrong beyond the look, and all three are fixed here:
 *
 *   THE NAMES WERE CUT at twenty-five characters with an ellipsis, in
 *   JavaScript, on the one screen that gets read out loud to a customer.
 *
 *   EVERY LINE HAD ITS OWN ACCORDION holding that line's subtotal, discount
 *   and tax. Nobody adds up twelve accordions. The question is what the WHOLE
 *   thing comes to, and it is asked once, at the bottom.
 *
 *   NOTHING WAS ESCAPED. Dish names come from the shop's own database and
 *   notes now come from a speech recogniser, and both went into innerHTML raw.
 */
async function renderCart(cartData = null, skipRedirect = false) {
    try {
        if (!cartData) {
            cartData = await getCartData();
        }

        const host = document.getElementById('cart-summary');
        const loader = document.getElementById('page-loader');

        if (cartData.length === 0) {
            $("#next-btn").prop("disabled", true);
            $("#cart-total,#cart-qty,#mobile-cart-count").text("0.00");
            $("#summary-display").text(I18N.t('{0} Items | {1}').replace('{0}', '0').replace('{1}', CaptainMoney.display(0)));
            setBillTotals(null);

            if (host) {
                host.innerHTML =
                    '<div class="bill-empty">' +
                    '<div class="bill-empty-face">\u{1f9fe}</div>' +
                    '<div class="bill-empty-said">Nothing on this bill yet</div>' +
                    '<div class="bill-empty-why">Add something from the menu and it will show up here.</div>' +
                    '<a href="products.html">Back to the menu</a>' +
                    '</div>';
            }

            /*
             * AND NO TIMED REDIRECT.
             *
             * This used to throw you back to the table list two seconds after
             * you removed the last line - the app deciding you had finished.
             * Somebody who takes an item off is usually about to add a
             * different one, and being moved mid-thought is how an order gets
             * started again from scratch. The way back is a button now, which
             * is a decision rather than a countdown.
             *
             * skipRedirect stays in the signature because callers still pass
             * it, and one of them is a queue flush that must not navigate.
             */
            if (loader) loader.style.display = 'none';
            return;
        }

        let totalQty = 0;
        let subtotalAll = 0;
        let discountAll = 0;
        let taxAll = 0;
        let totalPrice = 0;
        let html = '';

        for (const item of cartData) {
            const qty = item.quantity || 0;
            const asked = Number(item.askedPrice) || 0;
            /* Today's price is the whole price: the catalogue has no rate for
               this dish, so it has no discount or tax on it either. */
            const subtotal = asked > 0 ? asked : Number(item.subtotal || 0);
            const discountUnit = asked > 0 ? 0 : Number(item.discount_price || 0);
            const taxUnit = asked > 0 ? 0 : Number(item.tax_price || 0);
            const finalUnit = unitPrice(item);

            const lineSubtotal = subtotal * qty;
            const lineDiscount = discountUnit * qty;
            const lineTax = taxUnit * qty;
            const lineFinal = finalUnit ? finalUnit * qty : lineSubtotal - lineDiscount + lineTax;

            totalQty += qty;
            subtotalAll += lineSubtotal;
            discountAll += lineDiscount;
            taxAll += lineTax;
            totalPrice += lineFinal;

            const id = billText(item.id);

            /* The photograph, or the dish's own icon - the same fallback the
               menu uses, so a shop with no pictures looks deliberate on both
               screens rather than broken on one. */
            const thumb = item.img
                ? '<img class="bill-thumb" src="' + billText(thumbUrl(item.img)) + '" alt="">'
                : '<div class="bill-thumb" aria-hidden="true">' + billText(item.icon || '\u{1f37d}') + '</div>';

            html +=
                '<div class="bill-line" id="cart-item-' + id + '">' +
                thumb +
                '<div class="bill-body">' +
                /* WHOLE. Wrapped by CSS at two lines, never cut at
                   twenty-five characters in JavaScript. */
                '<p class="bill-name" translate="no">' + billText(window.ItemLanguage.name(item)) + '</p>' +
                /*
                 * What the table asked for on it, under the name where a note
                 * already goes. A waiter reading back an order needs to see
                 * "extra cheese" on the line, not only on the kitchen ticket:
                 * the whole reason this was typed into the notes box for years
                 * is that it is the first thing anybody checks.
                 *
                 * Without a price. The till prices these and this screen has
                 * not asked it yet, and a number here that turned out to be a
                 * different number on the bill would be worse than none.
                 */
                ((item.modifiers || []).length
                    ? '<div class="bill-note bill-extras" translate="no">' +
                      billText(item.modifiers.map((one) => one.name).join(', ')) +
                      '</div>'
                    : '') +
                (item.notes ? '<div class="bill-note" translate="no">' + billText(item.notes) + '</div>' : '') +
                ServiceDetails.summary(item) +
                '<div class="bill-item-actions" role="group" aria-label="Item options">' +
                '<button type="button" class="bill-note-action"><i class="fas fa-pen" aria-hidden="true"></i><span>Note</span></button>' +
                (ServiceDetails.supported() ? '<button type="button" class="preparation-link bill-preparation-action" data-preparation-cart="' + id + '" aria-label="Preparation" title="Preparation"><i class="fas fa-sliders-h" aria-hidden="true"></i></button>' : '') +
                '</div>' +
                /*
                 * TODAY'S PRICE CAN BE CORRECTED HERE.
                 *
                 * A dish priced on the day is whatever the waiter was told
                 * this morning, typed into a box - and 850 for a lobster that
                 * costs 8500 is one missed key. The menu screen deliberately
                 * does not ask again when a second plate is added, because the
                 * table was quoted once, so without this the only way back is
                 * to strike the line off and start it again.
                 *
                 * Only for a line that carries one: an ordinary dish is priced
                 * by the shop, and a waiter must not be able to retype that.
                 */
                (askedOn(item)
                    ? '<button type="button" class="bill-each is-askable" data-bill="price" data-id="' +
                      id + '" aria-label="Change today&#39;s price">' +
                      billText(I18N.t('{0} each').replace('{0}', CaptainMoney.display(finalUnit))) + '</button>'
                    : '<div class="bill-each">' + billText(I18N.t('{0} each').replace('{0}', CaptainMoney.display(finalUnit))) + '</div>') +
                '</div>' +
                '<div class="bill-right">' +
                '<span class="bill-amount">' + CaptainMoney.html(lineFinal) + '</span>' +
                '<div class="bill-step">' +
                '<button type="button" data-bill="less" data-id="' + id + '" aria-label="One fewer">&minus;</button>' +
                '<span class="bill-qty" id="qty-' + id + '">' + qty + '</span>' +
                '<button type="button" data-bill="more" data-id="' + id + '" aria-label="One more">+</button>' +
                '</div>' +
                '</div>' +
                '</div>';
        }

        if (host) host.innerHTML = html;

        setBillTotals({
            subtotal: subtotalAll,
            discount: discountAll,
            tax: taxAll,
            total: totalPrice,
            quantity: totalQty,
        });

        $("#summary-display").text(I18N.t('{0} Items | {1}').replace('{0}', totalQty).replace('{1}', CaptainMoney.display(totalPrice)));
        $('#cart-qty,#mobile-cart-count').text(totalQty);
        $("#cart-total").text(CaptainMoney.display(totalPrice));
        $("#next-btn").prop("disabled", totalQty === 0);

        if (loader) loader.style.display = 'none';
    } catch (error) {
        console.error("❌ Error rendering cart:", error);
    }
}

/*
 * The steppers, delegated.
 *
 * Bound once rather than written into every row as an onclick. An onclick
 * carrying an id is a string containing that id, so a dish whose name or id
 * holds an apostrophe ends the attribute early and the button silently stops
 * working - which is the kind of thing that happens to one shop's menu and
 * nobody else's.
 */
document.addEventListener('click', function (event) {
    const button = event.target.closest && event.target.closest('[data-bill]');
    if (!button) return;
    const what = button.getAttribute('data-bill');
    if (what === 'price') {
        changeTodaysPrice(button.getAttribute('data-id'));
        return;
    }
    updateCartQuantity(button.getAttribute('data-id'), what === 'more' ? 1 : -1);
});

/**
 * Ask again for today's price on a line that already has one.
 *
 * Opened with the number already in the box, so correcting a missed key is one
 * edit rather than a retype - and cancelling leaves the line exactly as it
 * was, the same bargain the question makes when a dish is first added.
 *
 * A quantity change of ZERO: updateQuantity re-quotes a line whenever it is
 * handed a price, so the count is untouched and every screen redraws itself.
 */
async function changeTodaysPrice(id) {
    if (!id || !window.POSNIC || typeof POSNIC.askPrice !== 'function') return;
    const line = (await getCartData()).find((row) => String(row.id) === String(id));
    if (!line) return;

    const asked = await POSNIC.askPrice(line.name, line.askedPrice);
    if (!asked) return;

    await updateQuantity(id, 0, { askedPrice: asked });
    await renderCart();
}

/*
 * Text that cannot become markup.
 *
 * Dish names come from the shop's own database and notes now come from a
 * speech recogniser, and both went into innerHTML raw. Neither is a stranger's
 * input, which is why it never broke - but "never broke" is not the same as
 * safe.
 */
function billText(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/*
 * What the whole bill comes to, in one place.
 *
 * A row is drawn only when it says something. A shop that charges no tax does
 * not need a line reading "Tax 0.00", and a bill with no discount does not
 * need to be told so - every row that is always there is a row nobody reads.
 */
function setBillTotals(totals) {
    const host = document.getElementById('bill-totals');
    if (!host) return;

    if (!totals || !totals.quantity) {
        host.innerHTML = '';
        host.hidden = true;
        return;
    }
    host.hidden = false;

    const money = (n) => CaptainMoney.display(n);
    let rows = '';

    /* Subtotal is only worth a line when something happens BELOW it. With no
       discount and no tax it is the total, said twice. */
    if (totals.discount > 0 || totals.tax > 0) {
        rows += '<div class="bill-row"><span>Subtotal</span><span>' + money(totals.subtotal) + '</span></div>';
    }
    if (totals.discount > 0) {
        rows += '<div class="bill-row is-off"><span>Discount</span><span>-' + money(totals.discount) + '</span></div>';
    }
    if (totals.tax > 0) {
        rows += '<div class="bill-row"><span>Tax</span><span>' + money(totals.tax) + '</span></div>';
    }
    rows += '<div class="bill-row is-total"><span>Total</span><span>' + money(totals.total) + '</span></div>';

    host.innerHTML = rows;

    /* And on the button that commits it, so the amount and the action are one
       thing rather than two places to look. */
    const amount = document.getElementById('bill-send-amount');
    if (amount) amount.textContent = money(totals.total);
}

// ✅ Optimized remove function: No redundant IndexedDB calls
function removeCartItem(id) {
    return queueCartMutation(() => removeCartItemNow(id));
}
async function removeCartItemNow(id) {
    let cartData = await getCartData();
    cartData = cartData.filter(i => i.id !== id); // 🔥 Remove from IndexedDB cart

    await saveCartData(cartData);

    // 🔥 Immediately remove from UI
    $(`#cart-item-${id}`).remove();

    // ✅ Pass updated cartData directly to renderCart
    renderCart(cartData);
}

// ✅ Optimized update function: Prevents multiple IndexedDB calls
function updateCartQuantity(id, change) {
    return queueCartMutation(() => updateCartQuantityNow(id, change));
}
async function updateCartQuantityNow(id, change) {
    const storedProducts = await getData("products");
    let cartData = await getCartData();
    let totalQty = 0;
    let item = cartData.find(i => i.id === id);
    if (!item) return;
    const storedProduct = storedProducts.find(product => product.id === cartProductId(item));

    const allowNegative = storedProduct?.negative_stock === true;
    const totalStock = storedProduct?.available_quantity || 0;

    // 🔒 Block increment if already reached available stock (only for non-negative-stock)
    if (!allowNegative && change > 0 && cartProductQuantity(cartData, cartProductId(item)) + change > totalStock) {
        return; // nothing to do
    }

    item.quantity += change;

    cartData.forEach(it => {
        totalQty += it.quantity;
    });

    $("#checkout-btn").prop("disabled", false);
    if (totalQty <= 0) {
        $("#checkout-btn").prop("disabled", true);
    }

    if (item.quantity <= 0) {
        cartData = cartData.filter(i => i.id !== id);
        $(`#cart-item-${id}`).remove();
    }

    await saveCartData(cartData);
    renderCart(cartData);
}

/*
 * The menu, drawn once, top to bottom.
 *
 * WHAT THIS USED TO DO. It built a chip per category and drew ONE category at
 * a time, swapping the whole list on every tap. That is the kiosk pattern, and
 * a waiter is not a kiosk: a table orders a biryani, a Coke and a gulab jamun,
 * so every third item cost a tap back up to the rail, a rebuilt list, and the
 * scroll position gone.
 *
 * Now the whole menu is drawn in sections and the chips became an INDEX - they
 * jump you to a section, and scrolling to a section lights the chip. Nothing
 * is ever rebuilt, so no place is ever lost. See assets/products/menu.js.
 */
async function loadProducts(shouldRender = () => true) {
    const storedProducts = await getData("products");
    if (!shouldRender()) return;

    products = {};

    /*
     * "Uncategorised" rather than a crash.
     *
     * category_name is whatever the shop typed, and an item saved before the
     * field existed has none - on which the old `.toLowerCase()` threw, and
     * the menu stopped drawing at that item. One bad row hid the rest of the
     * shop's menu.
     */
    for (const product of storedProducts) {
        const name = String(product.category_name || 'Uncategorised');
        const key = name.toLowerCase().replace(/\s/g, "_") || 'uncategorised';
        if (!products[key]) products[key] = [];
        products[key].push({ ...product, category_name: name, _categoryKey: key });
    }

    /* Still built, because search and the voice matcher both read it. It is
       not drawn: MenuView skips it, or the menu would appear twice. */
    const allProducts = [];
    Object.values(products).forEach(arr => allProducts.push(...arr));
    products["all"] = allProducts;
    window._itemSearchIndex = null;

    /*
     * DRAWING IS THE MENU SCREEN'S JOB, and only the menu screen has one.
     *
     * indexedDB.js is loaded by every page. Login calls this the moment a
     * branch's items arrive, to fill `products` before it redirects - and on
     * THAT page there is no #product-list, no MenuView and no MenuScreen.
     *
     * Reaching for them anyway threw a ReferenceError inside an await, which
     * does not stop the page or print anything a person would see: the login
     * simply never redirected, and the screen sat there looking like a server
     * that had not answered. Exactly the shape of the bug that cost a day in
     * assets/common/self-test.js, in a different file.
     *
     * So the menu is built for whoever asked, and drawn only where there is
     * somewhere to draw it.
     */
    const listEl = document.getElementById('product-list');
    if (!listEl || typeof MenuScreen === 'undefined' || typeof MenuView === 'undefined') return;

    const loader = document.getElementById('page-loader');
    // A menu/language refresh must keep the query the waiter is typing.
    const search = document.getElementById('product-search-input');
    if (search && typeof ItemSearch !== 'undefined' &&
        ItemSearch.parseTerm(search.value.trim()).term.trim() &&
        typeof applyProductFilter === 'function') {
        await applyProductFilter();
        if (loader) loader.style.display = 'none';
        return;
    }


    if (!storedProducts.length) {
        listEl.innerHTML = MenuView.nothing(
            'No items for this branch yet',
            'Whoever set up the till needs to add them. Tap refresh once they have.'
        );
        $("#category-list").empty();
        if (loader) loader.style.display = 'none';
        return;
    }

    const storedCart = await getCartData();
    if (!shouldRender()) return;
    if (search && typeof ItemSearch !== 'undefined' &&
        ItemSearch.parseTerm(search.value.trim()).term.trim() &&
        typeof applyProductFilter === 'function') {
        await applyProductFilter();
        if (loader) loader.style.display = 'none';
        return;
    }
    const cartMap = cartProductMap(storedCart);

    MenuScreen.draw(products, cartMap, {
        image: resolveLocalImageUrl,
        popular: window._frequentItemIds instanceof Set ? window._frequentItemIds : new Set(),
    });

    updateCart();
    if (loader) loader.style.display = 'none';
}

/*
 * Go to a category, rather than becoming one.
 *
 * This used to redraw the list with only that category in it. Nothing calls it
 * that way any more - the rail scrolls - but the name is kept because it is
 * how the rest of the app has always said "take me to the drinks", and a
 * rename would be a second change riding along with this one.
 */
function showCategory(category) {
    if (typeof MenuScreen === 'undefined') return;
    MenuScreen.goTo(category);
}

// ✅ Event Binding for `.product-card` Clicks
// $(document).on("click", ".product-card", async function () {
//     let productId = $(this).data("id");
//     await updateQuantity(productId, 1);
// });
// ✅ Event Binding for Quantity Buttons
// $(document).on("click", ".btn-increase", async function () {
//     let productId = $(this).data("id");
//     await updateQuantity(productId, 1);
// });

// ✅ Update Quantity and Save to IndexedDB
function cartProductId(item) { return item.product_id || item.id; }
function cartProductQuantity(cart, id) {
    return cart.filter(item => cartProductId(item) === id).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}
function cartProductMap(cart) {
    const result = new Map();
    for (const item of cart) {
        const id = cartProductId(item), previous = result.get(id);
        result.set(id, { ...item, quantity: (previous?.quantity || 0) + (Number(item.quantity) || 0) });
    }
    return result;
}
function cartPreparation(item) {
    return JSON.stringify([Number(item.askedPrice) || 0, (item.modifiers || []).map(value => [value.group || '', value.name || '']).sort()]);
}
function updateQuantity(id, change, options) {
    return queueCartMutation(() => updateQuantityNow(id, change, options));
}
async function updateQuantityNow(id, change, options) {
    // ✅ only read needed product
    const storedLine = (await getCartData()).find(line => line.id === id);
    const storedProduct = await getProductById(storedLine ? cartProductId(storedLine) : id);
    /* What the waiter was quoted this morning, for a dish the catalogue prices
       on the day. Absent for every ordinary dish, which is why nothing below
       changes for them. */
    const quoted = Number((options && options.askedPrice) || 0) || 0;
    /* What the table wants on it, asked once when the dish went on. The till
       prices these from its own documents; this is only what was chosen. */
    const chosen = Array.isArray(options && options.modifiers) ? options.modifiers : null;

    let cartData = await getCartData();
    let item = cartData.find(i => i.id === id);
    if (change > 0 && (chosen || quoted > 0)) {
        const preparation = cartPreparation({ askedPrice: quoted, modifiers: chosen || [] });
        item = cartData.find(i => cartProductId(i) === id && cartPreparation(i) === preparation && !i.seat && !i.course && !i.held && !(i.allergies || []).length && !i.allergy_note);
    }
    if (change > 0 && !(chosen || quoted > 0) && item && (item.seat || item.course || item.held || item.allergies?.length || item.allergy_note)) {
        item = cartData.find(i => cartProductId(i) === id && !i.seat && !i.course && !i.held && !i.allergies?.length && !i.allergy_note);
    }
    if (change < 0 && !item) item = cartData.filter(i => cartProductId(i) === id).at(-1);
    if (!storedProduct) return;

    if (!item) {
        if (change < 0) return; // Prevent decreasing before item exists
        let product = storedProduct;
        if (!product) return;

        item = {
            id: cartData.some(i => i.id === product.id) ? crypto.randomUUID() : product.id,
            product_id: product.id,
            name: product.name,
            ...window.PosnicItemText.snapshot(product),
            /* Carried onto the LINE, because the line outlives the menu row:
               the next branch refresh deletes a one-off from the products
               store, and the cart sync has to know this line is allowed to
               have no dish behind it. */
            instant: product.instant === true,
            img: product.img,
            icon: product.icon || "",
            price: Number(product.price || 0),
            selling_price: product.selling_price ?? product.subtotal ?? product.price,
            discount_price: Number(product.discount_price || 0),
            tax_price: Number(product.tax_price || 0),
            subtotal: Number(product.subtotal || 0),
            final_price: Number(product.final_price || 0),
            /*
             * TODAY'S PRICE, for a dish the card cannot carry one for.
             *
             * Whole fish, crab, lobster. The catalogue has no selling price,
             * so the price is whatever the waiter was told this morning - and
             * it belongs on the LINE, not on the product, because the next
             * table may be quoted something else.
             *
             * `askedPrice` is set by whoever put this in the cart. Nothing
             * reads it unless it is there, so every ordinary dish is
             * untouched.
             */
            askedPrice: quoted,
            modifiers: chosen || [],
            quantity: 0
        };
    }
    if (quoted > 0) item.askedPrice = quoted;
    item.line_id = item.line_id || item.id;

    const allowNegative = storedProduct?.negative_stock === true;
    const totalStock = storedProduct?.available_quantity || 0;

    // 🔒 Block increment if we already reached available stock (for non-negative-stock items)
    if (!allowNegative && change > 0 && cartProductQuantity(cartData, id) + change > totalStock) {
        return; // do nothing – keep quantity and stock badge as is
    }

    item.quantity += change;

    // ✅ Prevent negative quantity
    if (item.quantity < 0) item.quantity = 0;

    // After modifying item.quantity...

    // Update remaining stock badge on product card (for non-negative-stock items)
    if (!allowNegative) {
        const totalStock = storedProduct.available_quantity || 0;
        const currentQty = cartProductQuantity(cartData.filter(i => i.id !== item.id), id) + item.quantity;
        const remaining = Math.max(totalStock - currentQty, 0);
        const stockEl = document.getElementById(`stock-${id}`);
        if (stockEl) {
            stockEl.textContent = `Stock: ${remaining}`;
        }
    }

    // ✅ Update or remove from cart
    if (item.quantity === 0) {
        cartData = cartData.filter(i => i.id !== item.id);
    } else {
        const index = cartData.findIndex(i => i.id === item.id);
        if (index !== -1) {
            cartData[index] = item;
        } else {
            cartData.push(item);
        }
    }

    await saveCartData(cartData);
    updateCart();

    /*
     * The one row that changed, and nothing else.
     *
     * Not a redraw. Somebody halfway down a long menu who adds a dish and is
     * returned to the top has lost their place for no reason they can see,
     * and the menu is the one screen where that is most of the screen.
     */
    if (typeof MenuScreen !== 'undefined') {
        MenuScreen.setRow(id, cartProductQuantity(cartData, id), storedProduct);
    }
    return true;
}

/**
 * What one of these costs, on every screen that shows money.
 *
 * TODAY'S PRICE WINS. A dish the catalogue prices on the day carries nothing
 * in `final_price` - that is the whole condition - so a screen that reads the
 * catalogue shows a fish as free. The waiter was asked, typed 850, and the
 * bill still said 0.00 each and totalled nothing: the same shock that started
 * this work, one screen later and on the handset the waiter is holding.
 *
 * `askedPrice` is per LINE, because the next table may be quoted something
 * else, and it is already what the order payload sends - so this makes every
 * screen agree with what the kitchen and the server are told.
 *
 * Absent for every ordinary dish, which is why nothing else changes.
 */
/**
 * Was this line's price typed in by a waiter rather than read off the card?
 *
 * The line carries `askedPrice` only when somebody was asked for it, so this
 * is also the test for "may it be changed here". An ordinary dish is priced by
 * the shop, and a waiter must not be able to retype that on the bill.
 */
function askedOn(item) {
    return Number(item && item.askedPrice) > 0;
}

function unitPrice(item) {
    const asked = Number(item && item.askedPrice) || 0;
    if (asked > 0) return asked;
    return Number((item && (item.final_price || item.price)) || 0);
}

// Display totals include tax. The till validates the configured selling price
// and applies its own tax rules. Older cached lines kept that price in subtotal.
function submittedUnitPrice(item) {
    // Entered prices are the base quote; the server adds configured extras.
    if (askedOn(item)) return Number(item.askedPrice);
    const value = item.selling_price ?? (item.instant ? item.price : item.subtotal) ?? item.price;
    const price = Number(value);
    if (value == null || value === '' || !Number.isFinite(price))
        throw new Error('Could not load the menu');
    return price + (item.modifiers || []).reduce((sum, option) => sum + (Number(option.price_delta) || 0), 0);
}

async function updateCart() {
    let totalQty = 0;
    let totalPrice = 0;

    try {
        let storedCart = await getCartData();

        storedCart.forEach(item => {
            totalQty += item.quantity;
            totalPrice += item.quantity * unitPrice(item);

            // ✅ Update UI for each item
            $(`#qty-${item.id}`).text(item.quantity);
        });

        if (totalQty === 0) {
            $(".next-page")
                .addClass("disabled")
                .off("click.tableOrderCart"); // disables click handler
        } else {
            $(".next-page")
                .off("click.tableOrderCart")
                .on("click.tableOrderCart", () => window.location.href = 'cart.html');
            $(".next-page").removeClass("disabled");
        }


        $("#cart-qty,#mobile-cart-count").text(totalQty);
        $("#cart-total").text(CaptainMoney.display(totalPrice));
        $("#summary-display").text(I18N.t('{0} Items | {1}').replace('{0}', totalQty).replace('{1}', CaptainMoney.display(totalPrice)));
        $("#next-btn").prop("disabled", totalQty === 0);

        /* And the bar at the bottom, which rises only once there is something
           on the bill worth crossing the screen for. */
        if (typeof MenuScreen !== 'undefined') MenuScreen.bill(totalQty, totalPrice);
        if (typeof renderCartSummaryIntoSheet === 'function') void renderCartSummaryIntoSheet(storedCart);
    } catch (error) {
        console.error("❌ Error updating cart:", error);
    }
}

// ✅ Check if IndexedDB has a branch and redirect
async function checkBranchAndRedirect() {
    const branches = await getData(BRANCH_STORE);
    if (branches.length > 0) {
        // Restore localStorage keys if missing (e.g. after page refresh or direct navigation)
        const branch = branches[0];
        if (!localStorage.getItem('branch_id')) {
            localStorage.setItem('branch_id', branch.branch_id || branch.id);
        }
        if (!localStorage.getItem('kiosk_selected_branch')) {
            localStorage.setItem('kiosk_selected_branch', branch.id);
        }
        // Re-fetch from API if table/product data is missing (e.g. after hard refresh)
        const hasTableorders = localStorage.getItem('kiosk_tableorders');
        if (!hasTableorders) {
            fetchAndStoreBranch(branch.id, false, true);
        }
        console.log("✅ Branch already exists, skipping redirect.");
        return;
    } else {
        const db = await getDB();
        const tx = db.transaction([BRANCH_STORE, STORE_NAME, CART_STORE, PHONEPE_STORE, IMAGE_STORE, PAYMENT_STORE], "readwrite");

        tx.objectStore(BRANCH_STORE).clear();
        tx.objectStore(STORE_NAME).clear();
        tx.objectStore(CART_STORE).clear();
        tx.objectStore(PHONEPE_STORE).clear();
        tx.objectStore(IMAGE_STORE).clear();
        tx.objectStore(PAYMENT_STORE).clear();
        console.log("🚀 First-time branch entry required.");
    }
}

// ✅ Refresh IndexedDB every 1 minute without redirect
(async () => {
    /* config.js chooses the server synchronously, so there is nothing to await
       before the first request. */
    await checkBranchAndRedirect();

    setInterval(async () => {
        console.log("🔄 Checking for product updates...");
        const branches = await getData(BRANCH_STORE);
        if (!branches.length) return;

        if (window.location.pathname.includes('products')) {
            const input = document.getElementById('product-search-input');
            if (input && input.value.trim() !== '') {
                console.log("⏸ Skipping product refresh because search is active");
                return;
            }
        }

        await fetchAndStoreBranch(branches[0].id, false, false);
    }, 20000); // 20,000 ms = 20 seconds
})();

// ✅ Run branch check on page load
//checkBranchAndRedirect();


async function getCartData() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("cart", "readonly");
        const store = transaction.objectStore("cart");
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = (error) => reject(error);
    });
}

async function getProductById(id) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("products", "readonly");
        const store = transaction.objectStore("products");
        const request = store.get(id);

        request.onsuccess = () => resolve(request.result);
        request.onerror = (error) => reject(error);
    });
}

/*
 * THE NAME THIS ORDER WILL ANSWER TO.
 *
 * A waiter taps Send twice, or taps once on a handset that has already sent
 * and is waiting for a reply it will never get. Both reach the till, and table
 * 5 comes back showing the same order twice with cancelling one cancelling
 * both. Reported from a live floor.
 *
 * The till has been able to recognise a resent order for as long as it has had
 * a KOT screen, but only if the order carries a key. This app sent one - and
 * minted it per ATTEMPT, so a queued retry was recognised and a second tap was
 * not.
 *
 * The key is minted for the cart, kept while the cart stands, and cleared when
 * the cart changes or the order lands. Ported from Table_Order, where it was
 * written first.
 */
const ORDER_KEY = 'kiosk_order_key';
const ORDER_SHAPE = 'kiosk_order_shape';

function newOrderKey() {
    try {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
    } catch (e) {
        /* an older webview: fall through */
    }
    return 'ord-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** The key for the cart as it stands, minting one if this cart has none. */
function currentOrderKey() {
    try {
        let key = localStorage.getItem(ORDER_KEY);
        if (!key) {
            key = newOrderKey();
            localStorage.setItem(ORDER_KEY, key);
        }
        return key;
    } catch (e) {
        /* Storage blocked. Better a key that cannot dedupe than no order at
           all, so the send still goes through. */
        return newOrderKey();
    }
}

/** This cart is not the cart that was sent. Whatever goes next is new. */
function resetOrderKey() {
    try {
        localStorage.removeItem(ORDER_KEY);
        localStorage.removeItem(ORDER_SHAPE);
    } catch (e) {
        /* nothing to clear */
    }
}

/*
 * WHAT THE WAITER ACTUALLY CHOSE: which dish, how many, at what price, with
 * what written on it.
 *
 * Deliberately not the whole line. A product refresh rewrites the cart with
 * fresher copies of the same items, and syncCartSilently saves it back on
 * every one of those - which is not a change the customer made. If it counted
 * as one, a refresh landing between a dropped send and its retry would mint a
 * new key and print the second ticket this exists to prevent.
 */
function cartShape(cart) {
    return JSON.stringify(
        (cart || []).map((line) => [
            String(line.id ?? ''),
            Number(line.quantity) || 0,
            Number(line.price) || 0,
            String(line.notes ?? line.note ?? ''),
            Number(line.askedPrice) || 0,
            line.modifiers || [],
            line.line_id || line.id,
            [line.seat || 0, line.course || '', line.held === true, line.allergies || [], line.allergy_note || ''],
        ])
    );
}

async function saveCartData(cart) {
    /* A cart that is not the cart the last key was minted for gets a new one:
       a waiter who adds a dish after a failed send must not be handed back the
       order without it. */

    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("cart", "readwrite");
        const store = transaction.objectStore("cart");

        store.clear();
        cart.forEach(item => store.put(item));

        transaction.oncomplete = () => {
    try {
        const shape = cartShape(cart);
        if (localStorage.getItem(ORDER_SHAPE) !== shape) {
            localStorage.setItem(ORDER_SHAPE, shape);
            localStorage.removeItem(ORDER_KEY);
        }
    } catch (e) {
        /* Storage blocked: the send still goes, it just cannot dedupe. */
    }

            resolve();
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

function onCancelClick() {
    document.getElementById("cancelModal").style.display = "flex";
}

// Starting another order must resolve the previous draft, including when the
// table number is reused. A paid bill does not own this phone's local basket.
async function resolvePreviousDraft() {
    await waitForCartMutations();
    return queueCartMutation(async () => {
        const previous = await getCartData();
        if (!previous.length) return true;
        const table = localStorage.getItem('kiosk_table_no');
        const details = [table ? `${I18N.t('Table')} ${table}` : '',
            ...previous.map(item => `${item.name || item.item_name || ''} × ${item.quantity}`)]
            .filter(Boolean).join('\n');
        if (!await CaptainConfirm.discard({details})) {
            // Preserve the old table, prices and idempotency key as well as items.
            window.location.href = 'cart.html';
            return false;
        }
        await saveCartData([]);
        resetOrderKey();
        localStorage.removeItem('note');
        return true;
    });
}

async function confirmCancelOrder() {
    // Clear the cart
    await saveCartData([]); // Clear IndexedDB cart

    const cartSummary = document.getElementById("cart-summary");
    if (cartSummary) {
        cartSummary.innerHTML = ""; // Clear cart UI
    }

    // summary-display is not present on cart.html, so guard it
    const summaryEl = document.getElementById("summary-display");
    if (summaryEl) {
        summaryEl.textContent = I18N.t('{0} Items | {1}').replace('{0}', '0').replace('{1}', CaptainMoney.display(0));
    }

    closeCancelModal(); // Close the modal

    // Redirect to products page
    window.location.href = "kot-management.html";
}

function closeCancelModal() {
    document.getElementById("cancelModal").style.display = "none";
}

// ✅ Load cart from IndexedDB on page load
async function loadCart() {
    const cartItems = await getCartData();
    let cart = cartItems.reduce((acc, item) => {
        acc[item.id] = item;
        return acc;
    }, {});

    console.log("🛒 Loaded Cart from IndexedDB:", cart);
    return cart; // ✅ Return cart data
}

async function checkout(transactionId) {
    try {
        await waitForCartMutations();
        // 🔄 Get cart data from IndexedDB
        const cartItems = await getCartData();
        console.log('cartItems:', cartItems);

        if (!cartItems || cartItems.length === 0) {
            console.log("Cart is empty.");
            return;
        }

        // 🧾 Prepare payload: [{ id, quantity }]
        const payload = cartItems.map(item => {
            return {
                item_id: cartProductId(item),
                line_id: item.line_id || item.id,
                ...ServiceDetails.metadata(item),
                item_name: item.name || item.item_name || '',
                item_quantity: item.quantity,
                /*
                 * A dish priced on the day sends what the waiter entered; the
                 * server still refuses anything it did not ask for, and prices
                 * every ordinary line from its own catalogue. See
                 * _priceOnlineLine in the api.
                 */
                item_price: submittedUnitPrice(item),
                item_subtotal:
                    submittedUnitPrice(item) * item.quantity,
                gst: (item.tax_price || 0) * item.quantity,
                item_description: item.notes || "",
                /*
                 * WHAT THE TABLE ASKED FOR ON IT, by name.
                 *
                 * Not what it costs. The till prices these from the shop's own
                 * option documents and ignores anything a phone claims, which
                 * is why the names are all that travel: a client that could
                 * name a price could name a discount nobody agreed to.
                 *
                 * Absent when nothing was chosen, so an ordinary dish sends
                 * exactly what it always did.
                 */
                ...((item.modifiers || []).length
                    ? {
                          modifiers: item.modifiers.map((one) => ({
                              group: one.group || '',
                              name: one.name || ''
                          }))
                      }
                    : {})
            };
        });

        // 🏪 Get branch ID (MongoDB ObjectId expected by backend)
        const branches = await getData(BRANCH_STORE);
        let branchId = null;

        if (branches && branches.length > 0) {
            const branch = branches[0];
            // Prefer persisted MongoDB branch_id, fall back to legacy id
            branchId = branch.branch_id || branch.id || null;
        }

        // Extra safety: fall back to localStorage if needed
        if (!branchId) {
            branchId = localStorage.getItem('branch_id') || null;
        }
        const orderType = localStorage.getItem("orderType");
        const note = localStorage.getItem('note');

        const discountPercentage = parseFloat(localStorage.getItem('kiosk_discount_percentage')) || 0;
        const discountAmount = parseFloat(localStorage.getItem('kiosk_discount_amount')) || 0;
        const discountDescription = localStorage.getItem('kiosk_discount_description') || '';
        const tableNo = localStorage.getItem('kiosk_table_no') || '';
        const tableId = localStorage.getItem('kiosk_table_id') || '';
        const personCount = parseInt(localStorage.getItem('kiosk_person_count') || '0', 10) || 0;
        //await fetchAndStoreBranch(branchId, false);

        if (!branchId) {
            console.log("Branch not found.");
            return;
        }
        //const savedNumber = localStorage.getItem("kiosk_mobile_number");

        /*
         * THE KEY BELONGS TO THE CART, NOT TO THE TAP.
         *
         * It used to be OrderQueue.newKey(), minted fresh on every call - so
         * a queued RETRY reused it correctly, but a second TAP made a new one
         * and the till wrote a second ticket. Reported from a live floor:
         * table 5 showing the same order twice, and cancelling one cancelling
         * both.
         *
         * Cart-scoped gives the three behaviours a floor actually needs:
         *
         *   two taps on one cart           same key, the till answers with
         *                                  the one order it already has
         *   a retry after a dropped reply  same key, no second ticket
         *   a dish added, then resend      new key, a new ticket, correctly
         *
         * That last line is why this is not a hash of the items: a waiter who
         * adds a dish after a failed send must not be handed back the order
         * without it, silently.
         */
        const orderKey = currentOrderKey();
        const takeawayReservation = orderType === 'Take away' ? await reserveTakeawayNumber() : null;

        // 🚀 Send checkout request
        const orderBody = {
                idempotencyKey: orderKey,
                branch: branchId,
                items: payload,
                /*
                 * A TABLE HAS NO PHONE NUMBER.
                 *
                 * This endpoint was built for a customer ordering from their
                 * own phone, where the number is theirs. A waiter standing at
                 * a table has none, and this used to send `+910000000000`
                 * because the field looked required.
                 *
                 * It is not: nothing validates it, and the sale simply carries
                 * an empty customer phone. The invented one was worse than
                 * empty - it printed on a customer's bill under the customer
                 * line, and it still sits in the phone column of every sales
                 * report and every lookup by number.
                 *
                 * Sent as empty rather than dropped, so the shape of what this
                 * app posts stays the same as the storefront's.
                 */
                customerMobile: '',
                /*
                 * WHICH PHONE, AND WHAT IT IS RUNNING.
                 *
                 * Owner: "every order should have some details. example what
                 * mobile, user agent, ip address, mobile type or user account
                 * whatever infromation app can know do it."
                 *
                 * The till adds the address it was called from and the waiter
                 * signed in, because neither is this phone's to claim. This
                 * half is what only the handset knows: its model, its build,
                 * and whether it reached the till over the shop's Wi-Fi or the
                 * cloud. See assets/common/this-device.js.
                 */
                client: (POSNIC.thisDevice && POSNIC.thisDevice.facts()) || {},
                transactionId: transactionId,
                tokenId: takeawayReservation ? String(takeawayReservation.number) : generateUniqueToken(),
                ...(takeawayReservation ? {takeaway_request_id: takeawayReservation.request_id} : {}),
                payment_status: "cash",
                /* Not renamed with the app. The POS stores this string on
                   every sale and reports on it, so changing it would split a
                   shop's history in two at the version boundary. */
                sale_method: 'Table-Order',
                order: orderType,
                note: note,
                kiosk_discount_percentage: discountPercentage,
                kiosk_discount_amount: discountAmount,
                kiosk_discount_description: discountDescription,
                kiosk_table_no: tableNo,
                kiosk_table_id: tableId,
                dine_type: orderType || 'Dine-in',
                person_count: (orderType === 'Dine-in') ? personCount : ''
        };

        // Persist before any network request; the cart stays intact if storage fails.
        if (POSNIC.session.canTakeOrders === false)
            throw new Error('Reconnect your account before taking new orders. Existing orders are retained.');
        const existing = OrderQueue.all().find(row => row.key === orderKey);
        if (!existing && !OrderQueue.add({key: orderKey, branch: branchId, body: orderBody, held: true}))
            throw new Error('Order NOT saved. Phone storage is full or unavailable. Keep this cart and retry.');
        await saveCartData([]);
        if (!OrderQueue.update(orderKey, {held: false}))
            throw new Error('Order is saved, but needs recovery. Keep app data and retry.');
        for (const key of ['kiosk_discount_percentage', 'kiosk_discount_amount', 'kiosk_discount_description', 'kiosk_table_no', 'kiosk_table_id', 'kiosk_person_count', 'note', 'kiosk_takeaway_reservation']) localStorage.removeItem(key);
        await renderCart([], true);
        if (typeof hideOrderProcessingScreen === 'function') hideOrderProcessingScreen();
        window.POSNIC_ORDER_QUEUE_UI?.render();
        // Delivery continues on the next screen, without making the waiter wait.
        window.location.href = 'kot-management.html';
        return true;
    } catch (error) {
        if (typeof hideOrderProcessingScreen === 'function') hideOrderProcessingScreen();
        showErrorPopup(error.message || 'Order could not be saved. Keep this cart and retry.');
        return false;
    }
}

async function reserveTakeawayNumber() {
    const scope = JSON.stringify([POSNIC.session?.shopKey || POSNIC.session?.base || POSNIC.server.baseUrl, localStorage.getItem('branch_id')]);
    let draft;
    try { draft = JSON.parse(localStorage.getItem('kiosk_takeaway_reservation')); } catch (_) {}
    if (!draft || draft.scope !== scope) draft = { scope, request_id: newOrderKey() };
    localStorage.setItem('kiosk_takeaway_reservation', JSON.stringify(draft));
    if (!draft.number) {
        const answer = await POSNIC.api.post('/captain/v1/takeaway-number', { request_id: draft.request_id });
        const number = Number(answer?.number);
        if (!Number.isSafeInteger(number) || number < 1) throw new Error('Could not assign a takeaway number. Please retry.');
        draft.number = number;
        localStorage.setItem('kiosk_takeaway_reservation', JSON.stringify(draft));
    }
    return draft;
}

function getTodayKey() {
    const today = new Date();
    return `kiosk_tokens_${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
}

function getStoredTokens() {
    const key = getTodayKey();
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
}

function saveToken(token) {
    const key = getTodayKey();
    const tokens = getStoredTokens();
    tokens.push(token);
    localStorage.setItem(key, JSON.stringify(tokens));
}

function getAllPossibleTokens() {
    // Preserve the former token space, but issue decimal numbers only.
    return Array.from({length:26 * 999}, (_, index) => String(index + 1));
}
function numericToken(value) {
    const legacy = /^([A-Z])(\d{3})$/.exec(String(value));
    return legacy ? String((legacy[1].charCodeAt(0) - 65) * 999 + Number(legacy[2])) : String(value);
}

function generateUniqueToken() {
    const usedTokens = getStoredTokens().map(numericToken);
    const allTokens = getAllPossibleTokens();
    const remaining = allTokens.filter(t => !usedTokens.includes(t));

    if (remaining.length === 0) {
        console.warn("🔁 All tokens used. Resetting for the next cycle.");
        localStorage.removeItem(getTodayKey());
        return generateUniqueToken(); // Retry after reset
    }

    const token = remaining[Math.floor(Math.random() * remaining.length)];
    saveToken(token);
    return token;
}

async function storePhonePeData(id) {
    try {
        await saveData(PHONEPE_STORE, [{ id: id }]);
    } catch (error) {
        console.error("❌ Error updating PhonePe data:", error);
    }
}

async function getFirstPhonePeId() {
    const phonepeData = await getData(PHONEPE_STORE);
    if (phonepeData.length > 0) {
        return phonepeData[0].id;
    }
    return null;
}

function showPopup() {
    const popup = document.getElementById('popup');

    // Reset the state
    popup.classList.remove('show');
    popup.style.display = 'block';
    void popup.offsetWidth; // force reflow

    // Show with animation
    popup.classList.add('show');

    // Auto-hide after 3 seconds
    setTimeout(() => {
        hidePopup();
    }, 3000);
}

function hidePopup() {
    const popup = document.getElementById('popup');
    if (!popup) return;
    popup.classList.remove('show');
    setTimeout(() => {
        popup.style.display = 'none';
    }, 300); // match transition
}

// Close on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        hidePopup();
    }
});
