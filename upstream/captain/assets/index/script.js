// Show admin-blocked banner and start polling for unblock
(function() {
    let _unblockTimer = null;

    function startUnblockPoller() {
        if (_unblockTimer) return;
        _unblockTimer = setInterval(async () => {
            try {
                /* Only a till blocks a device; the cloud has no such notion. */
                if (!POSNIC.server.isLocal) return;
                const hit = await POSNIC.discovery.probe(POSNIC.server.baseUrl, 3000);
                if (hit) {
                    // Unblocked!
                    clearInterval(_unblockTimer);
                    _unblockTimer = null;
                    const banner = document.getElementById('blocked-banner');
                    if (banner) {
                        banner.style.borderColor = '#16a34a';
                        banner.style.background = '#052e16';
                        banner.style.display = 'block';
                        banner.innerHTML = `
                            <div style="font-size:28px;margin-bottom:6px;">✅</div>
                            <div style="font-weight:700;font-size:16px;color:#86efac;margin-bottom:6px;">Access Restored</div>
                            <div style="font-size:13px;color:#bbf7d0;">Your device has been unblocked by the administrator.<br>You can now sign in.</div>`;
                        setTimeout(() => { banner.style.display = 'none'; }, 2500);
                    }
                }
            } catch (e) { /* server offline, keep polling */ }
        }, 4000);
    }

    if (sessionStorage.getItem('device_blocked') === '1') {
        sessionStorage.removeItem('device_blocked');
        document.addEventListener('DOMContentLoaded', function() {
            const banner = document.getElementById('blocked-banner');
            if (banner) {
                banner.style.display = 'block';
                startUnblockPoller();
            }
        });
    }

    if (sessionStorage.getItem('device_limit') === '1') {
        sessionStorage.removeItem('device_limit');
        document.addEventListener('DOMContentLoaded', function() {
            const banner = document.getElementById('limit-banner');
            if (banner) banner.style.display = 'block';
        });
    }

    // Also start poller if banner is already visible when doLogin gets DEVICE_BLOCKED
    window._startUnblockPoller = startUnblockPoller;
})();

function showLoader() {
    const loader = document.getElementById("loader");
    if (loader) loader.style.display = "flex";
}

function hideLoader() {
    const loader = document.getElementById("loader");
    if (loader) loader.style.display = "none";
}

function showLoginMessage(msg) {
    const el = document.getElementById("login-message");
    if (!el) return;
    el.textContent = msg;
    el.style.display = msg ? "block" : "none";
}

function showBranchMessage(msg) {
    const el = document.getElementById("branch-message");
    if (!el) return;
    el.textContent = msg;
    el.style.display = msg ? "block" : "none";
}

function showBranchFooter(show) {
    const footer = document.getElementById("branch-footer");
    if (!footer) return;
    footer.style.display = show ? "flex" : "none";
}

function getServerConnectionMessage(error) {
    const where = POSNIC.server.baseUrl || 'no server chosen';
    const reason = error && error.message ? error.message : String(error || 'Connection failed');
    return `Cannot reach the shop server (${where}). Check the Wi-Fi, or set the shop code. ${reason}`;
}

function showServerSettingsForConnectionFailure(error) {
    showLoginMessage(getServerConnectionMessage(error));
    showBranchMessage(getServerConnectionMessage(error));

    if (typeof openServerModal === 'function') {
        setTimeout(() => openServerModal(), 200);
    }
}

let loginInProgress = false;
async function doLogin() {
    if (loginInProgress) return;
    const usernameEl = document.getElementById("username");
    const passwordEl = document.getElementById("password");

    if (!usernameEl || !passwordEl) {
        showLoginMessage("Page error — please reload the app.");
        return;
    }

    const username = (usernameEl.value || "").trim();
    const password = passwordEl.value || "";

    showLoginMessage("");

    if (!username) {
        showLoginMessage("Please enter your username");
        return;
    }
    if (!password) {
        showLoginMessage("Please enter your password");
        return;
    }

    /*
     * No address at all is a setup problem, not a sign-in failure.
     *
     * There used to be a hard-coded fallback here - api.posnic.io - which is
     * not any shop's address. A user with nothing configured got "invalid
     * account" from a host that has never heard of them, which sends them
     * looking for the wrong problem entirely.
     */
    if (!POSNIC.server.baseUrl) {
        showLoginMessage("Choose your shop server first.");
        if (typeof openServerModal === 'function') openServerModal();
        return;
    }

    const loginServer = POSNIC.server.baseUrl;
    loginInProgress = true;
    showLoader();

    try {
        /*
         * The response is a bearer-token grant, and the failures are ordinary
         * HTTP. There used to be one status for everything - 404 - so the only
         * way to tell a wrong password from a locked-out device from a wrong
         * address was to read the English in the message.
         */
        /*
         * WHAT THIS PHONE IS, at the one moment the shop can be sure whose
         * it is.
         *
         * Owner: "map device to cloud account." The till writes it down
         * against the account, so a shop can see its handsets and turn one
         * off without turning the rest off - which is the thing that makes
         * a thirty day token safe to hand a part-time waiter.
         *
         * The same facts already ride on every order. A phone that cannot
         * say is not stopped from signing in, and an older app sends
         * nothing at all: the server treats both as the app it was.
         */
        let device;
        try {
            device = POSNIC.thisDevice && POSNIC.thisDevice.facts();
        } catch (e) {
            device = undefined;
        }

        const result = await POSNIC.api.post('/users/kioskMobileLogin', {
            username,
            password,
            device,
        });

        /*
         * Two response shapes, because a shop's server is not ours to upgrade.
         *
         * A current server answers with a bearer grant: { token, shopKey,
         * user, branches }. Every shop running 1.6.1 or earlier - which today
         * is all of them - answers with the older envelope, { type, message,
         * data }, where `data` is the branch list and there is no credential
         * at all.
         *
         * Reading only the new shape is what made a successful sign-in show an
         * empty shop: the branches were right there in `data` and nothing
         * looked at them. This is not compatibility cruft to be removed later;
         * a client never controls which version the server is on, and shops
         * update when they update.
         */
        const branches = result.branches || result.data || [];
        if (typeof OrderQueue !== 'undefined' && OrderQueue.all().some(row => row.owner && (row.owner.user !== result.user?.id || row.owner.shop !== result.shopKey || row.owner.base !== POSNIC.server.baseUrl))) throw new Error('Reconnect the original staff member and server to keep saved orders separate.');
        if (window.CaptainAccess?.locked) await POSNIC.session.end();
        await POSNIC.session.start(result);

        if (!Array.isArray(branches) || branches.length === 0) {
            showLoginMessage("No branches are set up for this account. Ask your manager.");
            return;
        }

        window.CaptainSignIn?.remember(loginServer, username);
        localStorage.setItem("kiosk_branch_list", JSON.stringify(branches));
        const userId = (result.user && result.user.id) || branches[0].user_id;
        if (userId) localStorage.setItem("user_id", userId);

        /*
         * THE OFFER TO SET A PIN IS NOT MADE HERE, AND THAT COST A SUITE.
         *
         * It was: after a successful sign-in, which is the only moment
         * somebody has proved they may set one, so the reasoning was sound and
         * the placement was not. The pad is a full screen that waits for an
         * answer, and a sign-in that waits for an answer is a sign-in that has
         * not finished. 246 specs stopped at a keypad instead of reaching the
         * floor, which is exactly what a waiter would have done: signed in,
         * been handed four digits to think about, and not got to their table.
         *
         * Nothing may stand between a sign-in and the floor. The lock is
         * offered from the sheet on the floor screen instead, beside the other
         * things that belong to this phone rather than to the shop, where
         * somebody goes to it rather than it arriving at them.
         */

        if (branches.length === 1) {
            const only = branches[0];
            const storeId = only.store_id || only.branch_id;
            localStorage.setItem("kiosk_selected_branch", storeId);
            localStorage.setItem("branch_id", only.branch_id);
            await selectBranch(storeId);
            return;
        }

        renderBranchList(branches);
        document.getElementById("login-section").style.display = "none";
        document.getElementById("branch-section").style.display = "block";
        showBranchFooter(true);
    } catch (error) {
        if (error.status === 429) {
            showLoginMessage(error.message);
        } else if (error.status === 401) {
            showLoginMessage(error.message || "That username or password was not accepted.");
        } else if (error.status === 400) {
            showLoginMessage(error.message);
        /* A server older than the status-code work answers 404 for a refused
           sign-in, which otherwise reads to the user as "the app is broken"
           rather than "that password is wrong". */
        } else if (error.status === 404 && error.body && error.body.type === 'error') {
            showLoginMessage(error.body.message || "That username or password was not accepted.");
        } else if (error.code === 'DEVICE_BLOCKED') {
            const banner = document.getElementById('blocked-banner');
            if (banner) banner.style.display = 'block';
            showLoginMessage('');
            if (typeof window._startUnblockPoller === 'function') window._startUnblockPoller();
        } else if (error.code === 'DEVICE_LIMIT_REACHED') {
            const banner = document.getElementById('limit-banner');
            if (banner) banner.style.display = 'block';
            showLoginMessage('');
        } else if (error.offline) {
            showServerSettingsForConnectionFailure(error);
        } else {
            console.error("Login error:", error);
            showLoginMessage(error.message || "Could not sign in.");
        }
    } finally {
        loginInProgress = false;
        hideLoader();
    }
}

function renderBranchList(branches) {
    const container = document.getElementById("branch-list-container");
    container.innerHTML = "";
    showBranchMessage("");

    if (!branches || branches.length === 0) {
        showBranchMessage("No branches configured for this user.");
        return;
    }

    branches.forEach(b => {
        const col = document.createElement("div");
        col.className = "col-md-3 mb-3";

        const card = document.createElement("div");
        card.className = "card text-center branch-card";
        card.style.cursor = "pointer";

        // data-branch-id = store_id (fallback to branch_id for local branches without kiosk)
        card.dataset.branchId = b.store_id || b.branch_id;
        // always keep the MongoDB ObjectId and user_id for localStorage
        card.dataset.actualBranchId = b.branch_id || '';
        card.dataset.userId = b.user_id || '';

        const img = document.createElement("img");
        img.className = "card-img-top";
        img.alt = b.branch_name || "Branch";
        img.style.objectFit = "cover";

        // normalize image path
        let imagePath = b.branch_image || "";
        if (!imagePath || imagePath === "store.png") {
            // default image
            imagePath = "images/default-store.webp";
        } else if (!imagePath.startsWith("http")) {
            // relative path from API → point to images folder
            imagePath = "images/" + imagePath;
        }

        img.src = imagePath;

        const body = document.createElement("div");
        body.className = "card-body";

        const title = document.createElement("h5");
        title.className = "card-title";
        title.translate = !b.branch_name;
        title.textContent = b.branch_name || "Branch";

        body.appendChild(title);
        card.appendChild(img);
        card.appendChild(body);
        col.appendChild(card);
        container.appendChild(col);
    });

    /*
     * One handler, on the container, guarded by a flag.
     *
     * This was registered with { once: true }, which removes the listener
     * after the FIRST event it receives - including one that hit the gap
     * between two cards and returned immediately. From then on the branch list
     * was dead: every subsequent tap did nothing at all, with no error, and
     * the only way out was to restart the app. The flag does the job { once }
     * was meant to do - stop a second branch being selected while the first is
     * still loading - without disarming the list.
     */
    let selecting = false;
    container.addEventListener("click", async function (e) {
        if (selecting) return;
        const card = e.target.closest(".branch-card");
        if (!card) return;
        const branchId = card.dataset.branchId;
        if (!branchId) return;
        selecting = true;
        // set branch_id (MongoDB ObjectId) and user_id before navigating
        const actualBranchId = card.dataset.actualBranchId || branchId;
        localStorage.setItem("branch_id", actualBranchId);
        if (card.dataset.userId) localStorage.setItem("user_id", card.dataset.userId);
        try {
            await selectBranch(branchId);
        } finally {
            /* Only matters when selectBranch failed and we are still here. */
            selecting = false;
        }
    });
}

async function selectBranch(branchId) {
    showBranchMessage("");
    showLoader();
    try {
        // save selected branch so we can skip login next time
        localStorage.setItem("kiosk_selected_branch", branchId);

        // cached branch list இருந்து matching branch கண்டு பிடிக்க
        const branchListRaw = localStorage.getItem("kiosk_branch_list");
        if (branchListRaw) {
            try {
                const branchList = JSON.parse(branchListRaw);
                const current = branchList.find(b => b.store_id === branchId);
                if (current && current.branch_id) {
                    // Order History க்கு use பண்ணுற id
                    localStorage.setItem("branch_id", current.branch_id);
                }
            } catch (e) {
                console.error("Failed to parse kiosk_branch_list", e);
            }
        }

        await fetchAndStoreBranch(branchId, true);
    } catch (err) {
        console.error("Error loading branch products:", err);
        // Login has already succeeded. A menu/storage failure must stay visible
        // instead of reopening setup and hiding the error behind server selection.
        const message = (window.I18N?.t('Could not load the menu') || 'Could not load the menu') +
            (err?.message ? ': ' + err.message : '');
        showLoginMessage(message);
        showBranchMessage(message);
        showErrorPopup(message);
    } finally {
        hideLoader();
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    try { await POSNIC.session.ready; } catch (e) { showLoginMessage(e.message); return; }
    showBranchFooter(false);

    /*
     * The login screen is the one place a full search is affordable.
     *
     * Nowhere else can spend seconds sweeping a subnet - mid-service that
     * would freeze the screen a waiter is holding. Here there is nothing else
     * happening, and getting the address right now is what stops every screen
     * after this one from failing.
     */
    /*
     * A line on the sign-in screen while the app looks for the shop.
     *
     * Without it a first run shows nothing at all for as long as the sweep
     * takes, and silence that long reads as a broken app rather than a busy
     * one. It clears itself either way, so a device that is already
     * configured never sees it.
     */
    (function showSearchProgress() {
        const message = document.getElementById('login-message');
        if (!message) return;
        let searching = false;

        window.addEventListener('posnic:searching', function (event) {
            searching = true;
            const { done, total } = event.detail || {};
            message.style.display = 'block';
            message.classList.remove('text-danger');
            message.textContent = total
                ? `Looking for your shop on the Wi-Fi... (${done} of ${total})`
                : 'Looking for your shop on the Wi-Fi...';
        });

        window.addEventListener('posnic:searched', function (event) {
            if (!searching) return;
            searching = false;
            message.classList.add('text-danger');
            /* A find is announced by the screen changing; only a miss needs
               words, and those come from the connect sheet. */
            if (event.detail && event.detail.found) showLoginMessage('');
            else showLoginMessage('');
        });
    })();

    /*
     * ARE WE ONLINE - unless somebody came here to say we are not.
     *
     * Owner: "still change server not working. still looking for same not
     * working old config and after two try its showing option to edit."
     *
     * This is a MANUAL check, so it allows a full Wi-Fi sweep, and it runs on
     * every load of this page. Arriving from Change shop server, it therefore
     * dialled the address the person had just rejected and then swept the
     * subnet looking for it - and only when all of that had run out did the
     * editor stop being argued with. Two goes, on a handset, is exactly what
     * that feels like.
     *
     * Nothing is lost by skipping it here: the editor is opening anyway, and
     * closing the editor starts the checks again.
     */
    if (POSNIC.server.isConfigured && !POSNIC.net.choosingServer()) {
        POSNIC.net.check(true).then(function(ok) {
            if (!ok && typeof openServerModal === 'function' && !POSNIC.server.isConfigured) {
                openServerModal();
            }
        });
    }

    const serverFailure = sessionStorage.getItem('server_connection_failed');
    if (serverFailure) {
        sessionStorage.removeItem('server_connection_failed');
        showServerSettingsForConnectionFailure(new Error(serverFailure));
    }

    const openServerSettings = sessionStorage.getItem('open_server_settings') === '1';
    if (openServerSettings) {
        sessionStorage.removeItem('open_server_settings');
        setTimeout(() => {
            if (typeof openServerModal === 'function') openServerModal();
        }, 200);
    }

    /*
     * SOMEBODY WHO CAME HERE TO CHANGE THE SERVER IS NOT PASSING THROUGH.
     *
     * Owner: "i clicked change server, and choose another way. suddenly
     * screen gone."
     *
     * It was not gone, it had walked off. The floor screen sends the phone
     * here with a flag, index.html opens the editor sixty milliseconds later
     * - and the branch auto-load underneath was still running, finished, and
     * navigated straight back to the floor. A loader covered the editor on
     * the way out, so from the outside the screen simply vanished.
     *
     * choosingServer() reads both flags, the one the floor sets and the one
     * the editor sets when it opens, so this does not depend on which
     * DOMContentLoaded handler ran first.
     */
    let changingServer = false;
    try {
        changingServer = !!(POSNIC.net && POSNIC.net.choosingServer && POSNIC.net.choosingServer());
    } catch (e) {
        /* No net module is not a reason to refuse to load a menu. */
    }

    const forceSelect = localStorage.getItem("kiosk_force_branch_select") === "1";
    const savedBranch = localStorage.getItem("kiosk_selected_branch");
    const cachedBranchesRaw = localStorage.getItem("kiosk_branch_list");

    // "Change Branch" flow — show cached branch list directly
    if (forceSelect && cachedBranchesRaw) {
        try {
            const branches = JSON.parse(cachedBranchesRaw) || [];
            /*
             * A CHOICE OF ONE IS NOT A CHOICE.
             *
             * A shop with a single branch was still shown a list with a single
             * card on it and asked to pick - most often after something else
             * had gone wrong, because an empty menu clears the branch and sets
             * this flag. So a waiter met a screen asking them to choose
             * between one thing, about a problem choosing could not fix.
             *
             * Below one, there is nothing to ask. Sign in again, which is the
             * screen that can actually get them somewhere.
             */
            if (Array.isArray(branches) && branches.length === 1) {
                const only = branches[0];
                localStorage.removeItem("kiosk_force_branch_select");
                localStorage.setItem("kiosk_selected_branch", only.store_id || only.branch_id);
                localStorage.setItem("branch_id", only.branch_id);
                await selectBranch(only.store_id || only.branch_id);
                return;
            }
            if (Array.isArray(branches) && branches.length > 1) {
                localStorage.removeItem("kiosk_force_branch_select");
                localStorage.removeItem("kiosk_selected_branch");
                renderBranchList(branches);
                document.getElementById("login-section").style.display = "none";
                document.getElementById("branch-section").style.display = "block";
                showBranchFooter(true);
                return;
            }
        } catch (e) { /* fall through to login */ }
        localStorage.removeItem("kiosk_force_branch_select");
    }

    /*
     * THE LOCK, BEFORE THE PHONE LETS ANYBODY BACK IN.
     *
     * Owner: "remember the password and have simple auth."
     *
     * The remembering is the token, which now lasts thirty days. That leaves a
     * phone anybody who picks it up can take orders on, which is what this
     * asks four digits about.
     *
     * Only when a PIN has been set on THIS phone. An update must never start
     * demanding a number nobody has been given, and a phone with no lock
     * behaves exactly as it did before this existed.
     *
     * Backing out does not sign anybody out - it drops to the password form,
     * which is the thing that can actually get them in. The PIN is a shortcut
     * past a sign-in, never a gate in front of one.
     */
    const locked = !!(
        POSNIC.lock &&
        POSNIC.lock.isSet() &&
        POSNIC.session &&
        POSNIC.session.active
    );

    /*
     * AND THE FINDING HAPPENS WHILE THE PAD IS UP.
     *
     * Owner: "while doing this lock first background do all finding server
     * stuff."
     *
     * Four digits take a couple of seconds; the menu takes longer than that.
     * They used to happen one after the other, so a phone waited to be
     * unlocked before it started looking, and a waiter watched a loader having
     * already done their part. Started here, the menu is usually in by the
     * time the last digit lands.
     *
     * WITHOUT THE REDIRECT, deliberately. A menu that arrives while somebody
     * is still proving they may hold this phone must not carry them onto the
     * floor; the trip happens below, after the unlock, and only then.
     */
    let prefetch = null;
    if (locked && savedBranch && !window.CaptainAccess && !forceSelect && !serverFailure && !openServerSettings && !changingServer) {
        prefetch = fetchAndStoreBranch(savedBranch, false).then(
            function () {
                return null;
            },
            function (error) {
                /* Carried rather than thrown: nothing is awaiting this yet, and
                   an unhandled rejection behind a lock screen is a red console
                   on a phone nobody is looking at. */
                return error || new Error('The menu did not load');
            }
        );
    }

    if (locked && !changingServer) {
        const who = (POSNIC.session.user && POSNIC.session.user.name) || '';
        const opened = await POSNIC.lock.unlock(who);
        if (!opened) {
            if (!window.CaptainAccess) await POSNIC.session.end();
            showLoginMessage(window.CaptainAccess ? 'Unlock again when connected, or ask your manager to reconnect this phone. Your orders are saved.' : 'Sign in with your password.');
            return;
        }
    }

    if (window.CaptainAccess && !changingServer && POSNIC.session.active && savedBranch && !forceSelect && !serverFailure && !openServerSettings) {
        const cached = await getData(STORE_NAME);
        if (cached?.length) { window.location.href = 'kot-management.html'; return; }
    }
    // Auto-load saved branch — login form stays visible during this
    // If redirect succeeds the page navigates away; if it fails login form is already shown
    if (savedBranch && (!window.CaptainAccess || POSNIC.session.active) && !forceSelect && !serverFailure && !openServerSettings && !changingServer) {
        showLoader();
        try {
            if (prefetch) {
                /* Fetched while the pad was up. What is left is the trip, and
                   the order type the floor skips its own screen for - the same
                   default fetchAndStoreBranch sets when it redirects itself. */
                const failed = await prefetch;
                if (failed) throw failed;
                if (!localStorage.getItem('orderType')) {
                    localStorage.setItem('orderType', 'Dine-in');
                }
                window.location.href = 'kot-management.html';
                return;
            }
            await fetchAndStoreBranch(savedBranch, true);
        } catch (e) {
            console.error("Auto-load branch failed:", e);
            showServerSettingsForConnectionFailure(e);
        } finally {
            hideLoader();
        }
    }

    // Always attach login button handler (onclick in HTML is also set as failsafe)
    const btn = document.getElementById("login-btn");
    if (btn) {
        btn.onclick = function(e) {
            e.preventDefault();
            doLogin();
        };
    }
    const passwordInput = document.getElementById("password");
    if (passwordInput) {
        passwordInput.addEventListener("keyup", function(e) {
            if (e.key === "Enter") doLogin();
        });
    }
});

async function logoutKiosk() {
    try {
        showLoader();

        // Clear all kiosk-related localStorage
        await POSNIC.session.end();
        localStorage.removeItem("kiosk_selected_branch");
        localStorage.removeItem("kiosk_branch_list");
        localStorage.removeItem("kiosk_force_branch_select");
        localStorage.removeItem("branch_id");
        localStorage.removeItem("orderType");
        localStorage.removeItem("lastActiveCategory");
        localStorage.removeItem("kiosk_table_no");
        localStorage.removeItem("kiosk_table_id");
        localStorage.removeItem("kiosk_discount_percentage");
        localStorage.removeItem("kiosk_discount_amount");
        localStorage.removeItem("kiosk_discount_description");

        // Clear IndexedDB stores (branch, products, cart)
        try {
            const db = await getDB(); // defined in indexedDB.js
            const tx = db.transaction(
                [BRANCH_STORE, STORE_NAME, CART_STORE],
                "readwrite"
            );
            tx.objectStore(BRANCH_STORE).clear();
            tx.objectStore(STORE_NAME).clear();
            tx.objectStore(CART_STORE).clear();
        } catch (e) {
            console.warn("Failed to clear IndexedDB on logout:", e);
        }

        // 🔁 Full reset: reload page to clean state
        window.location.href = 'index.html';
        return;
    } finally {
        hideLoader();
    }
}
