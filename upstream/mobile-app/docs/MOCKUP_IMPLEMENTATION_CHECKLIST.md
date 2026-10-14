# Approved mockup implementation checklist

Standing instruction: complete every actionable detail in both approved mockup galleries across mobile and POS, verify the flows, and deliver installable test builds. Do not call a screen complete merely because its layout exists. Keep provider certification and physical testing distinct from software verification.

Audit: 1 October 2026. Runtime target: mobile 0.3.0-beta.9 / desktop 1.8.5-beta.6.

Sources: `docs/mockups/mobile-pos/index.html` (including linked sub-screens), `offline.html`, `screens.html`, and `offline-screens.html`.

## Original gallery and linked screens

| Screen | Actionable details | Implementation |
| --- | --- | --- |
| Welcome | Logo, language before login, Cloud sign-in, free-trial creation, separate Community/local entry, training | `src/App.tsx`, `accountAuthorization.ts`, `Brand.tsx`; Cloud consent happens in the account browser rather than collecting its password in the phone. |
| Connect | Wi-Fi, QR, pairing code, address; easy return | Four local setup actions; URL normalization in `serverAddress.ts`. |
| Nearby Tills | Discover, identify shop, select, search again/stop | `discovery.ts`, native Wi-Fi adapter, verified server identity and pairing screen. |
| Address | Host/IP/link formatting and server verification | Address normalizer, capability handshake, meaningful unsupported-server message. |
| Pair code / QR | Code entry, camera, manager authorization, return | Server pairing APIs, scoped device token, desktop pairing QR. |
| PIN | Secure entry, delete, wrong-PIN response, forgot PIN, switch user | `sessionVault.ts`; pending sales/cart protected on sign-out; remembered authorization and recovery. |
| Sell | Search, compact visual tiles, hidden internal codes, scan icon, categories, quantity badge, basket amount, offline status | Paged local catalogue, exact code lookup, image cache and scanner. Favourites added in beta9; stars do not add sale lines. |
| Quick sale | Amount, optional name, review, permission | Local quick line, server-configured tax, ACL check and basket. |
| Cart | Optional customer, +/- quantity, subtotal/tax/total, payment, continue shopping | Basket controls and back-to-items; weighed quantity editor; hold/resume also supported. |
| Customer | Name, optional phone, attach, permission | Durable local customer attached to sale, validated server ingestion. |
| Payment | Total, cash, configured UPI, unavailable terminal explanation | Explicit tender selection; no fake card payment success. |
| Cash | Amount received, exact amount, change, reject insufficient cash, confirm | Minor-unit calculation, atomic sale/outbox/print intent. |
| UPI | Branch account/default, recipient, amount QR, explicit staff confirmation | All active branch accounts; optional reference; provider-only recipients cannot be falsely manually verified. |
| Receipt | Saved state, receipt identity, print, refresh Till job status, new sale | Separate local/server/cloud states and print journal; scoped Till status API. |
| Receipts | Refresh/pull-down, receipt/customer search, detail, previous/next | Local retained history, bounded navigation and gestures; active basket preserved. |
| Devices | Camera, HID scanner, Till and system print selection | Device page; direct Android Bluetooth/USB and drawer support goes beyond the first gallery. |
| Camera / external scanner | Scan-and-add, scan result, deliberate input focus, return | Product resolver and serial scan queue; weighed products ask quantity first. |
| Language | POS language packs, selection persistence | All 18 bundled languages; new beta9 controls translated in every pack. |
| More | Cashier/branch identity, connection, devices, language, lock, switch user | Workspace links; training exit and offline data also available. |

## Independent offline gallery

| Screen | Actionable details | Implementation |
| --- | --- | --- |
| Offline counter | All branch items, favourites, scan, basket, sync shortcut | Entire catalogue stored; visible pages bounded to 48; favourites scoped to cashier/branch and survive restart. |
| Offline cash | Exact amount, change, save locally | Atomic offline checkout with current signed grant. Electronic confirmation remains explicit. |
| Offline receipt | Local/server/cloud state, direct print, no duplicate Till print, new sale | Durable print ownership and idempotent ingestion. |
| Receipt printer | Exact saved printer, paper width, test print, reconnect, alternate routes | Android Bluetooth Classic SPP / USB printer class; reconnect uses saved identity on next deliberate attempt. |
| Printer attention | Explain uncertain output, confirm paper, deliberate reprint, decide later | Receipt journal retains uncertainty; another copy requires explicit confirmation; back/new-sale leaves it for later. |
| Sync centre | Waiting, accepted, cloud, review, retry, catalogue shortcut | Outbox states and explicit cloud proof; pending data protected. |
| History | Search/refresh, retention, older connected search | Default 90 days/10,000 acknowledged receipts; pending/review/printing records protected. |
| Offline data | Catalogue, images, receipts, pending, storage, expiry, sync link | Actual measured values. Beta9 fixes thumbnail count to cover the full catalogue rather than the current page. |
| Desktop offline/storage | History days, maximum receipts, 1–72-hour grant, save with permission | POS `api/src/routes/mobile-pos-setup.js` and `mobile-pos.routes.js`; Settings → Mobile POS. Features remains a switch only. |

The shipped app keeps three primary tabs (Sell, Receipts, More); Sync and Devices have workspace entries, and Sync is also reachable through the status badge. This preserves the original navigation while supplying every offline gallery destination. Prototype simulation buttons are replaced with real status and recovery actions, not exposed as fake production controls.

## Verification and boundaries

- Repository tests: favourites persist without modifying the cart; cashier/branch isolation; absent/inactive items cannot be newly starred; empty filters show no products.
- SQLite test: selected IDs filter the full 10,017-item catalogue and combine with search; no unbounded placeholder list.
- Browser tests: favourite toggle does not charge; restart and removal; 60 cached thumbnails report 60 even though only 48 products are rendered.
- Existing browser coverage: light/dark/narrow layouts, 18 languages, PIN recovery, offline checkout, scans, history gestures, storage and large catalogue.
- POS integration coverage: real database sale ingestion, replay protection, scoped history, grants, receipt routes, desktop setup and cloud delivery.

Card terminals, NFC acquiring, scales and other entries explicitly labelled “planned”, “Soon” or “provider integration required” in the approved HTML are roadmap placeholders, not implemented payment providers. Physical printing still requires testing on the shop's hardware. These limits must stay visible in the release guide; software tests do not certify paper delivery or bank settlement.

## beta13: choose the server before signing in

Local setup now has separate discovery/address and authentication steps. Wi-Fi results are tappable server cards with a server icon, explicit Use this server action, address, version and arrow. Incompatible servers remain disabled with an explanation. Selecting a server stops discovery and shows only that endpoint's sign-in or pairing form. Change server clears the password and returns to selection; manual addresses are probed before showing credentials. QR setup opens the selected-server form. Focused setup screens omit welcome/training content and duplicate back buttons.

All four new messages ship in all 18 languages. Verification: 80 unit tests, 39 browser tests, and 24 POS integration tests passed. The Wi-Fi browser test replaces only the unavailable browser Wi-Fi adapter with a fixed local IP and mocks LAN responses; physical phone networking still needs pilot confirmation. The test covers three discovered servers, incompatible-server disabling, no credential fields/requests before selection, and switching without carrying a password. Android ARM64 release build verified separately.

## beta14: preserve item-list position when adding to the basket

Basket reloads deserialize a new favourites array. The catalogue effect previously treated that new array identity as a filter change and temporarily removed all product tiles, collapsing the scroll position. It now depends on the selected favourite IDs only when the favourites filter is active. Genuine filter and catalogue changes still refresh results.

Regression reproduced on beta13: selecting a bottom product reset scrollTop from 3129 to 0. Both ordinary and favourite-filtered lists now retain their exact position through repeated additions. Verification: 80 unit tests and 41 browser tests passed, plus typecheck, formatting and attribution checks. Physical Android confirmation remains part of pilot testing.

## beta15: desktop Wi-Fi product images

The installed desktop serves product images at `/uploads/...`; the mobile downloader previously used only `/api/uploads/...`, which the cloud proxy supports but the desktop returned as 404. On an API-prefixed upload 404, download from the paired server's root upload path. Keep the same cache key so completed downloads remain available offline. No fallback for another origin, authentication/permission failures, redirects or unrelated paths; byte limits and image validation still apply.

Verified against the running desktop: the original URL returned 404; the root path returned JPEG, 18,159 bytes, and the updated downloader successfully read it. Regression tests cover fallback caching and offline reuse, plus origin/path/status restrictions. Physical phone display remains for pilot confirmation.

Additional beta15 verification: browser regression downloads a desktop image through API-path 404 → root upload 200, verifies that the decoded image renders, then reloads the app with shop/image requests blocked and verifies the cached image still renders without another image request. This uses simulated desktop responses; the desktop was closed during the follow-up check.
