# Mobile POS API contract

Status: client 0.3.0-beta.8 and matching POS 1.8.5-beta.6 adapter implemented for pilot testing.
Desktop location: Settings → Mobile POS. Remote servers must deploy the same API.
Paths are relative to the chosen server's `/api` base. Do not advertise the mobile
capability until complete sale ingestion passes integration tests.

## Runtime and authentication

`GET /runtime-info` returns edition (community/cloud), numeric apiSchema and
`features.mobilePosV1: true`. A URL/QR locates a server; it does not authorize access.
Password login consumes `POST /users/kioskMobileLogin` with username/password.
Code enrolment consumes `POST /mobile/v1/pair` with `{code}`. Both return `{token}`.
The server must scope and bind credentials to a device, branch and staff principal.
Pair codes must be short-lived, single-use, rate-limited and consumed atomically.
Issuance/settings belong on the Captain/Mobile module page, never Features switches.

Native bearer tokens use SecureStore; browser preview tokens are memory-only.
Credential renewal, revocation and re-authentication UX remain release work.

## Bootstrap and catalogue

`GET /mobile/v1/bootstrap`, authenticated, returns `{shop, items}`. The runtime
schema is `bootstrap` in `src/services/api.ts`; models are in `src/domain/types.ts`.

- Stable server IDs identify tenant, branch, staff and items.
- `offlineUntil` is a UTC expiry for offline permissions; `snapshotVersion` identifies
  a consistent, complete catalogue snapshot.
- Explicit permissions: sell, quickSale, customerWrite, itemWrite, priceOverride,
  manualUpi. Unsupported actions remain false.
- Prices use integer minor units, tax uses basis points. Supported currencies have
  two decimals and each line has one tax rate. Piece-count quantities are integral.
  `quantity=fixed3` opts into `quantityScale:1000` and the configured selling unit
  for weight-machine-based items. Other unsupported configurations remain blocked.
  Both server and client round base/tax to minor units using the fixed-quantity contract.
- Item code maps to existing plu_code and preserves leading zeroes. Codes are never
  displayed on sale tiles. Duplicate shortcut matches require selection.
- Branch UPI accounts carry stable ID, name, VPA, active flag and manual/provider
  verification mode. Exactly one active default must be enforced by the server.
  Provider accounts cannot collect until verified attempt handling is implemented.
- Capabilities: saleSync, devicePairing, tillPrint, terminal. Only advertise a
  capability when its complete implementation is available.

The client atomically replaces the catalogue and grants, pins authority/shop/branch/
staff and preserves existing cart and paid-sale snapshots. Refresh failure leaves
old data intact. The worker runs every 30 seconds while foregrounded and on resume.
`catalogue=paged` negotiates immutable content-addressed pages of up to 256 items,
retrieved from `/mobile/v1/catalogue/:version/:page`. Completed pages are reused;
activation and the new grant commit together. Product images use bounded persistent
caching from permitted credential-free URLs. OS background work remains outstanding.

## Sale ingestion

`POST /mobile/v1/sales` takes `{idempotencyKey, sale}`. Key equals immutable local
sale ID. The response is:

```json
{"saleId":"local-id","serverId":"canonical-id","shopId":"shop-id","branchId":"branch-id"}
```

Required server guarantees:

1. Resolve tenant/branch/device/staff from validated credentials and cross-check the
   payload and offline grant. Never trust caller identity fields alone.
2. Validate currency, item and price snapshots, tax and tender. Recalculate totals.
   Record legitimate offline conflicts for reconciliation without recollecting money.
3. Uniquely index tenant/branch/device/sale identity and persist a payload hash.
   Identical retries return the original response; changed payload with the same key
   returns 409. Deduplication records outlive every retry window.
4. Durably record the sale intent, then complete idempotent sale/customer/stock
   and stock-audit effects before acknowledgement. Standalone MongoDB uses a
   resumable journal rather than a cross-document transaction. Interrupted effects
   remain visible in desktop Mobile POS settings for recovery.
5. Cash is staff-recorded cash; manual UPI remains staff-confirmed and separately
   reconcilable. A screenshot, callback URL, reference or checkbox is not bank proof.

The client retains paid receipts on failure, backs off transient errors, and sends
400/403/409/422 to review. It never replays to a different LAN/cloud host. Multi-host
failover needs verified server topology and shared deduplication first.

## Printing

`POST /mobile/v1/print-jobs` accepts receipt jobs:
`{id: "receipt:<sale-id>", saleId, document: "receipt"}` or test jobs:
`{id: "<unique-test-id>", document: "test"}`. Receipt retry IDs are stable.
The server owns Till templates, routing and spooling. The print-status capability
allows receipt status reads without creating a new job. Direct phone printing uses
a separate durable journal, explicit recovery and no automatic duplicate Till job.
Android Bluetooth Classic SPP and USB printer-class ESC/POS are implemented;
OS printing remains available. Transport submission is not proof of physical paper.

`POST /mobile/v1/delivery-status` accepts at most 50 local sale IDs. It returns
only explicit gateway receipt evidence scoped to the paired license/branch/staff/device,
matching transaction/server receipt and sync authority. `cloudDelivery` is advertised
only after protocol support is recorded by the signed sync component.

## Remaining contracts

Device lifecycle/renewal, sale reconciliation, print outcomes, provider payment
attempts/status queries, refunds, split tenders, catalogue deltas/images, item and
price writes with version checks, customer deduplication and authenticated LAN
discovery. Heavy configuration stays on the server/till.

### 0.1.3 additions

Password/code login includes a persistent `device` descriptor. Sales include
`snapshotVersion`; individual cart lines retain their own snapshot version so a
held price survives catalogue refresh. `/settings`, `/pair-codes`, `/devices/revoke`
and `/recover` are authenticated desktop administration endpoints. Pair codes are
single-use with a five-minute expiry. Till receipt requests are durable on the
phone until accepted by the server queue. Physical printing is not acknowledged
by the phone merely because the queue accepted a job.
