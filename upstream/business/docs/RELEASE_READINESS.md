# Release readiness — 29 September 2026

Status: test prerelease available; production release is not ready.

## Artifacts and verified scope

- Public app: [Posnic Business](https://github.com/Posnic/posnic-business).
- Published Android test build: [preview 7](https://github.com/Posnic/posnic-business/releases/tag/v0.1.0-preview.7), source `f71a8e083dbdecd578d6427e3953a49ae5ab48da`, versionCode 7. Development-signed, with embedded JavaScript/assets.
- This source passed TypeScript, 102 app tests, 39 browser flows, formatting and attribution. [Build 36564725837](https://github.com/Posnic/posnic-business/actions/runs/36564725837) passed native compilation, signature, embedded-bundle and forbidden-permission checks. [Android 15 smoke run 36565977255](https://github.com/Posnic/posnic-business/actions/runs/36565977255) passed fresh installation, sample dashboard, Insights, paging and background/resume.
- Downloaded APK SHA-256: `338d6b017e43ed9c0ad647e069e86ed1763b99477035e71b2e49b956712a5240`; size 58,432,609 bytes. Certificate matches preview 6; an actual in-place upgrade has not been exercised.
- Preview 7 adds negotiated Android decision/summary/stock categories with legacy mute inheritance and preserves Inbox navigation intent across background locking. Real delivery, physical category migration and notification-tap lifecycle testing remain open; the app still needs an owner-provided EAS project identity and provider configuration.
- Companion review: [POS #1023](https://github.com/Posnic/POS/pull/1023), [Gateway #28](https://github.com/Posnic/Gateway/pull/28), and [mobile #17](https://github.com/Posnic/posnic-business/pull/17). These remain drafts, stacked on earlier feature branches.
- [POS CI](https://github.com/Posnic/POS/actions/runs/36560731301) passed all jobs at `ee27b3e0`, including the retained-stock lifecycle and read-only checkout recovery batch. Local validation passed 265 Business integration cases, 153 focused unit cases and 10 cashier UI cases. Later source through `92126f8e` adds removed-branch cleanup, notification categories and scoped pre-claim recovery. Its local batch passed 274 cases but failed one Mongo teardown hook; the affected snapshot suite passed 102 cases on rerun with forced Mongo shutdown after timeout. Nineteen focused checkout/outbox/protocol cases and twelve cashier UI cases passed. Current [CI 36565733082](https://github.com/Posnic/POS/actions/runs/36565733082) passed all eight jobs at `92126f8e`, including API unit, desktop, real-database REST, packaging, lint/formatting, API docs, attribution and secret-history checks. Translation and CLA checks also passed. The Windows cleanup issue above remains part of the local evidence; hosted success is not deployed qualification.

## Requirement audit

| Requirement                                              | Current evidence                                                                                                                                           | Remaining release gate                                                                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Separate, easy-to-use Business app and public repository | Dedicated native shell and sample; narrow-screen, large-text and navigation browser checks                                                                 | Physical-device usability and accessibility review                                                                                       |
| Useful lightweight analytics                             | Bounded prepared Today, seven-day Insights, item ranking/detail and Stock watch; unavailable/partial states; desktop-only scans                            | Real-business reconciliation, low-end desktop/device load and source completeness                                                        |
| Live ACL and branch control                              | Dedicated Business sessions, server checks, independent financial/stock/approval access; single-branch chooser hidden; revocation integration tests        | Deployed end-to-end scope and revocation testing                                                                                         |
| Remembered authentication, PIN and biometrics            | Encrypted device vault, six-digit PIN, persistent five-attempt limit, optional strong biometrics and background lock; unit tests                           | Physical SecureStore/biometric enrollment, process death and app-switcher privacy tests                                                  |
| Cloud-first and Community login                          | HTTPS browser authorization, PKCE and dedicated tenant handoff; protocol and browser tests                                                                 | Actual deployed compatible origins and controlled accounts                                                                               |
| Notifications, summaries and decisions                   | Durable Inbox, daily/close schedules, quiet hours, generic push adapter, decision review/application protocol; database tests                              | Real provider/relay delivery, receipt/tap behavior, cross-cashier escalation, deployed request recovery and source checks                |
| Low-stock alerts                                         | Desktop observations, automatic recipient demand, assigned Cloud/Community publication, scoped Inbox and current-stock push validation; restart/race tests | Rollout, network/capacity qualification and remaining removed-item lifecycle and general account erasure                                 |
| Standard mobile interactions                             | Pull refresh and visible alternatives, interior item swipes, boundary handling, native stack/Back, unsaved-edit protection and RTL tests                   | Physical edge/back/keyboard/sheet behavior, haptics, TalkBack/VoiceOver and reduced-motion review; predictive-back animation is disabled |
| Eighteen languages                                       | Complete draft catalogs, key/placeholder/plural checks, local numeral formatting, RTL and browser layout coverage                                          | Qualified linguistic review, native system dialogs and recipient-language push checks                                                    |
| Installable release                                      | Preview 7 APK and emulator smoke evidence                                                                                                                  | iOS compilation, physical Android qualification, production signing, privacy/store disclosures, pilot and rollback qualification         |

## Connected environment check

A credential-free request to the configured Cloud origin on 29 September 2026
returned HTTP **404** with `Cannot GET /api/business/v1/discovery`:
`https://www.posnic.com/api/business/v1/discovery`.

Therefore the current production origin does not expose the required discovery
route. This observation proves only that this route is unavailable at that origin;
it does not establish the state of private staging environments. A repeat check on 29 September returned the same 404. No credentials
were submitted and no server configuration was changed. Local `adb devices -l`
reported no connected Android devices; this workstation has no `xcodebuild`
command. The published emulator result does not qualify physical security or iOS.

Connected qualification needs a non-production Cloud tenant and Community HTTPS
origin with the companion revisions deployed, controlled accounts with multiple
ACL/branch profiles, and owner-configured push credentials. Request URLs and account
names in chat; enter passwords through the authorization UI, not release notes.

## Next verification sequence

1. Finish and batch-review remaining source lifecycle/reconciliation work; keep
   deployment flags off until the paired server revisions are qualified.
2. Validate discovery, Cloud tenant handoff and Community sign-in on the supplied
   test origins, followed by live permission/branch/session revocation.
3. Verify actual desktop preparation, summaries, stock alerts and approval outcomes
   against controlled POS operations, including outage and retry recovery.
4. Test real push delivery, quiet hours, language, tap-to-locked-Inbox behavior and
   device/session revocation on Android and iOS.
5. Build current source, inspect merged permissions, and run physical security,
   accessibility, RTL, gesture and lifecycle checks. Obtain language review.
6. Qualify production signing, privacy/store information, pilot monitoring and
   rollback before marking release readiness complete.

The sample walkthrough and synthetic responses are useful development tools. They
must not be substituted for connected or physical-device evidence in this audit.
