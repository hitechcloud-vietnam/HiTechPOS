# Posnic Mobile POS: research and delivery roadmap

Date: 21 September 2026. Status: approved design; mobile alpha implementation underway.

## Product decision

Build a dedicated, open-source mobile till. A cashier opens the app and sells immediately: choose an item or enter an amount, collect payment, start the next sale. Android first, with an iOS-compatible architecture. Community servers, LAN installations, self-hosted public servers and Posnic Cloud use the same app and capability contract.

Offline selling, a local catalogue and QR/code enrolment are first-release requirements. This supersedes the August Square study's online-first mobile proposal and its decision to defer pairing and offline storage. It does not replace the responsive desktop/web work described in the older Mobile Experience Plan.

Owner clarification, 21 September 2026: direct mobile printing, reuse of till-configured printers, connected payment devices and QR collection are core capabilities. Heavy configuration and orchestration belong on the till/server. Supported payment-device integration is promoted into the first-release scope; it is no longer deferred as a whole to a later card-SDK phase.

This document defines the approved target. The repository now contains a React Native mobile alpha with local sales and contract-gated integrations. See IMPLEMENTATION_STATUS.md for verified behaviour and remaining release work. The proposed server API is not yet shipped; no production server was changed.

## 1. Evidence and what to adopt

Internal research reviewed: Square Study — Mobile and Quick Sales; Loyverse Field Study Analysis; Lightspeed Field Study Analysis; Vyapar & myBillBook Field Study; Mobile Experience Plan; Device Enrolment and Trust; Sync Integrity Designs. Historical statements about shipped features are treated as historical observations, not current proof.

Current public documentation reviewed on 21 September 2026:

| Source | Relevant observation | Posnic decision |
|---|---|---|
| [Square custom sales](https://squareup.com/help/us/en/subtopic/custom-sales-and-amounts) | Custom amounts, notes and split payments are normal checkout features. | Give Quick amount equal prominence with Items. No compulsory item/customer creation. |
| [Square device codes](https://squareup.com/help/us/en/article/8339-set-up-device-codes) | A device code can enrol a till without sharing the account password. | Short-lived, one-use pairing grants; separate device trust from cashier identity. |
| [Loyverse item creation](https://help.loyverse.com/help/items-categories) | Staff can create items from the POS app. | Minimal item creation is appropriate, subject to existing ACL and shop-required fields. |
| [Loyverse offline operation](https://help.loyverse.com/help/offline-work-of-pos) | Local sales and shifts continue; unsynced receipts are visible. Refunds and customer edits have offline restrictions. | Make sync state visible; define each offline capability explicitly; protect unsent sales from logout. |
| [Square offline payments](https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode) | Offline card collection has hardware, payment-method and upload constraints. | Never equate an offline sale with verified electronic payment. Card capture needs its own certified provider integration. |
| [Razorpay QR webhook documentation](https://d6xcmfyh68wv8.cloudfront.net/docs/payments/qr-codes/subscribe-to-webhooks/) | QR payment events can notify a server. | Confirm integrated UPI on the server through provider evidence; reconcile delayed events. This is a legacy documentation URL; revalidate the deployed provider contract in Phase 0. |

These are product precedents, not a universal POS standard. The recommendation combines them with Posnic's existing behaviour and the current request. The older Indian competitor study informs simple configurable forms; its desktop findings are not treated as proof of those vendors' current mobile capabilities.

### Current code findings

Paths below are relative to the named repositories and describe the inspected checkout.

| Evidence | Confirmed | Consequence |
|---|---|---|
| `captain/package.json`, `README.md`, `config.js` | Capacitor app; scan, LAN discovery and shop/address entry; `/api/runtime-info` probing; authenticated same-shop address history; guarded request replay. | Reuse protocol knowledge and fixtures. Port carefully if using React Native. |
| `POS/api/src/routes/pair.routes.js` | The displayed QR contains an address, not an enrolment credential. | Keep address QR compatibility, but add authenticated one-use device grants. A shop code is not a secret. |
| `captain/config.js` | A network timeout is explicitly treated as an ambiguous write; automatic replay is restricted. | Do not blindly submit a sale to both LAN and cloud. |
| `POS/api/src/v1/index.js` | Versioned reads and whitelisted customer writes; cursor pagination. | Add mobile checkout and sync contracts. Ordinary paginated reads alone are not a full consistent snapshot/delta protocol. |
| `POS/api/src/constants/roles.constants.js` | Existing item/customer CRUD, quick-sale, price-override, discount, refund and register permissions. | Enforce these on device and server; extend only where a genuine distinction is missing. |
| `POS/api/src/repositories/sale.repository.js` | Order idempotency key handling and a per-license unique index exist. | Reuse the principle, but prove complete paid-sale, payment, stock and print idempotency separately. |
| `POS/api/src/routes/sales.routes.js`, `models/sale.model.js` | Razorpay QR generation/status/close paths exist with kiosk-specific guards. | Build a staff/device-authorized payment adapter; do not embed the kiosk key in the new app. |
| `POS/api/src/utils/runtime-info.js` | Runtime edition, mode and schema/capability reporting exist. | Negotiate capability support; an older server gets an actionable upgrade message. |

## 2. The everyday interface

Bottom navigation: **Sell · Held · Receipts · More**. Sell is the home screen. No dashboard, graphs, purchase orders or reports.

- **Items:** local search by name/SKU/barcode, favourites, categories, camera scan and compatible scanner input. Tap adds one; a compact editor handles quantity, variant, required modifiers, note and permission-based discount/price override. Never silently omit a required modifier or serial/batch constraint.
- **Quick amount:** big numeric keypad; amount required, description optional. Enter 150 → Charge → Cash → Done. No customer form, catalogue write or stock movement. Use an ordinary auditable sale with a synthetic line. Tax wording reflects the branch's configured treatment; a configured quick-sale tax profile is required, rather than guessing a rate.
- **Cart:** walk-in by default, optional customer, quantity controls, clear total, Hold and Charge. Preserve the cart across lock, app restart and interruption. Require confirmation before discarding a nonempty cart.
- **Payment:** configured methods only, ordered by usage. Cash with exact amount and change; UPI QR; externally collected tender if enabled; split tender with the remaining balance always visible. An external-card entry records a payment, it does not process a card.
- **Done:** prominent New sale; optional receipt print/share. Receipt delivery must not delay the next sale. Receipt screen distinguishes sale saved, payment state and sync state.
- **Held:** resume on this device offline. Other-device holds require server contact and revision/ownership checks. Restaurant table/KOT controls appear only when the branch supports them.
- **Receipts:** recent authorized sales, customer search, reprint/share, online permission-based return/refund. This is operational history, not a report suite.
- **More:** customers, items, register session, connection & sync, printer, lock. Hide unauthorized management actions. Mobile-specific server settings belong on a Mobile POS module page, never inside Features cards or an unrelated Integrations page.

### Minimal creation and permissions

| Action | Proposed access and form | Offline behaviour |
|---|---|---|
| New customer | Existing customer write permission. Name or phone; other fields optional unless the transaction requires them. | Save a local draft with a stable ID, attach to sale, sync before dependent sale. Duplicate matches require review; never silently merge balances or identities. |
| New item | Existing item write permission. Name, sale price, category if the shop requires it; inherit permitted defaults, disclose tax. More fields only when required. | First release: online only. Offer Quick amount while disconnected. This avoids ambiguous catalogue conflicts. |
| Change catalogue price | Item write permission and version check; separate from price override. | Online only in the first release. |
| Change this sale's price | Existing price-override permission, with an audit reason when required. | Only within the cached offline authorization. Does not alter master price. |
| Discount | Existing discount permission and cap; manager approval where required. | Cached allowed limits only. No new manager privilege granted by an unverified PIN. |
| Refund, account credit, loyalty/gift-card redemption | Permission and authoritative balance/payment check. | Online only for first release. Cash-sale records are never deleted to simulate a refund. |

Use 48dp Android / at least 44pt iOS targets, screen-reader labels, scalable text, locale-aware money and dates, and non-colour status labels. All 18 languages in the current POS registry, including every beta language, are required for the first app release (see below). Native review improves quality but does not hide beta languages. Tablets expand to an item pane and cart pane without adding administration.

### Numeric item shortcuts shared with desktop

Owner requirement, 21 September 2026: items need short numbers that work in mobile selling, desktop selling and item management. Inspection confirms an existing `plu_code` field in `POS/api/src/models/item.model.js`, write normalization/search in `repositories/item.repository.js`, a **Quick code** input in `frontend/modules/items_write.html`, and item-form/sale-screen support in `frontend/static/script/js/modules/js/{items,sales}.js`. Reuse it; do not create a mobile-only `item_number` field.

- Label **Quick code** consistently, with a short example such as “22 — enter this number to find the item.” Keep it optional and distinct from price, quantity, internal database ID, SKU and manufacturer barcode/GTIN. Internal identifiers and standardized product identifiers serve different purposes; [Square's SKU guidance](https://squareup.com/help/us/en/article/7632-auto-generate-skus-with-square-for-retail) makes the same distinction. Our short numeric shortcut is a shop convention, not a claim of globally assigned produce PLUs.
- Preserve the existing 1–6 digit contract. Store codes as strings so `0022` does not turn into `22`. Normalize supported Unicode decimal digit input to ASCII consistently on mobile/server/desktop before validation; reject non-digit content and overlong input rather than silently clearing it. Leading-zero codes remain distinct; show the full code to prevent confusion.
- Sell offers a **Code** keypad beside normal text search and scanning. Enter a code and press Add/Enter: exact lookup from the local branch catalogue; one unambiguous eligible item adds immediately. Do not auto-add at the first matching digit (`2` may be the start of `22`). No match leaves the cart unchanged. Multiple matches require a picker, never first-result selection.
- Keep the code internal: **never display it on sale catalogue tiles/lists, item artwork or customer receipts**. Preserve the image, shape or emoji chosen in item creation, with a compact name and price. Item management retains the optional code field under item-write ACL. A small keyboard icon opens code entry on demand; a small scan icon opens scanning. Both have accessible labels and 44–48px touch targets without wide text buttons. Quick amount remains a separate money keypad, clearly labelled, so `22` cannot accidentally charge ₹22 while in item-code mode. This corrects the earlier proposal to expose codes on selling tiles.
- Enforce uniqueness among simultaneously saleable items within a branch's effective catalogue, including shared items. Run a duplicate/leading-zero audit before enforcing a constraint on existing shops. Online concurrent writes must reject a collision consistently. Codes can be reused across isolated branch catalogues, but a shared item must not collide in any assigned branch. Backend schema/index strategy needs to match actual item branch scope; do not assume a naive compound index covers shared items.
- Item codes select the parent item unless a separately addressed sellable variant has its own agreed code. Required variants/modifiers still open their selector. No silent default variant. Barcode/weight-barcode processing remains in its existing path.
- Changes propagate through the same catalogue snapshot/delta protocol; code-to-item indexes update atomically. Offline devices may have a stale mapping, so show item name/price and store the item ID/code snapshot on the sale. Do not routinely reassign a recently used code to a different product while offline catalogues remain valid.
- App-first work uses this existing contract. Desktop follow-up audits collision handling, validation parity and keypad convenience; do not rebuild its already existing Quick code feature.

### Language scope: all current languages, including beta

Current source of truth: `POS/frontend/gulpfile.js/config.js`, `LANGUAGES`, inspected 21 September 2026. It contains 18 entries; the older architecture document's count of 14 is historical.

| Status in POS registry | Languages |
|---|---|
| Reviewed | English (`en`), Tamil (`ta`) |
| Beta | Hindi (`hi`), Malayalam (`ml`), Kannada (`kn`), Telugu (`te`), Sinhala (`si`), Nepali (`ne`), Arabic (`ar`), French (`fr`), Spanish (`es`), Portuguese (`pt`), Indonesian (`id`), Thai (`th`), German (`de`), Swahili (`sw`), Dutch (`nl`), Italian (`it`) |

Use shared language identifiers, native names, direction and beta metadata. Reuse existing translations/glossary for matching meanings and add mobile-specific keys. Desktop's reviewed status does not certify newly introduced mobile wording: track mobile pack coverage/review separately. Offer all beta packs in the normal language menu, clearly labelled; do not compile an English/Tamil-only app by default.

Bundle the compact mobile UI text packs so every supported language is selectable from the first offline launch, without downloading the whole desktop UI. Bundle or otherwise guarantee required font glyphs offline. Use BCP 47 locale matching on first run, English fallback, then persist the user's explicit selection. Language switching must preserve cart, pending payments and outbox. Translate validation, offline states, device errors, permissions, accessibility labels and receipt labels as well as navigation. Do not translate customer names, item names, item codes or UPI IDs automatically; use optional catalogue translations only when supplied.

Arabic requires RTL layout, logical spacing and bidi isolation for codes, amounts, UPI IDs and mixed-script names. Receipt language is a separate shop/customer preference from the cashier UI. Test Tamil and other complex-script shaping on 58/80 mm printers; use a tested raster rendering path where printer fonts cannot render a script. Currency/tax jurisdiction comes from the branch, not the selected UI language. Support long labels, large text and locale-aware pluralization without string concatenation.

Release gates: all 18 packs selectable offline, complete nonblank required mobile keys and intact placeholders, English fallback for unforeseen server errors, no raw translation keys, RTL and mixed-script checks, and translated checkout/receipt paths. Record beta quality honestly and invite native review; beta languages remain available.

## 3. Pairing and server connection

1. Start screen: Scan shop QR, Enter pairing code, Find on Wi-Fi, Enter server address. Camera denial always leaves the other methods available.
2. A legacy address QR or shop code locates a server; staff must authenticate. A new pairing QR includes server locator, expiry and a one-use enrolment token. Pairing codes are issued by an authorized owner/manager on the server and redeemed atomically with rate limits.
3. A short code alone cannot discover an arbitrary private LAN server. Cloud codes can use a known resolver; community codes require LAN discovery or a server address first. A full QR can carry the locator. Community pairing must work without a Posnic Cloud account.
4. Show verified shop and branch; enrol device; select authorized cashier/PIN. Device credentials do not confer owner privileges. Codes must not contain a long-lived password or payment secret.
5. Download a consistent branch catalogue and permitted settings. Show progress and resumable errors. Mark **Ready offline** only after the minimum snapshot, pricing/tax rules and offline grant are committed. An incomplete catalogue is never represented as complete.
6. Use the pinned address if configured. Otherwise prefer a verified reachable shop LAN server; use a verified public endpoint when available. Validate stable shop identity, branch and authority, not just hostname or `/runtime-info` branding. Obtain endpoint-appropriate credentials.

Discovery is bounded and cancellable. Reuse Captain's tested native network approach and manual fallback; evaluate service discovery rather than promising that mDNS already exists. Handle guest Wi-Fi isolation, subnet changes, denied local-network permission and multiple shops on one LAN.

Require HTTPS for public servers. For LAN, prove secure transport/certificate trust on real devices in Phase 0. Never disable certificate verification globally. If supporting legacy HTTP LAN installations, make the weaker transport an explicit deployment mode with restricted network security configuration and a migration path; do not silently send durable credentials to an untrusted discovered host.

## 4. Offline is the core architecture

Use a persistent SQLite database, indexed catalogue/search, local image thumbnails and an atomic transaction outbox. Bundle app assets. UI reads local data even while online; network latency must not gate add-to-cart.

### Three conditions, three honest labels

| Condition | What works | Label |
|---|---|---|
| Internet and selected server reachable | Selling and supported server/provider actions | Connected |
| Internet down, authorized LAN server reachable | Server-backed selling and LAN printing; external services depend on their own reachability | Shop Wi-Fi connected |
| No authorized server reachable | Local catalogue, cart, held sales, cash, eligible staff-confirmed tender, local customer drafts, local receipts | Offline · N sales waiting |

Internet coming back is not sufficient when a community server remains off or unreachable. Sync resumes when the relevant authority is reachable. Initial pairing and first download require that server; offline operation requires a previously initialized device. Background sync is best effort under mobile OS limits; also run on foreground/resume and explicit retry.

### Transaction and reconciliation contract

1. Allocate a stable device-generated sale ID and operation ID before payment. Store money in currency minor units with decimal-safe quantity/tax calculations. Persist branch, staff, device, register session, pricing/tax rule version, timestamps and receipt sequence.
2. Commit sale, tender evidence, stock intent and outbox row in one local database transaction. Only then show **Saved on this phone**. If storage is full or the commit fails, do not show success.
3. Upload with at-least-once delivery and a durable deduplication key. The server returns the original result for an identical retry; rejects different payloads reusing that key. Deduplication must cover payment, stock, receipt number and print side effects, not just the sale document.
4. Checkpoint downloads only after durable local apply; include tombstones, stable ordering, snapshot watermark and reset/rebootstrap handling. Do not use phone timestamps as sync truth.
5. Preserve completed-sale prices and tax snapshots. New catalogue prices affect new lines; do not reprice a customer's completed sale during sync. Illegal/unsupported stale rules become explicit review items, not silent rewrites.
6. Treat stock as approximate offline. Apply immutable sale/movement operations exactly once at the authority. Do not upload an absolute quantity that overwrites another till's sales. Businesses requiring strict serial, batch or stock reservation must block those unsupported offline lines with a clear reason.
7. Local drafts and uploaded results remain recoverable across process death, reboot and migration. Never clear unsent sales on logout, unpair, branch switch or app upgrade. Locking is always allowed. OS uninstall/device loss can still destroy unsynced records; disclose this at destructive actions and support a protected recovery procedure.
8. Outbox states: pending → sending → acknowledged, with retry-wait or needs-attention. Distinguish expired authorization from transient failure. A review screen offers plain-language remediation and never silently drops a paid transaction.

### LAN/cloud authority: release-blocking decision

Same shop is not enough to make writes safe on two independent databases. The first release pins each queued sale to an issuing write authority and holds ambiguous writes until that authority can answer. It can continue recording new permitted sales locally. Automatic write failover is enabled only after server-side globally stable sale IDs, stock/payment deduplication and merge behaviour have been proven across LAN/cloud replication. Read failover can be less restrictive but must preserve the same shop/branch and an accepted snapshot version.

Do not redesign Posnic's protected desktop sync as a side effect of building a mobile UI. Add the smallest mobile command contract that fits it, document the authority boundary, and test the two-server replay case before broad rollout.

### Offline authorization and privacy

Server-issued, scoped, expiring offline grants bound to device, branch and staff; owner-configured offline duration and limits. Choose defaults during the pilot, not by inventing a global expiry in the UI. Revocation cannot reach a disconnected phone instantly. New logins, privilege escalation and refunds require the server in v1; previously authorized staff can unlock within their grant. Reconcile transactions made under a subsequently revoked grant into an auditable review state rather than discarding them.

Store credentials in platform secure storage and database encryption keys in Keystore/Keychain. Cache only sellable branch items and authorized customer fields, not costs, supplier records or all company history. Encryption, backup exclusions, key recovery and migrations must be tested together. No provider secret is shipped to a handset.

## 5. UPI and receipts

### Branch UPI accounts and the collection flow

Owner requirement: keep multiple UPI accounts on each branch, exactly one active default when accounts exist, and let a permitted cashier choose another during billing. Use the same future contract for desktop QR checkout, but deliver the mobile flow first.

Current inspected code has a single `online_ordering.payment_upi_id` / `payment_upi_name` setting and exposes it through an ordering response. That is not proof of a multi-account POS payment model. Add a canonical branch-owned account list in the Payments module, with an explicit branch selector, rather than a second mobile-only settings store. Each entry needs a stable account ID, merchant display name, UPI ID, active state and verification mode/provider binding. Store a separate `default_upi_account_id`; enforce that it references an active account in the same branch. Administrative edits use branch/payment-settings ACL and audit history. A cashier selects from allowed accounts but cannot type an arbitrary payee into checkout.

Migrate the existing nonempty branch UPI configuration into one default account without losing its old value or changing existing online-ordering behaviour. Preserve a compatibility projection while old clients remain. Atomically replace the default when disabling it; if no account remains, hide UPI and explain configuration in the Payments page. Account selection applies to the current payment attempt and does not silently change the branch default.

Normal flow: **Cart → Collect payment → UPI → Confirm amount and chosen merchant account → Display QR → Await/record payment → Receipt / Print / New sale.** The QR contains the selected recipient and amount using the supported UPI/provider format; [NPCI's FAQ](https://www.npci.org.in/what-we-do/upi/faqs) describes merchant UPI ID and amount as QR information. A syntactically valid UPI ID is not proof of merchant ownership; validate account setup through the chosen provider/process.

The sale can be saved before collection, but stays unpaid/pending. Reopening an unpaid sale offers **Collect balance** and creates a QR for the outstanding amount. A fully paid completion screen does not automatically show a collect-payment QR. Desktop should later use this same flow and account list, including customer-display presentation where configured.

Before presenting the QR, account changes simply select a different account. Once a payment attempt exists, changing account must close/supersede the old attempt where possible, create a new attempt and retain its recipient/amount snapshot. A previously displayed static merchant QR cannot be revoked reliably; late payment to the old account must be tracked and reconciled, not ignored. Freeze account ID, UPI ID, merchant name, verification mode and provider payment reference on each attempt so later branch edits never redirect or relabel historical payments. Integrated QR credentials must correspond to the chosen account; selecting a bare UPI ID does not create an auto-verification integration.

Offline account lists are cached with version/expiry under the offline policy. If an account's validity cannot be established, offer cash or keep collection pending according to that policy. Merchant QR display and provider-confirmed success remain separate capabilities.

- **Integrated UPI:** server creates the provider payment request/QR, associates it with the stable sale ID, and checks trusted status/webhook evidence including merchant, amount, currency and provider payment ID. UI: Waiting → Verified / Failed / Expired. App return, screenshot, sound or customer assertion is not bank confirmation.
- **Configured merchant UPI QR:** render the configured recipient and amount when supported, with the merchant name visible. Without a verification integration, the authorized cashier explicitly records **Staff confirmed**, optionally with a reference. Do not label it bank verified. Cached QR display does not make the UPI network work offline.
- **Disconnected POS:** allow a configured static QR to be displayed; customer connectivity may still allow payment. Otherwise use cash or keep payment pending. Provider status cannot be invented. Reconcile late success, duplicate payment, partial payment, refund and switching to cash without charging twice.
- Keep sale sync and payment verification as separate states. A sale may sync while UPI remains unresolved, or have verified payment while sale upload is waiting.
- Local receipt preview works offline. Direct printer support is hardware-tested. A server printer works only when its server is reachable. Queue digital delivery until server acknowledgement and required connectivity. Print jobs have IDs; reprints are explicit.
- Allocate unique device-scoped receipt references offline and map to the server record. Validate invoice numbering and tax-document requirements for each launch jurisdiction before release; do not promise fiscal/e-invoice compliance from an offline preview.

## 6. Printing and payment equipment

### Printing and payment equipment: first-release requirement

The cashier should usually only tap **Print receipt** or **Collect payment**. An authorized person configures equipment once; the app remembers the permitted default for this phone and branch. Changing a destination is a small secondary action, not a setup wizard on every sale.

| Capability | Connected to this phone | Already configured on till/server |
|---|---|---|
| Receipt printing | Supported Bluetooth/BLE, USB where platform permits, or reachable network printer through a tested adapter | Select a named, authorized destination published by the till; reuse its driver, paper profile and receipt configuration |
| Kitchen/order printing | Only an explicitly assigned supported destination; show queued versus sent | Till/server handles department routing, copies, order revisions and cancellation tickets |
| Card/device payment | Discover and pair an approved reader using its provider SDK; collect on that reader | Send a payment request to an assigned compatible terminal through a server/provider adapter |
| QR payment | Display the configured merchant QR or a server-issued transaction QR on the phone | Request a QR/payment session on a supported till/customer-facing payment device |

“Connected” is not sufficient to claim compatibility. Payment readers need supported provider protocols/SDKs, merchant onboarding, geography and platform support. A printer's transport alone does not establish its command dialect, character-set or status support. Publish a tested model/OS/transport matrix. First release must support selected real direct-phone and till-routed print/payment paths; select the actual pilot models and providers in Phase 0. Square and Stripe document distinct mobile-reader and server-driven terminal integrations; these are architecture examples, not a recommendation that those providers serve the launch market: [Square Mobile Payments SDK](https://developer.squareup.com/docs/mobile-payments-sdk), [Stripe server-driven terminals](https://support.stripe.com/questions/terminal-server-driven-integration?locale=en-GB).

### Keep the app small without sacrificing offline selling

| Phone owns | Till/server owns |
|---|---|
| Fast local catalogue, cart and required offline price/tax evaluation from versioned rules | Master catalogue, tax/price configuration and validation |
| Durable local sale/outbox and receipt snapshot | Canonical sales, stock posting, reconciliation and multi-device coordination |
| Minimal receipt rendering and direct printer transport when printing locally | Complex templates, centralized print routing, queue administration, kitchen routing and remote printer drivers |
| Approved provider SDK and short-lived credentials for a phone-connected reader | Provider secrets, onboarding configuration, payment intents, webhook verification, terminal assignment and settlement reconciliation |
| Pick a permitted destination, pair local equipment, test connection, see status and retry safely | Maintain branch defaults, capability profiles, permissions, business policies and diagnostics |

Local checkout arithmetic, durable storage and a small receipt renderer remain on the phone because offline operation needs them. Heavy server work must not turn offline sales into a server-dependent workflow. Do not move card PIN/PAN handling into Posnic; use the approved terminal/SDK payment UI and tokenized references.

### Configuration and inheritance

- **Till/server:** configure actual hardware in its owning Printing or Payments module page. Mobile POS settings assign the branch/device's available destinations and defaults, rather than duplicating payment secrets or printer setup. Nothing is added inside a Features switch card.
- **App → More → Printers:** choose **Use shop printer** (default when assigned) or **Connected to this phone**; show destination name, availability, paper profile, test print and auto-print preference where allowed. Local pairing and any required OS permission happen here.
- **App → More → Payment devices:** choose an assigned till terminal or pair a supported local reader; show readiness and a connection test. QR collection inherits the branch's payment configuration. Only an authorized manager changes method availability, routing or defaults.
- Resolve defaults as permitted device override → branch assignment → no configured destination. Never silently take another branch's printer/terminal. Cache a versioned capability/profile snapshot for offline use, including template, currency, permitted methods and paper width. Changing branch clears/revalidates hardware assignments.
- The normal checkout displays the selected destination in one line (for example, **Card · Counter terminal**); show a picker only if another permitted destination is needed. Customers still see amount, merchant and payment outcome.

### Printing reliability

Use a print intent with a stable job ID, sale ID, branch/device identity, immutable receipt snapshot, document type and copy/reprint designation. Phone and till workers must not both print the same automatic receipt. Reuse the existing till print pipeline through authenticated device/staff APIs; do not access the till database directly or distribute installation-wide kiosk credentials.

The phone may print its saved offline receipt directly without waiting for sale upload. Persist that print intent and outcome so later sync does not trigger a second automatic receipt. For till printing, enqueue at the connected authority and route to a registered worker; a cloud server cannot directly reach an arbitrary USB printer in a shop. A till/connector must be running and reachable, using an authenticated outbound connection or the established LAN path. Prefer event-driven dispatch with a recovery queue rather than waiting for periodic sale sync.

Track **Waiting for printer / Sent to printer / Failed / Outcome unknown**. A successful socket write or OS-spool acceptance does not prove paper was printed. Device feedback can refine status where supported. If a response is lost, query the job before retrying; for an ambiguous physical print, offer an explicit marked reprint. Do not promise exactly-once physical paper output from a printer without acknowledgements. Never silently switch printers after an ambiguous send. Printing failure must not cancel a completed sale or cause payment collection again.

Shop printer unavailable: keep the job queued and let the cashier deliberately choose a local printer, with duplicate-risk handling if the original outcome is uncertain. LAN printing can work without internet if the printer/till is reachable. Direct Bluetooth/USB printing can work with no server. Printed customer receipts must distinguish pending payment from received payment; an unpaid order is not presented as a paid receipt.

### Payment-device reliability

Keep a stable sale ID and separate attempt ID for each tender. Use provider idempotency, amount/currency/merchant checks, terminal reservation/ownership and a durable status record. Busy terminals tell the cashier who/what is waiting; one reader must not accept overlapping payment prompts from different phones.

An interrupted card/QR attempt enters **Checking payment**, not a fresh charge. Query the existing provider attempt after reconnect/restart. Before moving to another terminal or cash, settle or cancel the original attempt when supported; if its outcome is unknown, preserve it for reconciliation and make potential duplicate collection explicit. Late success must resolve against the original sale even if another tender was selected. Never fail over automatically from one payment device to another mid-charge.

Reader offline acceptance is enabled only when that specific SDK, reader, merchant and provider permit it. Treat accepted-but-unverified payment as pending provider processing. A networked till terminal needs its documented network path; local Bluetooth connectivity does not guarantee the payment provider is reachable. Cash remains available under the offline policy regardless of payment-hardware support.

### Updated delivery gates and estimate

Phase 0 now proves both a phone-connected printer and a till-configured printer, plus the chosen direct-reader and till-terminal provider paths (sandbox first, then real hardware). Phase 2 includes direct and till-routed receipt printing. Phase 3 includes selected supported reader/terminal collection, QR and interrupted-payment recovery. First release cannot be declared complete with those integrations represented only by buttons or manual “card paid” entries.

Hardware models and launch providers are still unspecified. The earlier 10–14 week estimate is the core-software baseline and is **not a committed estimate for this expanded hardware scope**. Re-estimate after Phase 0 based on available SDKs, certification/onboarding, physical equipment and server adapter reuse. Additional hardware/provider families and optional Tap to Pay can follow after the selected first-release paths work.

## 6a. App implementation stack

**React Native + TypeScript + Expo development builds + SQLite**, Android first. This keeps the earlier direction, but adds the persistent database from day one. [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/) supports persistence, search extensions and SQLCipher; encryption needs a native build and does not run in Expo Go. [Development builds](https://docs.expo.dev/develop/development-builds/use-development-builds/) allow custom native modules. [Local native builds](https://docs.expo.dev/guides/local-app-overview/) keep an open-source community build path available without mandating a hosted build subscription.

| Option | Benefit | Tradeoff / decision |
|---|---|---|
| React Native + Expo native builds | Dedicated phone UI; typed code; local SQLite; Android/iOS direction already researched | Must port Captain networking and validate printer/native dependencies. Recommended, subject to spike. |
| Fresh Capacitor app + native SQLite | Most direct reuse of Captain platform knowledge and bridges | Viable fallback if the native spike fails; still needs a new UI and robust database/outbox. Do not wrap the desktop dashboard or assume IndexedDB alone solves durability. |
| Flutter | Native mobile approach and local storage options | Additional Dart expertise and less reuse of existing JavaScript contracts; no demonstrated need to switch ecosystem now. |

Phase 0 must prove LAN connectivity, encrypted database reopen/migration, scanning and one target receipt printer in a release build on a low-end Android phone. Freeze exact maintained versions only after the spike. iOS requires its own permission, TLS and printer tests on macOS/device hardware; it is not automatically done because the UI is cross-platform.

Suggested structure: `src/features/{pairing,sell,checkout,receipts,held,customers,items}`, `src/data/{db,outbox,sync}`, `src/domain/{money,pricing,permissions}`, `src/platform/{discovery,secure-store,printing}`, plus server contract fixtures and migration tests. Share proven pure pricing rules/fixtures with POS where licensing and build boundaries permit; avoid a second tax engine with divergent arithmetic.

## 7. Delivery roadmap

Estimates are planning ranges, not commitments. Assumption: one mobile developer and one backend developer, with shared QA/design and access to pilot shops and payment sandbox/hardware. Stages overlap only after their contracts stabilize. A usable offline cash pilot is earlier than a public release.

| Stage | Indicative duration | Work | Exit gate |
|---|---|---|---|
| 0 — Prove the foundations | Re-estimate with hardware access | Confirm scope, authority model and selected printer/payment devices; native stack and provider spikes; API/ACL audit | Direct and till-routed printer/reader paths demonstrated; agreed money/sync contracts |
| 1 — Pair and prepare | 2 weeks | Device grants, QR/code/address/LAN onboarding, branch/staff identity, snapshot download, secure storage, PIN lock | Community LAN-only and public/cloud pairing; interrupted first download resumes; wrong-shop switch rejected |
| 2 — Offline cash pilot | 3–4 weeks core baseline; printer work estimated after spike | Local catalogue, Quick amount, cart, cash/change, direct and till-routed receipt printing, held sales, customer drafts, atomic outbox | Airplane-mode sale and direct print; till queue recovery; no duplicate sale/payment/stock |
| 3 — Payment and daily operations | Re-estimate for selected providers | Configured UPI, supported phone reader and till terminal, reconciliation, split tender, ACL item/price tools, register session, online refunds | Real device collection; delayed/duplicate events, disconnects and mixed tenders reconcile |
| 4 — Hardening and release | 2–3 weeks | Multi-device/authority fault tests, accessibility, performance, printers, schema upgrades, documentation, real-shop pilot | No lost/duplicate money or stock in fault matrix; pilot meets speed/reliability targets; reproducible signed release |
| 5 — Broader platform support | After Android pilot | iOS device validation, tablet refinements, additional printer/payment hardware; richer restaurant workflows if needed | Same checkout invariants on each supported platform/hardware combination |

The original **10–14 week core-software estimate** and weeks 6–8 cash-pilot target are provisional baselines, superseded as release commitments by the expanded hardware scope. Publish a revised schedule after Phase 0 validates the chosen printers, phone reader, till terminal and providers. Payment onboarding, hardware access or existing server sync gaps can extend it. These staffing assumptions do not imply one person can deliver in the same calendar time.

### First release versus later

First release includes all requested connection modes, secure pairing, offline catalogue/cash sales, Quick amount, configured UPI with honest verification, customers, online minimal item/price management, ACL, held carts, scan/search, receipts/reprints, discounts where allowed, split tender, register session handling, online returns and visible sync recovery. Existing shop requirements must be respected or explicitly blocked; unsupported item types cannot be sold incorrectly.

Later: additional certified card SDKs and hardware families, optional Tap to Pay, offline refunds or credit redemption, multi-device offline table merging, advanced restaurant coursing, purchase/inventory administration, reporting dashboards and universal printer support. Selected supported phone-reader and till-terminal integrations are required in the first release. Keep Captain for restaurant-floor workflows rather than rebuilding every Captain screen inside the till.

## 8. Acceptance tests that decide release

- **Speed:** target local search p95 <150 ms over 10,000 saleable records on the agreed baseline Android device; add-to-cart p95 <100 ms; warm return to Sell <1 s. Test 50,000 records for indexing/pagination degradation. These are targets to measure, not achieved benchmarks.
- **Ease:** cashier can complete a Quick amount cash sale in three actions after entering the amount (Charge, Cash, Done); new users pair and finish their first sale without a manual. Test with 5–8 actual cashiers, including Tamil-speaking users.
- **Durability:** crash before/after local commit, server commit and acknowledgement; reboot; expired token; disk full; interrupted migration; long outage; 1,000 queued sales. Never show saved when the durable commit failed.
- **Replay:** repeated and concurrent identical uploads; same key/different payload; dropped reply; LAN/cloud switch; duplicate webhooks; late UPI success after cash alternative. One economic transaction has one auditable effect.
- **Hardware:** direct Bluetooth/USB/network printing on the supported matrix; till printer via LAN and cloud connector; paper-out, denied permission, unplug, lost acknowledgement and explicit reprint; no automatic second receipt after offline sale sync. Phone reader and till terminal: busy state, disconnect before/after authorization, duplicate callback, restart, cancellation and late success. No duplicated charge; no success claimed solely because a device connected.
- **Catalogue:** snapshot interruption, equal-timestamp updates, deleted item, changed tax/price, expired snapshot and changed branch scope. No unbounded all-company customer download.
- **Stock and money:** two phones selling the last unit offline, fractional quantities, discounts, tax inclusive/exclusive, rounding, split tender and register close while transactions are queued. Preserve recorded facts; flag conflicts.
- **Access:** revoked device, expired offline grant, customer/item write denied, price override denied, branch isolation and manager approval. UI hiding is never the only enforcement.
- **Experience:** 320–430px phones, tablet, dark theme, 200% text, screen reader, left/right hand reach, denied camera/local-network permission, guest Wi-Fi and no printer.
- **Release:** community and cloud compatibility matrix, minimum capability/version handling, local build instructions, dependency licences/SBOM, privacy/data deletion, signing and update recovery. Recommend the project's existing AGPL family, but confirm the Mobile-App licence explicitly before a public code release. Preserve human-only attribution and run the repository attribution check before a PR.

## 9. Mockup review guide

The accompanying interactive concept covers connection, item sale, numeric Quick code entry, Quick amount, cart, cash, UPI account selection and pending/verified states, completion, held sales, receipts, minimal customer/item creation, printer/payment-device configuration, the full 18-language menu and connection/sync status. Data, network changes and provider confirmation are simulated. The language menu previews availability and selection; the concept's other screens remain English and are not a completed mobile translation implementation. It does not connect to a server, scan a camera, process payment, persist sales or prove offline durability.

Review the default selling surface (Items or Quick amount), thumb reach, whether the cashier can understand offline/payment states, and whether secondary operations distract from Charge. The visual choices are reversible; the transaction and authority contracts must be settled before production checkout implementation.
