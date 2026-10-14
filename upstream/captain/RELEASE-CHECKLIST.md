# Captain release verification

A successful build proves packaging, not that a waiter can place an order.
Browser tests do not verify Android WebView, native secure storage, or the
installed app's network behavior. Report those checks separately.

Before a routine release:

1. Run `npm run check`, `npm run build`, `npm run check:native`, and
   `npm run check:attribution` on the contents being released. Keep test logs,
   investigate failures, and record any focused reruns and intermittent tests.
   Never skip verification merely to create a commit. Keep tests local as
   configured for this repository.
2. Install the candidate on an Android phone. Test both an upgrade from the
   previous release and a fresh installation on a test device. Never clear a
   restaurant phone's app data to make a test pass.
3. Against a test till on Wi-Fi, select its address, sign in, verify automatic
   navigation to Tables, open New order, select a table, and load the menu.
   Repeat with takeaway, multiple branches, and an existing saved session.
4. Submit a test order and verify it once in the till and kitchen. Check fixed
   exclusive/inclusive prices, variable prices, modifiers, discounts, charges,
   and supported payments, including split payment. Use a sandbox, not a live
   restaurant's sales ledger.
5. Interrupt Wi-Fi during menu download and order submission. Verify bounded
   failure, visible error, retry without duplicate orders, and retained drafts.
   Resume from background, restart the app, and verify reconnection. Test cloud
   access separately; cloud success does not establish LAN compatibility.
6. Record app version/commit, phone OS and WebView version, till version,
   pass/fail results, and any untested cases. A missing device is **not tested**,
   never passed. `check:device` currently checks connectivity only and can skip
   when no device is attached; it does not replace steps 2–5.
7. Publish the verified commit. Verify workflow completion, signing status,
   downloadable artifacts, checksums, and embedded version/commit. Pilot on one
   device before updating the remaining restaurant phones. Retain the prior
   signed release and investigate failures without deleting order data.

For an explicitly authorized urgent recovery release, state any omitted device
checks and unresolved cause in the release notes. Do not describe a recovery or
diagnostic improvement as a verified repair of an unreproduced device failure.

## 1.3.32 scope

This release keeps menu-download errors visible after successful sign-in and
replaces the endless table-cache wait with a download and Retry action. It adds
browser coverage for native session storage and menu failure/recovery.
The reported Azure phone failure was not reproduced on a connected Android
device; its underlying cause remains unconfirmed.

## Checkout price contract

Run `tests/checkout-selling-price.spec.js` with `POS_CHECKOUT_PAYLOAD` set to an
output JSON file. Set `POS_API_ROOT` to the compatible POS checkout's `api`
directory, then run `node scripts/test-pos-checkout-contract.cjs <output JSON>`.
This creates a disposable database and checks the browser's actual checkout
payload against POS pricing, table occupancy, kitchen delivery and duplicate
protection. It never connects to a restaurant database. Repeat for pricing
changes; a mock returning success for any order is not acceptance evidence.
