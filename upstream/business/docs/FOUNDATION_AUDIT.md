# Initial compatibility audit

28 September 2026. Static source inspection only; no production queries or customer records were accessed. This is a first audit slice, not Phase 0 completion.

The POS source baseline inspected is commit `f0ff2e87371bf72e2bc10e70467e99902c5980f3` plus its current local checkout. References below name public POS source components; they do not contain operational addresses or credentials.

| Area                 | Evidence from inspected code                                                                                                                                                                          | Business consequence / next work                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing overview    | `api/src/routes/dashboard.routes.js`, `controllers/dashboard.controller.js`, `models/dashboard.model.js`: protected overview combines totals, payment mix, items, stock and optional financials       | Useful reusable calculations, but the combined endpoint runs multiple aggregation routines. Do not treat one request as proof of low server cost. Profile and prepare bounded summaries.        |
| Sales definitions    | `models/dashboard.model.js` and `services/sale.service.js` use separate aggregation paths and legacy field aliases; dashboard selection/grouping uses date and updated-date fields in different steps | Explicitly reconcile date attribution, tax, returns, payment collection and completed count against authoritative fixtures before mapping to Business net sales.                                |
| Branch scope and ACL | Dashboard derives context from authenticated/request context; separate branch utility has its own role/module rules                                                                                   | Produce a single Business capability mapping and server-enforced permitted-branch contract. Existing role labels must not silently imply every Business permission.                             |
| Freshness            | The inspected overview response exposes no contiguous source checkpoint or projection watermark                                                                                                       | Cannot currently label that response complete/current under the new contract. Define the source protocol and unknown/partial states first. This does not assert no checkpoint exists elsewhere. |
| Low-stock errors     | The inspected summary helper catches failures and returns an empty count/list                                                                                                                         | Business must distinguish unavailable stock from no alerts. Add an explicit availability result before reuse.                                                                                   |
| Mobile sign-in       | Existing mobile authorization is designed to enroll a sales device; its grant includes pairing/sales-authority information                                                                            | Introduce a reporting-specific grant and verify Cloud and Community support. Never enroll a till to open Business.                                                                              |
| Remembered accounts  | Existing mobile session abstraction includes password-bearing account data                                                                                                                            | Business needs a password-free session contract and separately reviewed PIN/secure-store lifecycle; do not copy that contract unchanged.                                                        |
| Manager approvals    | `routes/authorizations.routes.js` and `utils/approval-token.util.js` support local manager proof                                                                                                      | Reuse policy concepts, but remote approvals additionally require request persistence, bill-version binding, atomic decision, one-use application, expiry and acknowledgement.                   |
| Session-close / push | Not audited in this slice                                                                                                                                                                             | Inventory authoritative close/reopen events, notification transports and Community delivery configuration before Phase 4.                                                                       |
| Localization         | Existing mobile product has an 18-language registry, with non-English beta wording                                                                                                                    | Reuse approved vocabulary after review. Business-only wording and recipient notifications require separate translation coverage and linguistic sign-off.                                        |

## Contract decisions implemented in the foundation

- Response schema and metric-definition versions are explicit.
- Money values are safe integer minor units, paired with currency precision.
- A single overview response represents one currency group. Mixed-currency requests must be grouped before aggregation.
- Context contains explicit branches and capabilities. An empty branch set cannot request all data.
- Validate requested branch membership and exact response scope; reject another business's result.
- A `current` response requires completeness and a source update time. This shape check is not proof of the upstream protocol; a real adapter must establish that evidence.
- The sample adapter is intentionally separate and local. Compatibility discovery now performs a credential-free request on explicit user action; no real token, live report or background polling is connected.

## Required evidence before live reads

1. Canonical metric mapping, including gross/net/tax, return date treatment, training/drafts, fully refunded count and old-invoice collections.
2. Actual POS fixture reconciliation for duplicate delivery, corrections and offline/reconnect; current tests cover synthetic fixtures only.
3. Authenticated branch directory, capability mapping, reporting-only grant, revocation/renewal and Community compatibility/version negotiation.
4. Source/projection watermark protocol and explicit availability semantics for every card.
5. Query/index/volume baseline and incremental summary design, without dashboard work in checkout's synchronous path.

Until these are resolved, only the clearly labelled sample foundation is executable. No production reporting readiness is implied.
