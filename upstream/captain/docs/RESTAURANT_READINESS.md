# Captain restaurant service workflows

Captain 1.3.22 requires the matching POS 1.8.4 server for courses, staff handover, manager approval and kitchen delivery reports.

## Taking and changing orders

Use Preparation on a dish to assign a seat, choose a course, hold it for later, or record allergies. With multiple identical plates in a new cart, Split one plate creates a separate preparation without changing the total quantity. Different preparations retain separate line identities through edits, cancellation, kitchen tickets and guest bills.

Held dishes remain on the order but do not reach printers or kitchen displays. Send to kitchen releases a held line once, retaining the original order time and recording its send time. Mark all served acts only on sent, outstanding dishes. Individual service can record a partial quantity.

Allergy details follow the dish to the kitchen display, printed ticket and spoken announcement. They communicate a guest requirement; they do not certify ingredients or preparation as allergen-free.

Order options contains staff handover and kitchen delivery details. Normal order taking keeps these secondary controls out of the primary flow. A restricted quantity reduction, cancellation or discount asks for a reason and, when required by staff permissions, order-specific manager approval. Changes retain the staff identity and reason.

## Guest bills and money

Assign by seat prepares an item split for review. Items without a seat are shared across the guest bills. Staff can adjust assignments before confirming. Collection remains controlled by Captain settings; integrated card processing is outside this release.

Currency precision follows shop metadata, including currencies with zero or three decimal places. Stored guest bill/payment snapshots retain their original precision when shop settings later change.

## Delivery and recovery

Kitchen delivery shows server acceptance, each printer copy's reported state, and recent kitchen display confirmation. Printer-system acceptance does not establish that paper emerged. Unknown outcomes need a printer/log check before reprinting. Failed reports are retained locally and retried; they do not prevent order taking.

Kitchen display confirmation is sent after its renderer accepts the ticket list. It is timestamped and becomes stale rather than claiming continuing connectivity. Held courses are excluded from both desktop and browser kitchen boards. Existing offline order queues and printer recovery remain in use.

## iOS access

The iOS app registers native secure-session and local-network plugins. Sessions and PIN state use device-only Keychain storage. Backgrounding locks PIN-protected access; failed attempts persist. Browser authorization only opens the trusted Posnic authorization address.

## Acceptance checks on restaurant hardware

Before operational rollout, exercise discovery and Wi-Fi/internet recovery; queue an order offline and reconnect; send to every selected printer; check paper and cancellation announcements; prepare and send held courses; partially serve and serve a whole order; modify identical dishes with different notes; review seat splits and payment configuration; test restricted cancellation/discount and handover; repeat on phone and portrait/landscape tablet. Validate camera, local network permissions, browser return and PIN/background behavior on iOS devices.

Automated development checks do not replace these device, printer and service-floor checks. Hardware acceptance testing is intentionally left for the user.

