# Mobile connection and recovery contract

The onboarding screen accepts a shop code, private IP (default port 5555), domain,
full server URL, pairing link with `server` or `shop` and optional `code`, or a
JSON QR payload `{ "server": "…", "code": "…" }`. These inputs share one parser.
A short pairing code alone is not a server locator: it must be accompanied by the
shop address. Wi-Fi discovery is available in the native app; browser previews
explain the limitation and retain manual/QR entry. Discovery does not authenticate
or silently choose a shop when several tills answer.

## Authenticated route metadata

`GET /api/mobile/v1/bootstrap` may return the following additional `shop` field:

```json
{
  "connection": {
    "idempotencyScope": "stable-shared-sales-ledger-id",
    "local": "http://192.168.1.8:5555/api",
    "remote": "https://shop.example.com/api"
  }
}
```

This is a server contract, not a client-side guess or a URL from an unverified QR.
Only publish both routes when they accept the paired credential and use the same
atomic sale-id deduplication ledger. A common shop name or mirrored catalogue is
not enough. Independently writable databases with eventual replication must not
advertise a shared scope unless their ingestion layer guarantees this invariant.
The existing mobile API must implement idempotent sale creation regardless of
whether alternate routes are advertised.

The client prefers the local route. Before sending a sale to an alternate route,
it authenticates bootstrap and compares shop ID, branch ID, staff ID, sale-sync
capability and idempotency scope. It keeps the original paired authority in local
storage and outbox records. It retries the same sale ID on a network error or 5xx;
it does not bypass a permission refusal, authentication rejection or conflict.
Timeouts can mean that the first server committed the sale but lost its reply,
which is why the shared ledger is essential.

Without this metadata, the client continues using its paired address. No guessed
public domain, arbitrary discovered till, or second independently writable server
receives queued orders. The current POS source inspected for this change does not
expose the Mobile POS bootstrap/sales routes; client tests use fixtures. Server
implementation and device testing are required before claiming production failover.

## Local persistence and staff experience

Checkout atomically stores the sale and outbox entry before clearing the cart.
Pending receipts use grey styling and an explicit pending label. Synchronization
runs separately from sale actions on a timer, app resume and network reconnection.
Manual retry bypasses transient backoff; it does not resend entries marked for
review. Failed catalogue refreshes still refresh the local UI so acknowledgements
already persisted are visible. Existing item-code entry works from the cached
catalogue, including leading zeroes and localized digits.

First pairing and catalogue download still require a reachable compatible server.
Offline selling uses the server-issued permission expiry; this change does not
extend or bypass that grant. Browser preview storage and native encrypted storage
are distinct deployment surfaces. Test an installed handset on shop Wi-Fi, switch
to mobile data, restart it with queued sales, and simulate a lost upload reply
against the real shared ledger before release.

## Verification

`npm run check` covers types, unit tests and attribution. Connection tests cover
input formats, local preference, domain fallback, lost replies, tenant/staff/scope
mismatch, refusals and legacy pinning. Repository tests cover durable replay after
restarting a worker and explicit retry while backoff is still active. Native LAN,
camera and deployed server behavior cannot be established by these fixture tests.
