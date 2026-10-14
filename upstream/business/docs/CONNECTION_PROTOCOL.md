# Business connection protocol — client draft

This is the evolving client/server contract. Tenant authorization and the companion Cloud account-service/gateway handoff are implemented for development validation. No production deployment is included. Existing Mobile POS authorization and till enrollment are not compatible.

## Compatibility check

Both welcome-screen options perform one credential-free HTTPS GET to `{origin}/api/business/v1/discovery`. Cloud uses `https://www.posnic.com`; Community uses the entered HTTPS origin, including an explicit port if supplied. Origin paths, embedded credentials, query strings and fragments are rejected. Browser preview requires the server to allow its origin through CORS; a CORS/network failure cannot be reliably distinguished and is shown as an unreachable server.

The proposed successful JSON response is:

```json
{
  "product": "posnic-business",
  "apiVersion": 1,
  "issuer": "https://shop.example.com",
  "authorization": "business-pkce-v1",
  "audience": "posnic-business",
  "reporting": "bounded-summary-v1"
}
```

The issuer must exactly match the normalized origin the user selected. The reporting field also accepts `unavailable`, allowing sign-in before prepared summaries are enabled. Version 1 accepts only these fields. Unknown protocols, versions and fields are unsupported, so protocol extensions require an explicit client compatibility change. Discovery cannot supply alternate token URLs. A successful check means protocol compatibility only: it does not authenticate an account, certify the server's honesty, or verify report freshness. The UI offers browser sign-in after compatible discovery.

Requests use a ten-second timeout with cancellation, no cookies, no HTTP cache and no retry loop. Changing the address or leaving the connection screen cancels the request and prevents its result from replacing the new screen's state. Errors expose safe local messages, never server HTML or raw error bodies.

## Read transport foundation

The reporting client loads current context after native PIN unlock. Live Today requires discovery to advertise `bounded-summary-v2`; older servers show an unavailable message. It requires an explicitly supplied fetch transport and an opaque Business token matching `pb1_` plus 43 base64url characters. The format check rejects existing POS JWTs; it is not authentication. Only the server can validate and authorize a token.

| Request                                                              | Client validation                                                                                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/business/v1/context`                                       | Explicit business/account identity, capabilities, unique permitted branches and currency metadata                                              |
| `GET /api/business/v1/overview?businessDate=YYYY-MM-DD&branchId=...` | Calendar date, overview capability, nonempty unique authorized branch set, exact response business/date/scope, currency and freshness contract |

The overview interface only supports one business date and at most 100 permitted branches; it cannot request arbitrary long reports. The backend must use prepared summaries with bounded work. Response validation is defense in depth, not server authorization. A UI adapter must clear private state on `signInRequired` or `accessChanged`, refresh context before accepting changed access, and never relabel a cached result as current.

Both transports request redirect rejection and reject redirected or wrong-URL responses. The app supplies Expo fetch; its installed Android and iOS source explicitly disables redirect following and omits cookies for these options. Native implementations must prove that credentials are not sent through redirects before the reporting client is wired to a real token. A response check after redirect is not sufficient to prevent disclosure. The client consumes a response stream with a 256,000-byte limit and cancels the reader on overflow; native transport behavior remains a device qualification requirement.

## Cloud handoff

Only the fixed Cloud origin may advertise `business-cloud-pkce-v1`. Its consent page requires a current Cloud account login, matching code, browser nonce and same-origin approval. An approved exchange returns `{handoff: {origin, request}}`, bound to the same verifier. The client sends the verifier and handoff request to that tenant's HTTPS `/api/business/v1/token` exactly once; it sends no token or cookie between origins. Community cannot redirect authorization to another origin, and nested handoffs are rejected. The tenant rechecks current ACL and branch access before issuing its dedicated session.

## Release qualification still required

1. Deploy the tenant API before enabling the account-service and gateway handoff, then validate with a controlled account on each hosting mode.
2. Complete the app's device/session management UI over the implemented list/revoke/rotate API.
3. Exercise account deactivation, password changes, tenant moves and network failures across deployed services.
4. Qualify Android/iOS TLS and redirect handling, secure token storage, PIN attempt limits and biometric/device-lock behavior. Never persist an account password.
5. Reconcile prepared metrics with authoritative POS fixtures, establish source checkpoints, then connect the live screens. No totals are substituted from the legacy dashboard in this milestone.

Tests use synthetic responses and do not establish that a deployed server supports this draft.

## Version-2 prepared overview

The live response has schema/metric version 2 and includes billed sales, refunds, sales after returns and issued-bill count in safe minor units, plus currency precision, exact business/date/branch scope and preparation time. Sales include tax and already-applied discounts/rounding; tips are excluded. Returns belong to their own business date. This measure is not cash collected or profit. Negative return-only days are valid.

The app only accepts partial/delayed completeness states. It uses the branch's timezone for Today and asks the user to select a branch when currencies or timezones differ. It clears displayed amounts on a failed request instead of presenting an older amount as refreshed. Auth/ACL failures lock the account. Native pull-to-refresh and a visible Refresh button use the same cancellation-aware request path. No automatic long-report request or local heavy computation is introduced.

## Local unlock

The native vault stores only issuer/token/expiry in an AES-GCM envelope, protected with a six-digit PIN using scrypt (N=32768, r=8, p=1), a random salt and a separate device installation secret. Both the envelope and installation secret use SecureStore with device-only, unlocked accessibility. Five unsuccessful attempts require browser sign-in again. Attempts are reserved before derivation and survive restart; operations serialize and background lock invalidates pending unlocks. Browser preview never persists credentials.

Optional biometric unlock stores a separate credential under OS-authenticated SecureStore protection, with a different keychain service and device-only passcode accessibility. Only enrolled strong biometrics are offered. A non-secret binding ties it to the current PIN enrollment; changing enrollment, exhausting the PIN budget, sign-out or a changed biometric set prevents reuse. Reads require the OS prompt rather than trusting a preceding Boolean authentication result. Inactive screens show a privacy cover, backgrounding cancels unlock, and every successful unlock reloads current server context. Real-device qualification is still required; simulators cannot prove biometric key protection.

The native storage API is documented in [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/). The patched build dependency is documented in [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

## Stock Inbox negotiation

`GET /api/business/v1/discovery?stockAlerts=1` may advertise
`stockAlerts: "inbox-stock-v1"`. Only then does the client include `stockAlerts=1`
in authenticated Inbox requests. This is separate from stock reporting and
stock-alert preference negotiation. The server feature flag controls advertising.

A `stock_low` entry has ordinary Inbox ID, branch, business date, creation time,
read state, `summary: null`, and a strict `stock` object containing schema version
1, snapshot ID, observation interval, `sourceComplete: false`, coverage, total/new
low counts, up to twenty item facts and a truncation flag. Stock-negotiated pages
contain at most ten raw entries. An empty page may still have a continuation.
The history is scoped by live account/branch/stock ACL and current opt-in activation.
Quiet hours and cadence govern delivery, not the reading of saved observations.
No payload grants inventory-write or approval authority. Stock-only users never
receive financial summary permission by gaining Inbox access.
