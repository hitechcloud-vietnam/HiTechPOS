# Delivery roadmap

The dedicated Business app is separate from Mobile POS and Captain. It reads bounded summaries and leaves long reports and heavy administration to desktop.

## Current delivery state

The latest installable artifact is [Android preview 7](https://github.com/Posnic/posnic-business/releases/tag/v0.1.0-preview.7).
[Release readiness](RELEASE_READINESS.md) is the current qualification checklist;
[implementation checkpoints](IMPLEMENTATION_STATUS.md) retain historical evidence.
Implemented source and an installable test APK do not establish production readiness.

| Phase | Deliverable                                                                                            | Gate                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Reporting, sync, identity, ACL and event compatibility audit; canonical metrics and contract decisions | Reconcile actual POS fixtures; resolve source completeness, reporting credentials, scope and cost blockers before live integration |
| 1     | Public repository, native app shell, design components, typed client boundary and local sample adapter | Reproducible clean build, tests and attribution checks; accessible single/multi/zero-branch states                                 |
| 2     | Cloud-primary and Community browser authorization, secure remembered session, PIN recovery and ACL     | Separate reporting grant; no stored account password; revocation, issuer isolation and native secure-storage tests                 |
| 3     | Accurate Today, scoped drill-down and data freshness                                                   | Canonical reconciliation and bounded query budgets; no checkout latency regression                                                 |
| 4     | Item/stock insights, Inbox, closing/fixed-time summaries and notification preferences                  | Durable delivery, deduplication, quiet hours, business timezone, retries and revoked-access handling                               |
| 5     | Large-discount request/review/approve/decline and till application acknowledgement                     | Operation binding, expiry, concurrency, one-use consumption, audit history and verified application                                |
| 6     | Localization, accessibility, security, device lifecycle, load/battery QA, pilot and release            | Language review, native device evidence, privacy/store requirements and rollback gates                                             |
| 7     | Evidence-led extra approval types and cross-instance aggregation                                       | Independent ACL, source correctness and bounded computation cost                                                                   |

Phase 1's public repository and sample foundation are implemented. Phase 2's Cloud/Community browser authorization, encrypted PIN, optional biometric unlock and session management are implemented with companion server changes; deployment and real-device qualification remain gates. Phase 0's metric reconciliation and source-completeness work continue before live reporting. A public source repository is not an app-store or production release.

## Product requirements

- Today, Insights, Inbox, More; simple native controls and progressive detail. No phone charting dependency.
- Branch selector depends on accessible branch count, never role name. One branch is automatic; zero means unavailable.
- All data and actions ultimately require server-side capabilities, branch checks and field filtering. Hiding buttons is only a UI layer.
- Initial public release targets 18 languages; Arabic RTL, local number/date formatting, recipient-language notifications and native-speaker review of high-impact wording.
- Cloud sign-in is primary; own Community server remains a visible option. PIN is local unlock, not server authorization. Protect refresh credentials with platform secure storage and never retain passwords.
- Current/delayed/partial/offline/unavailable are distinct. Refreshing an API does not establish source completeness.
- Daily summaries can run after a real session-close event or at a configured time such as 23:00. Respect timezone, quiet hours and provisional data; deduplicate close/fallback schedules.
- Approval review shows requester, reason, bill version, before/after amounts and policy. “Approved” is distinct from “Applied at till.” No financial action is executed by a swipe.
- Use indexed, bounded reads of prepared summaries and small incremental updates. No historical rebuild or heavy report is triggered by opening a screen.
- Personal preferences belong under More; organizational settings belong on their corresponding desktop module page. Features cards remain switches only.

Current implementation includes bounded prepared Today summaries, last-known in-memory read states, scheduled Inbox summaries, opt-in push infrastructure, native navigation and authenticated discount review. Approval review includes current ACL/limits, fresh browser password confirmation, explicit confirmation and uncertain-response recovery; the companion cashier transport and durable execution recovery are implemented in draft branches, with production decisions disabled. See [approval implementation](APPROVALS.md).

## Remaining work by release gate

1. Deploy compatible non-production Cloud and Community environments and supply
   controlled accounts. Verify browser authorization, tenant handoff, live ACL,
   branch revocation and session removal end to end. The configured Cloud discovery
   endpoint currently returns 404; no deployment is implied by an APK release.
2. Reconcile prepared Today, item/stock insights and session-close/fixed-time
   summaries against controlled POS operations, including returns, concurrent
   receiving, outages and incomplete source history. Qualify desktop cost, slow
   networks and low-end device behavior. Heavy reports remain on desktop.
3. Configure the owner's push project/providers and verify delivery, quiet hours,
   category mute migration, languages and tap-to-locked-Inbox on actual devices.
   Stock opt-in, history, retention and bounded delivery source are implemented;
   removed-item lifecycle and general account erasure remain server work.
4. Rehearse approval recovery on deployed tills. Scoped pre-claim and execution
   discovery are implemented; cross-cashier escalation and resolution of consumed
   executions with no verified receipt remain open. Never infer a failed sale from
   a missing receipt or authorize a replacement merely because a request expired.
5. Validate physical PIN/biometric storage, process death, app-switcher privacy,
   in-place Android upgrades, gestures, keyboard/sheets, accessibility and RTL.
   Obtain a current iOS native build and qualified review of all eighteen languages.
6. Complete production signing, privacy/store information, pilot monitoring and
   rollback qualification. Publish a production release only after these gates pass.

These gates preserve the original phases and requirements above. They are not
replaced by synthetic sample data, bundle exports or browser-only test results.
