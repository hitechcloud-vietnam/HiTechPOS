# Independent offline counter beta

1 October 2026. Android `0.3.0-beta.9`, matching Windows `1.8.5-beta.6`.

## Included

- Android Bluetooth Classic SPP adapter using ESC/POS raster receipts at 384/576 dots (typical 58/80 mm profiles). Localized text is rendered on the phone. USB printer-class bulk ESC/POS is also supported through an Android OTG connection. Generic NFC/card capture and iOS direct adapters are not included.
- More → Printing: choose Direct receipt printer, list paired Bluetooth devices or USB printers (OTG), authorize the selected USB device, choose width, and run a test print. Names are paired device names, not proof of compatibility or connection health. The native option is absent from web/iOS and builds without the module.
- Cash sales and print intents are saved locally together when Bluetooth automatic printing is enabled. Printing does not depend on sale upload or on a reachable Till.
- A durable journal prevents concurrent or automatic repeated sends of the same receipt. Recovery after an interrupted send reports an uncertain outcome. An explicit, audited reprint requires the cashier to allow another copy.
- A successful Bluetooth write is submitted, not proof of physical paper output. Paper confirmation is optional for a normal submission. Queued, failed or uncertain jobs need resolution before signing out; a normally submitted job does not block sign-out or acknowledged-receipt retention.
- Direct print jobs cannot also enter the automatic Till queue. Printer failure does not discard the paid sale.
- POS → Mobile POS settings controls local receipt history: 90 days/10,000 acknowledged receipts by default. Both bounds apply; older records remain on the server. Bounds: 1–365 days, 100–100,000 receipts. Old clients omitting the new fields preserve existing values.
- Items are never subject to the receipt limit. Pending/review sales, outbox records and unresolved direct prints are protected. Till-queued receipts are conservatively protected until a separate final-status retention contract is implemented. Cleanup runs at startup and after a sync pass.
- More → Offline data is a dedicated screen showing item count, local receipt count, protected pending sales, catalogue refresh time, offline-grant expiry and received history policy. Connection & sync shows server-accepted and pending/review counts with receipt drill-down and a separate printer-attention list. Refresh gestures apply to these data screens. New mobile text is supplied in all 18 bundled locales; language review remains welcome.

- Receipts → Find an older receipt searches the signed-in cashier’s mobile receipts on the paired shop server. Searches are literal and paginated, 50 results at a time, newest first. Server receipt details are read-only; they do not enqueue another upload or print. Other cashiers and branches are excluded even when client parameters are altered. This does not expose all desktop sales.
- The app explicitly distinguishes server acceptance from cloud confirmation. The app reports cloud receipt delivery only when the signed sync component has stored an explicit matching gateway acknowledgment. Community installations and older components keep the server-only status.

## Beta9 mockup completion

Favourites persist per cashier/branch and work without a network. Tap the small star without adding a sale line, then use the Favourites filter. Offline Data reports downloaded thumbnails for the whole catalogue. See [the full mockup checklist](MOCKUP_IMPLEMENTATION_CHECKLIST.md). This update reuses the verified Windows beta6 installer.

## Test on a phone

1. Install the Android beta and pair to a test branch. In Android Bluetooth settings pair an ESC/POS Bluetooth Classic SPP printer. Bluetooth LE-only printers do not use this adapter.
2. In More → Printing choose Direct receipt printer, list paired Bluetooth devices or attached USB printers, select the printer and width, then print a test. Check alignment and all languages used by the shop before using real transactions.
3. Enable automatic printing. Turn off internet and shop Wi-Fi, keeping Bluetooth enabled. Add several items, accept cash and verify both the saved receipt and paper output.
4. Close/reopen the app and verify the saved sale remains. Reconnect to the shop; the sale should upload once without creating an extra Till receipt.
5. Switch off the printer before a sale. The sale must remain saved; after reconnecting, open its receipt and retry. Disconnect during a longer receipt: check the paper and use the explicit another-copy control only if needed.
6. Turn on the phone PIN and repeat lock/unlock and restart. Check permission denial, denied Bluetooth permission, wrong device selection and disabled Bluetooth.
7. Set a shorter history policy on the desktop test branch. Sync and restart. Acknowledged eligible receipts can disappear from local history, but pending sales and unresolved prints remain. Catalogue count must not shrink because of receipt retention.

8. Open More → Offline data and verify the catalogue, expiry and history limits. Open Connection & sync, then a pending receipt or printer-attention entry. Return to Sell and verify an unfinished basket is unchanged.
9. After synchronizing a sale, open Receipts → Find an older receipt. Search its receipt number or customer name. Open a result and confirm the total. Test a read-denied cashier and an unreachable server; local selling/history must remain intact.

## Mockup implementation map

| Design journey | Application entry point |
| --- | --- |
| Offline counter | Sell, using the saved branch catalogue |
| Cash payment | Cart → Take payment → Cash |
| Saved receipt | Sale completion and Receipts |
| Direct printer | More → Printing → Direct receipt printer (Android Bluetooth/USB) |
| Printer attention | Connection & sync → Check the paper; explicit confirmation/reprint on receipt |
| Sync centre | Connection & sync, receipt drill-down and refresh |
| Receipt history | Receipts, local search and server older-receipt search |
| Offline data | More → Offline data |
| Desktop settings | Mobile POS module: retention, offline access and printer route guidance |

Storage values are measured from the native database, WAL and image directory (browser preview uses its origin storage estimate). Product image counts include successfully cached images. Cloud receipt confirmation is shown only when the installed sync component and gateway support protocol 1 and return matching evidence. The desktop printing policy uses the existing receipt Till assignment; no setting was added to a Features card.

Do not clear app storage or uninstall while sales are waiting to synchronize. This beta's APK uses the existing development signing certificate; Windows package is unsigned. These are pilot artifacts, not store releases or printer certification.

## Validation and boundaries

Software checks cover journal persistence, concurrent attempts, disk-write failure, restart uncertainty, explicit reprints, no dual Till delivery, localized raster source, protected cleanup, the 10,000-receipt boundary, server settings and existing sales/pairing flows. Native Kotlin compilation and Android release assembly are checked. Software tests cannot prove a particular printer's buffers, paper handling or Bluetooth firmware behaviour.

The wider roadmap remains open: iOS/vendor adapters, cross-authority reconciliation, richer item selling options, and provider-verified electronic payments. Existing offline authorization remains 24 hours by default, configurable 1–72; it has not been silently extended. Existing cash/manual-UPI semantics and ACL remain in force.

Technical references: [Expo local modules](https://docs.expo.dev/modules/get-started/) and [Android Bluetooth connections](https://developer.android.com/develop/connectivity/bluetooth/connect-bluetooth-devices).

## Beta 5 catalogue, images and drawer checks

- Catalogue protocol 1 uses immutable 256-item pages. The server streams items into persisted pages instead of embedding the whole catalogue in one MongoDB grant. Phones reuse unchanged pages and resume completed pages after interruption. A complete, validated catalogue replaces the previous catalogue atomically; missing/deleted products disappear from new baskets. Old paid/held price snapshots remain verifiable against their issuing grant. Older servers/clients retain the legacy bootstrap path.
- The 10,000 receipt default is never applied to items. Automated integration inserts 10,017 additional items, tests page/device scope, price changes, page reuse, deletion and ingestion against the old grant.
- Images download independently with two concurrent requests, a 2 MB per-image limit and a 100 MB free-space reserve. Partial files are not displayed. Completed images survive restart; unavailable images use the configured icon. Obsolete image files and stale partials are cleaned within the application's image directory. No sale or catalogue record is evicted to make room. This resumes completed image jobs, not partial bytes.
- More → Offline data reports the cached image count and measured app/free storage. Values refresh while the screen is open. Browser estimates describe that preview origin; native values cover the local database files and product images, not the installed application binary.
- Android USB discovery accepts only a printer-class interface with a bulk OUT endpoint. It does not claim keyboard scanners, storage or payment readers. Saved profiles use vendor/product identity plus serial where permission exposes it. If a reconnect cannot prove the same identity, select/authorize the printer again. No fallback goes to another printer.
- A compatible drawer connected to the receipt printer can be enabled in More → Printing. Connector pin 2 is the default; pin 5 is selectable. The first cash receipt sends a 100 ms pulse after its receipt bytes; test prints, electronic payments, training, retries and reprints never pulse it. The durable print journal records whether the initial attempt was authorized to pulse. If delivery is uncertain, inspect the drawer and paper; there is no automatic second pulse or unpermissioned no-sale open action.

Additional phone checks: interrupt a catalogue download and reconnect; change/delete an item at the Till and refresh; load pictures then disconnect/restart; deny USB permission, unplug/reconnect OTG and try a non-printer USB device; enable the drawer only after checking its printer specifications, then confirm a cash receipt opens it once and reprinting does not.

Beta 7 replaces full-array catalogue browsing and activation with bounded local pages. Provider card authorization, cloud failover and physical hardware certification are separate release gates.

Technical references: [Android USB host](https://developer.android.com/develop/connectivity/usb/host), [Expo persistent files](https://docs.expo.dev/versions/latest/sdk/filesystem/) and [Epson ESC p drawer pulse](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/esc_lp.html).

## Cloud receipt evidence (beta 6)

The gateway returns a mobile receipt acknowledgment only after a matching mobile sale write succeeds with majority/journal acknowledgment. A skipped or rejected write does not produce proof. The local signed sync component records the transaction ID, server receipt ID, branch, gateway authority and receipt time before advancing its checkpoint or clearing its priority marker. An absent outbox marker is never interpreted as confirmation.

The authenticated phone queries up to 50 of its server-accepted receipts per pass, rotating through unresolved entries. The POS filters by license, branch, staff and issuing device, then matches the exact transaction, server receipt and sync authority. Only that evidence adds the Received in cloud label. Failed status reads never repeat a sale or clear its accepted status. Images, printing and cash selling remain independent.

This confirms receipt delivery, not completion of stock or every other collection. It does not enable automatic writes through a second, independent cloud ledger. The installed signed sync component and gateway must both include the new protocol; updating only the Android app cannot manufacture this capability. Community users retain the existing server-only flow.

Pilot: make a mobile cash sale through the local Till, disconnect cloud access and confirm it remains shop-server accepted without a cloud label. Restore cloud sync; once the gateway acknowledgment is recorded, Sync now should show Received in cloud on that receipt. Disconnect again and restart: the recorded evidence remains available. Do not use an empty queue, network reachability or a batch count as a substitute for this test.


## Beta 7 large-catalogue operation

Android keeps a transactional SQLite index for barcode, item code and category. Product names are normalized for Unicode substring search; that search scans the local index, not decoded product objects. A visible page contains at most 48 products. Scanning and exact-code entry query the whole local catalogue independently of the current page. Browser preview uses an IndexedDB cursor with the same bounded result size.

Paged-server downloads return persisted page references. Activation reads at most 256 items at a time, replacing catalogue records, index and offline grant in one transaction. A missing page, duplicate identifier or failed write rolls back the entire activation. The previous catalogue and held/paid price snapshots remain intact. Legacy servers retain their existing array bootstrap compatibility path. Identifier validation uses a compact set; product payloads are not assembled into a full array.

Images stream through two transfers and the UI retains image data only for its visible page. Full catalogue/image counts remain separate from the visible product count. Search and page changes discard obsolete asynchronous results. No network is required to browse or scan the indexed catalogue.

Test with more than 10,000 products: find and scan a product near the end of the catalogue, search a localized name, change categories/pages, restart offline, and refresh after deleting a product. Automated checks cover migration from the prior local schema, exact lookup beyond the first page, Unicode search, failed activation, duplicate pages, and the 10,017-item catalogue without reading every product into the session.


## Beta 8 weighed-item entry

Items configured on the Till as weight-machine based with a selling unit can now be sold by entered quantity. Selecting or scanning one opens quantity entry; enter up to three decimals in the displayed unit. Pending HID scans are explicitly paused while entering weight. The app does not guess a weight from a normal product barcode or claim automatic weighing-machine support. Piece-count items remain integral.

Tap a basket quantity to edit it. Reducing it still requires the existing void-line permission. Receipts and server history show the unit. Money/tax remain integer minor units with defined half-up line rounding. The server validates the quantity precision against the issuing grant, retains the configured unit and reuses the existing immutable sale/stock identity on retry. Older phone versions keep weighed items unavailable.

Pilot: configure a kg item on the Till; refresh; select it and try 0.125 kg, a localized decimal separator and excess precision. Scan the same item with a camera/HID scanner. Save a cash sale offline, reopen, reconnect and retry; confirm one sale, one stock movement and the printed quantity/unit. Test a cashier without void permission. Variants, modifiers, controlled discounts and provider electronic payments remain separate contracts.
