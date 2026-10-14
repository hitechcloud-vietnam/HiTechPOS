# HiTechPOS Cloud origin – server contract for the owner app

Status: sections 1–4 (discovery, browser sign-in, PKCE token, hand-over to
the shop) are **implemented** in `apps/control-plane/src/business-cloud.js`
(see `docs/BUSINESS-APP.md`). Section 5 (`/api/mobile/*`) is not built yet.
The contract was read off the app source in this directory (file references
are relative to `upstream/business/`). Where the upstream code leaves a choice
open it is marked _design note_; everything else is a hard requirement of the
client.

## 1. Two kinds of origin

| Origin                   | Default                                                                                                              | What the app uses it for                                                                                                                                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cloud origin** `CLOUD` | `https://app.hitechpos.vn` (`src/config/hitechpos.ts`, override `EXPO_PUBLIC_HITECHPOS_CLOUD_ORIGIN` at bundle time) | "Continue with HiTechPOS Cloud": discovery, browser sign-in, PKCE exchange that **hands the phone over** to the shop origin. Upstream this was Posnic Cloud, `https://www.posnic.com`.                                                                          |
| **Shop origin** `SHOP`   | `https://<subdomain>.hitechpos.vn` (or the tenant's own domain)                                                      | Everything after sign-in: context, reports, inbox, approvals, push registration, sessions. **Already implemented** by the Posnic shard: `upstream/pos/api/src/routes/business-access.routes.js` + `services/business-access.js`, mounted at `/api/business/v1`. |

An owner can already bypass `CLOUD` today by choosing the "own server" option
and entering `https://<subdomain>.hitechpos.vn`: the shard answers discovery with
`business-pkce-v1` and runs the whole sign-in itself (staff username/password of
the shop, not the HiTechPOS control-plane account). "Explore sample business"
needs no server at all (`src/data/sample.ts`).

Until `CLOUD` implements section 3, "Continue with HiTechPOS Cloud" shows
`serverUnsupported` (any 404/405/426/501 or a non-conforming discovery body maps
to `unsupported`, `src/services/businessConnection.ts`).

## 2. Transport rules the client enforces (all endpoints, both origins)

From `readJson()` in `src/services/businessConnection.ts`:

- Base URL is always `origin + "/api/business/v1" + path`. Origins must be
  `https:` with no path, query, fragment or credentials (`src/domain/server.ts`).
- Requests: `credentials: "omit"` (no cookies), `redirect: "error"`,
  `cache: "no-store"`, `Accept: application/json`; JSON bodies with
  `Content-Type: application/json`. Default timeout 10 s.
- **No redirects.** A redirected response, or `response.url !== request url`, is
  rejected (`invalidResponse`).
- Response `Content-Type` must start with `application/json`; body ≤ 256 000
  bytes; must parse as JSON.
- Status mapping: `401 → signInRequired`, `403 → accessChanged`,
  `404/405/426/501 → unsupported`, `409 → conflict`, `429/503 → busy`, other
  non-2xx → `unreachable`. Any 2xx (including `202`) is parsed as a body.
- Browser preview (`expo start --web`) additionally needs CORS for the preview
  origin on `CLOUD`; native apps do not send an `Origin` the server must allow.

## 3. Endpoints `CLOUD` must serve

### 3.1 `GET {CLOUD}/api/business/v1/discovery`

Credential-free. The welcome screen calls it without a query string
(`App.tsx → checkConnection(CLOUD_ORIGIN)`). Later discovery calls with
`?items=1&insights=1&approvals=1&stock=1&stockAlerts=1&stockAlertPreferences=1&registerSessions=1`
go to the **shop** origin, not `CLOUD`.

Response `200`, validated with a **strict** schema (unknown keys → unsupported):

```json
{
  "product": "posnic-business",
  "apiVersion": 1,
  "issuer": "https://app.hitechpos.vn",
  "authorization": "business-cloud-pkce-v1",
  "audience": "posnic-business",
  "reporting": "unavailable"
}
```

- `product` / `audience` are protocol literals and stay `"posnic-business"`
  (the shard sends the same values; they are not shown to users).
- `issuer` must equal `CLOUD` exactly (scheme + host, no trailing slash).
- `authorization` must be `business-cloud-pkce-v1`. The client rejects that value
  from any origin other than `CLOUD`.
- `reporting`: one of `bounded-summary-v1 | bounded-summary-v2 | unavailable`.
  `CLOUD` serves no reports, so `unavailable` is the honest value.
- Optional keys the schema also accepts (only meaningful on a shop origin):
  `itemReporting: "bounded-items-v1"`, `insightReporting: "bounded-insights-v1"`,
  `stockReporting: "bounded-stock-v1"`, `approvalAlerts: "inbox-approval-v1"`,
  `stockAlerts: "inbox-stock-v1"`, `stockAlertPreferences: "stock-alert-preferences-v1"`,
  `registerReporting: "bounded-register-session-v1"`, `registerInbox: "inbox-register-v1"`,
  `registerSchedules: "register-close-v1"`.

### 3.2 `POST {CLOUD}/api/business/v1/requests`

Starts a browser authorization (`startAuthorization()`, `src/services/authorization.ts`).

Request body:

```json
{
  "codeChallenge": "<43 chars base64url>",
  "deviceName": "HiTechPOS Business",
  "stepUp": true
}
```

- `codeChallenge` = base64url(SHA-256(`verifier`)) without padding, where
  `verifier` is 32 random bytes base64url (43 chars). Method is always S256;
  there is no `code_challenge_method` field.
- `deviceName` is a fixed string (≤ 80 chars; shown on the consent page).
- `stepUp` is present (`true`) only when re-confirming identity before an approval
  decision (section 3.5); otherwise omitted.

Response `200`, **strict** schema:

```json
{
  "request": "<43 chars [A-Za-z0-9_-]>",
  "authorizationUrl": "https://app.hitechpos.vn/api/business/v1/authorize?request=<request>",
  "expiresIn": 600,
  "interval": 5
}
```

- `authorizationUrl` must be **exactly** `CLOUD + "/api/business/v1/authorize?request=" + request`
  (string equality; anything else is refused so the app never opens a foreign
  password page).
- `expiresIn`: integer seconds, 1–600. `interval`: integer seconds, 5–30 (poll period).
- The phone shows `request.slice(-6).toUpperCase()` as the **matching code**.

### 3.3 `GET {CLOUD}/api/business/v1/authorize?request=<request>` (HTML)

Opened in the system browser (`WebBrowser.openBrowserAsync`, not an auth
session; `src/components/AuthorizationPanel.tsx`). Not called by app code, so the
shape is free, but the upstream protocol (`docs/CONNECTION_PROTOCOL.md`, "Cloud
handoff") requires:

1. A **current HiTechPOS account login** in that browser (control-plane owner
   account; the password never reaches the app).
2. Display of the matching code (last 6 chars of `request`, upper case) and the
   `deviceName`, with explicit Allow / Deny.
3. CSRF protection, a CSP nonce, same-origin form posts, `frame-ancestors 'none'`
   (compare the shard's page in `business-access.routes.js`).
4. _Design note:_ choice of shop when one account owns several tenants.
5. For `stepUp` requests: force a fresh login (re-enter password) and record
   `authenticatedAt = now`.
6. Optionally, after Allow, offer/redirect to `vn.hitechpos.business://authorized`
   to bring the app forward. The app ignores the link's parameters and never
   reads a code from it; it only polls `/token`. (Upstream used
   `com.posnic.business://authorized`; the shard's own consent page in
   `upstream/pos` still links there – see section 6.)

### 3.4 `POST {CLOUD}/api/business/v1/token`

Polled every `interval` seconds and whenever the app returns to the foreground
(`checkAuthorization()`).

Request body: `{ "request": "<request>", "codeVerifier": "<verifier>" }`.
`CLOUD` must check `base64url(sha256(codeVerifier)) === codeChallenge` of that
request. Responses (all **strict**):

| Situation         | Status          | Body                                                                               |
| ----------------- | --------------- | ---------------------------------------------------------------------------------- |
| Not yet approved  | `202` (any 2xx) | `{"error":{"code":"authorization_pending"}}`                                       |
| Approved          | `200`           | `{"handoff":{"origin":"https://<subdomain>.hitechpos.vn","request":"<43 chars>"}}` |
| Denied            | `403`           | e.g. `{"error":{"code":"access_denied"}}` (client shows an error)                  |
| Expired / unknown | `410`           | e.g. `{"error":{"code":"request_expired"}}`                                        |

`handoff.origin` must be an `https` origin with no path, must already be in
normalized form (`new URL(x).origin === x`) and must **not** equal `CLOUD`.
Nested handoffs are rejected. The handoff should be single-use.

A direct grant from `CLOUD` (`{token, expiresAt, context}`) is also accepted by the
schema but would make `CLOUD` the session origin for every report call. Do not
do that; always hand off.

### 3.5 What the handoff must set up on the shop origin

Immediately after receiving `handoff`, the app calls the **shop**:

`POST {SHOP}/api/business/v1/token` with
`{ "request": handoff.request, "codeVerifier": <same verifier> }`.

The shard (`services/business-access.js → exchange()`) answers with
`{ token: "pb1_<43>", expiresAt: "<ISO-8601 UTC, Z>", context: {...} }` only if a
row already exists in the tenant DB collection **`business_authorizations`**:

```js
{
  _id: sha256hex(handoff.request),          // hash() in business-access.js
  codeChallenge: <the phone's codeChallenge from 3.2>,
  deviceName: "HiTechPOS Business",
  stepUp: <true|false, copied from 3.2>,
  status: "approved",
  userId: <ObjectId of the shop user the owner signs in as>,
  license: <that user's license>,
  authVersion: <utils/auth-version.version(user)>,
  issuedAt: <Date>,
  authorization: "cloud-browser",
  authenticatedAt: <Date of the browser login>,
  createdAt: <Date>,
  expiresAt: <Date, ≤ 10 min ahead>
}
```

So the control plane, which already opens tenant DBs `hitech_t_<subdomain>`,
must on Allow: pick the tenant, map the HiTechPOS account to a **shop user** (the
admin created by `POST /api/install/add`; _design note:_ store that user id on the
tenant record at install), generate `handoff.request` (32 random bytes
base64url), insert the row above, and return the handoff. The shop then
re-checks ACL/branches and issues its own 30-day session (10 min for step-up).

The resulting context must satisfy the strict `contextSchema`
(`src/domain/contracts.ts`): `accountId`, `businessId`, `businessName`,
`branches[] {id, name, currency (ISO 4217), currencyDigits, timezone}` (≤ 100,
unique ids), `capabilities[]` from
`reporting.manage | overview.read | tenders.read | items.read | stock.read | approvals.read | discounts.approve | notifications.self.manage`.
For a Vietnamese shop that means `currency: "VND"`, `currencyDigits: 0`,
`timezone: "Asia/Ho_Chi_Minh"` on each branch; the shard returns
`409 branch_configuration_required` otherwise.

**Step-up:** before an approval decision the app repeats 3.2–3.5 against
`authorizationOrigin` (= `CLOUD` for cloud sessions) with `stepUp: true`, then
requires the resulting session's `origin`, `context.accountId` and
`context.businessId` to equal the current session's (`validateConfirmation()`,
`src/services/decisions.ts`).

The session vault only accepts `authorizationOrigin` equal to the session
origin or to `CLOUD` (`src/services/sessionVault.ts`), so changing `CLOUD` later
signs existing cloud users out.

## 4. Not served by `CLOUD`

All of the following go to the shop origin with `Authorization: Bearer pb1_…`
and are already implemented by the shard: `GET /context`, `/overview`,
`/insights`, `/items`, `/stock`, `/register-summaries`, inbox / approvals /
decisions, push registration and publishers, `GET /sessions`,
`DELETE /sessions/:id`, `POST /session/rotate`, `DELETE /session`.

Push delivery needs a HiTechPOS EAS project (`POSNIC_BUSINESS_EXPO_PROJECT_ID`),
FCM `google-services.json` and APNs credentials (`docs/PUSH_NOTIFICATIONS.md`);
that is build/ops configuration, not a `CLOUD` endpoint.

## 5. Companion apps use the same host for a different protocol

The Mobile POS (`upstream/mobile-app`) and Captain (`upstream/captain`) default
their account service to the same `https://app.hitechpos.vn`, under
`/api/mobile/*` (Posnic Cloud's phone approval service). Summary, for the same
control-plane work item:

| Endpoint                              | Used by         | Request → response                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/mobile/capabilities`        | Captain         | → `{ "applications": ["captain", …] }`; without `"captain"` Captain hides cloud approval                                                                                                                                                                                                                                                             |
| `POST /api/mobile/requests`           | Mobile, Captain | Mobile: `{codeChallenge, deviceId, deviceName:"HiTechPOS Mobile", intent:"login"\|"signup", returnToApp:bool}`; Captain: `{application:"captain", codeChallenge, deviceId, deviceName:"HiTechPOS Captain", intent}` → `{request: 43 chars, authorizationUrl: "{origin}/api/mobile/authorize?…", expiresIn ≤ 900}`; `404` means "service unavailable" |
| `GET /api/mobile/authorize?request=…` | browser         | consent page; Mobile's native browser session waits for `vn.hitechpos.mobile://authorized[?result=approved\|denied]`                                                                                                                                                                                                                                 |
| `POST /api/mobile/token`              | Mobile, Captain | `{request, codeVerifier[, recover:true]}` → `{"error":"authorization_pending"}` or `{baseUrl:"https://<shop>.hitechpos.vn/api", code:"<12 hex upper>"[, connectionToken, localServers[]]}`                                                                                                                                                           |
| `POST /api/mobile/connections`        | Captain         | `{connectionToken, codeVerifier, connectedDevices[]}` → `{baseUrl, localServers[]}`                                                                                                                                                                                                                                                                  |

The `code` is then redeemed on the shop (`/api/mobile/v1/pair` or
`/api/captain/v1/pair`) with the same PKCE verifier, so the control plane must
insert a matching row into the tenant's `mobile_pair_codes` / `captain_pair_codes`
(with `deviceId` and `codeChallenge`; see `upstream/pos/api/src/routes/mobile-pos.routes.js`
and `services/captain-access.js`).

## 6. Related changes outside this directory (not done here)

- `upstream/pos/api/src/routes/business-access.routes.js` still links the shard's
  own consent page to `com.posnic.business://authorized` and titles it
  "Connect Posnic Business". With the app now on scheme
  `vn.hitechpos.business`, that link no longer reopens the app automatically
  (polling still completes the sign-in once the user switches back). Patch it
  in `upstream/pos` and record it in `docs/UPSTREAM.md`.
- The shard's CORS/pairing helpers still mention `posnic.io`
  (`api/src/utils/shop-hosts.js`, `pairing.js`, `middleware/cors-origins.js`).
