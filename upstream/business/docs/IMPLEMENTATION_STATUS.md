# Implementation status

Version 0.1.0 development foundation, started 28 September 2026.

For the current release assessment, see [Release readiness](RELEASE_READINESS.md).
The checkpoints below are chronological implementation evidence; their historical
open-item statements are not a current release checklist.

## Reporting refresh follow-up after preview 7

Stock watch retains its same-session, same-ACL, same-branch in-memory observation
while refreshing. Transient transport failures keep the visible observation and
expanded rows with a connection warning; its original observation time, partial
coverage and expiry are not renewed. A successful refresh replaces the snapshot.
Expired or mismatched snapshots, malformed responses, unsupported/unavailable
server results and access loss do not preserve figures. Overlapping refresh calls
share the active request. Leaving the screen still discards the component state.

Item rankings and seven-day insights use the same transport-failure behavior.
They retain only the same authorized scope and branch-local reporting day, leave
original expiry intact, and clear invalid responses. A successful item refresh
closes the old detail selection before replacing its ordered result set, so an
index cannot silently refer to a different item. Transient failures preserve the
existing seven-day gaps rather than claiming zero or newly checked source data.
The connected browser flow checks preserved values, malformed-response clearing,
recovery, incomplete item history and removal on navigation/sign-out.

English/Arabic browser regressions check in-flight preservation, a failed network
request, malformed data, recovery and revocation. These source changes follow the
published preview 7 APK; installed-device refresh qualification remains open.

## Present

- Approval-alert opt-in and quiet hours on a dedicated branch settings page, independent of daily summaries. Compatible servers advertise the new contract. Inbox accepts scoped request identifiers, removes expired entries, preserves pagination through filtered empty pages and opens the existing authenticated review flow. Push taps still only open the unlocked Inbox. All 18 catalogs include working alert copy; linguistic and native provider qualification remain pending.

- Connected-account Insights shows the previous seven completed branch-local dates using existing version-2 desktop-prepared summaries. It preserves partial/delayed labels, missing-day gaps and negative sales after returns; it does not claim percentage growth or complete totals from incomplete sources. Reads are sequential with a 20-second overall budget, scoped to compatible branches, and cancelled when leaving the tab. Figures expire after 15 minutes or branch midnight and clear on failed refresh. The 18-language period label, expandable metric explanation, narrow-screen layout and authenticated browser flow are checked. Best-selling item ranking and detail are implemented with negotiated bounded item summaries; stock insights and full source-completeness qualification remain open.

- Public-repository source layout, Expo/React Native shell and separate Business application identity.
- Light/dark Today, Insights, Inbox and More screens using fictional Anbu Café data.
- Capability-based sample access, single-branch auto-selection, multiple-branch selector and explicit zero-access state.
- Overview schema/scope validation, safe money formatting, pure gesture rules and local sample adapter.
- Refresh control/button with offline preservation; item detail with Previous/Next and native interior swipe responder.
- Cloud/Community HTTPS compatibility checks with cancellation, timeout and unsupported/unreachable states. Compatible servers expose a separate browser sign-in flow.
- Cloud and Community browser authorization with PKCE, matching code, session context, sign-out and separate real-account screens. Cloud resolves the account to a tenant using a one-use proof-bound gateway handoff. Companion server changes are in review; deployment is pending.
- Native six-digit PIN vault with device secure storage, scrypt/AES-GCM encryption, a persistent five-attempt limit and background locking. Only origin/token/expiry are remembered; device testing remains required. Browser preview keeps sessions in memory only.
- Optional strong biometric unlock using OS-protected credential reads, PIN-enrollment binding, background cancellation and an inactive-screen privacy cover. PIN fallback remains available. Connected-device listing and confirmed removal use the account-scoped server session API.
- Reporting transport with POS-token format rejection, bounded response streaming and exact scope/date checks. Expo fetch is used for explicit native cookie omission and redirect rejection; native runtime qualification remains pending.
- Live Today screen for version-2 prepared summaries: sales after returns including tax, billed sales, returns and bill count. Branch-local dates, single-branch auto-selection, pull-to-refresh, strict reconciliation and partial/delayed labels. Failed refresh clears amounts; access loss locks the account. The companion desktop/gateway pipeline has local real-database tests; production deployment is pending.
- All 18 complete working catalogs, validated placeholders, remembered language choice before sign-in and in More, locale-aware numbers/dates and native numeral entry. Screens update without remounting the account. The initial release target remains 18 languages. Test/format/build scripts and the existing CI workflow remain in place.
- Private real-account Inbox with bounded pagination, read status, pull-to-refresh and Android Back. Daily per-branch schedules and quiet hours use branch time with revision checks. The companion server persists delivery without an open phone, requests desktop preparation in advance and checks current access before delivery and history reads. Unavailable data produces an explicit notice. A native push adapter is implemented but awaits provider credentials and physical-device qualification.

## Pending

- Broader real-business report reconciliation and source-completeness checkpoints. Actual sale/return writers and a 100,000-sale desktop fixture have been checked locally; production and low-end hardware remain unqualified.
- Community HTTPS deployment qualification, native secure-storage qualification and cache revocation. Local Community publication without Gateway is implemented in the companion POS draft.
- Native push provider/device qualification and official-app Community relay, session-close and stock triggers, approval notification provider qualification and operator handling for unresolved cashier execution. The owner review, scoped request/application service and cashier recovery flow are implemented in companion draft branches with production decisions disabled.
- Native-speaker sign-off for all 18 working catalogs, plural/count wording and Face ID permission descriptions, on-device system-dialog language checks, Android notification-channel and recipient-language delivery device qualification, native RTL/screen-reader qualification and locale-data startup/memory qualification. All 18 Face ID resources now pass native template generation/registration and repeat-generation checks. Cardinal plural selection and localized numeric interpolation are implemented and tested, including singular approval counts and Nepali item positions in the browser.
- Native navigation/device qualification, Android predictive-back compatibility, native haptics, sheet behavior and accessibility/lifecycle checks. Real account native stack/tabs are implemented; predictive-back animation is disabled for current library compatibility.
- Real-device testing, signed release builds, store publication and production deployment. Earlier authorization code compiled successfully into an Android debug APK and iOS simulator app; newer biometric changes still require native compilation and device validation.

Sample access profiles in More are development controls; a production build must receive capabilities from its authenticated server. They are not authorization or a way for staff to elevate access.

Validation results are maintained with the initial release commit and repository CI. A passing web export or synthetic unit test is not proof of native device readiness or production report correctness.

Initial local verification: TypeScript check, 11 domain tests, attribution check, formatting check, web export and 3 browser tests passed. Browser coverage includes scope/ACL behavior, item navigation, offline refresh, unavailable sign-in, Community address validation and 320px overflow checks.

Connection milestone local verification: TypeScript, 16 domain/transport tests, attribution, web export and 4 browser tests passed. New checks cover issuer/protocol mismatch, cancellation, timeout, malformed responses, denied scopes, incorrect dates and obsolete UI requests. Responses are mocked; no production account or live reporting endpoint has been exercised.

Authorization checkpoint: 29 app domain/transport/vault tests and six tenant-server integration tests pass locally. The Cloud account-service suite passes 598 tests and the gateway suite 214. Five browser flows cover sample behavior, connection, real scope, sign-out and connected-device removal. These use controlled responses, not a deployed production account.

Native build run 36376341281 produced an Android debug APK and iOS simulator app for the earlier authorization commit. The additional native-build workflow was removed from this branch after the repository's local-verification/cost rule was discovered; local commands remain documented in NATIVE_VALIDATION.md. No device readiness is claimed. The inherited uuid build dependency is overridden to patched 11.1.1.

Prepared-report checkpoint: 31 app tests and five browser flows pass. Browser coverage includes verified live totals, explicit partial data, no branch selector for a single branch and clearing an amount after unavailable refresh. Companion local verification includes 14 POS authentication/read/preparation tests, nine gateway publication/agent integration tests and 82 sale-writer/metric tests. These do not prove deployed source completeness, native readiness or production scale.

Publisher-management checkpoint: owners with branch membership can select a recently connected desktop, confirm replacement and immediately clear/reload previous totals. The server uses a generation check and durable audit journal. Local checks pass 33 app tests, five browser flows (including explicit confirmation), 16 POS integration tests and ten gateway reporting tests. Management is on the branch's Reporting desktop page, not a Features switch.

Notification checkpoint: 35 app tests and five browser flows pass, including saving a schedule, reading an unavailable notice and marking it read. POS validation passes 11 Business access/reporting route tests, five real-Mongo notification tests and six scheduling/worker unit tests. Quiet hours, daylight-saving gaps/repeated hours, concurrent workers, interrupted checkpoints, ACL removal and tenant fairness are covered. The mobile preview has been visually checked at 390px. These are local checks, not native push or deployed production validation.

Push adapter checkpoint: native opt-in, project-bound registration, generic lock-screen alerts and safe Inbox navigation are implemented. Companion server delivery uses retry records and receipt checks, current session/ACL validation and registration generations. Local checks pass 37 app tests, five browser flows and Android/iOS JavaScript exports. Provider tests use a fake transport; no actual push has been sent. Production project credentials, physical-device validation and a Community relay are still required; see PUSH_NOTIFICATIONS.md.

Navigation checkpoint: real accounts use persistent Today/Inbox/More tabs and dedicated native-stack pages for schedules, reporting desktops, devices and security. Branch choice is a modal only when multiple branches are accessible. Unsaved schedules prompt before leaving. Privacy cover overlays preserve an active OS-prompt screen while true background transitions still lock and remove the account navigator. Browser checks cover the full flow, explicit tab accessibility labels, unsaved-edit retention and small-screen overflow. Physical iPhone/Android gesture and assistive-technology qualification remains required.

Offline snapshot checkpoint: Today retains the last validated summary only for transient network/timeout, throttling or server failures. The in-memory snapshot is bound to the exact session, account, ACL context, branch scope and branch calendar day; it expires after 15 minutes or session expiry. Background locking/unmount and publisher replacement discard it. An authoritative unavailable (503), denied, incompatible or invalid response clears it. The UI labels refreshing/last-known values explicitly. Local checks pass 39 tests and five browser flows, including offline retention and recovery; no persistent offline database or offline decision execution is introduced.

Privacy hardening: the iOS switcher protection now inserts an opaque native view directly above the application window contents on resign-active/background. This replaces the SDK blur, whose placement beneath native modal presentations was insufficient for the desired coverage. The installed Expo AppDelegate template passes transformation/idempotency checks. Windows cannot generate or compile the full iOS project; macOS compilation and physical-device snapshot testing remain release gates. App local checks now pass 40 tests.

Localization checkpoint: the current English/French catalogs pass exact-key and interpolation validation. The language engine updates mounted screens, isolates interpolated RTL values, and does not touch authentication storage. Native decimal digits are normalized to protocol ASCII for PIN and time entry. Local checks pass 51 app tests, TypeScript, formatting and attribution; browser checks cover persistence, current-screen preservation, an invalid saved preference and narrow layouts. The six existing browser flows also passed during this change. French onboarding was visually inspected. Native exports and physical RTL/screen-reader qualification remain open for this batch; no multilingual release readiness is claimed.

Arabic and gesture checkpoint: Arabic now covers all current messages. Directional icons, text alignment and numeric/URL input direction are explicit. Simulated touch tests exposed and corrected a PanResponder threshold bug: movement is now measured from the initial touch point, including after responder ownership changes. Normal 90-pixel swipes page once in both reading directions; screen-edge gestures leave the item unchanged. All ten browser flows pass. Arabic light onboarding and dark Today were visually inspected; 320px screens do not overflow. Android and iOS Hermes exports pass for this localization batch, alongside 51 app tests and TypeScript checks. These exports are not signed native builds or physical-device evidence.

Tamil and text-size checkpoint: Tamil now covers every current message. A browser test runs every bundled catalog through narrow layouts and a 200% text-size approximation. It found and corrected overlapping sample tab labels and button overflow. Real-account tab labels also wrap, and their measured height expands the bar. The connected Tamil fixture confirms language switching preserves the authenticated account, issues no extra authorization request and keeps the token out of browser storage. Local verification passes 52 app tests and 15 browser flows; the enhanced account text-size case also passes. Tamil onboarding and Today were visually inspected. Qualified language and physical-device review remain outstanding.

Hindi and Spanish checkpoint: both catalogs cover all 244 current messages, with exact keys and interpolation preserved. Both pass the shared 320px browser flow and 200% text-size approximation. Hindi Today and Spanish onboarding/Today were visually inspected. TypeScript, all 52 app tests (including seven localization tests), formatting, attribution and the web build pass. These checks establish working development packs; qualified language review and physical-device qualification remain open.

Portuguese checkpoint: the European Portuguese catalog covers all 244 current messages. Exact-key/interpolation checks, TypeScript, web export and the 320px/enlarged-text browser flow pass. Onboarding and Today were visually inspected. Seven of the 18 target languages are now selectable in the working localization branch; language review and native qualification remain outstanding.

Indonesian checkpoint: all 244 current messages are translated, with exact message keys and placeholders preserved. Seven localization tests, TypeScript, the web export and the Indonesian 320px/enlarged-text browser flow pass. Onboarding and Today were visually inspected. Eight of the 18 target languages are selectable in the working localization branch; qualified language review and native-device qualification remain open.

German checkpoint: all 244 current messages are translated. Seven localization tests, TypeScript, web export and the German 320px/enlarged-text browser flow pass. Onboarding and Today were visually inspected. Nine of the 18 target languages are selectable in the working localization branch. Qualified translation review, physical-device accessibility and native release qualification remain open.

Italian checkpoint: all 244 current messages are translated. Seven localization tests, TypeScript, web export and the Italian 320px/enlarged-text browser flow pass. Onboarding and Today were visually inspected. Ten of the 18 target languages are selectable in the working localization branch. Qualified translation review and native-device release qualification remain outstanding.

Dutch checkpoint: all 244 current messages are translated. Seven localization tests, TypeScript, web export and the Dutch 320px/enlarged-text browser flow pass. Onboarding and Today were visually inspected. Eleven of the 18 target languages are selectable in the working localization branch. Qualified translation review and native-device release qualification remain outstanding.

Swahili checkpoint: all 244 current messages are translated. Seven localization tests, TypeScript, web export and the Swahili 320px/enlarged-text browser flow pass. Onboarding and Today were visually inspected. Twelve of the 18 target languages are selectable in the working localization branch. Qualified translation review and native-device release qualification remain outstanding.

Nepali checkpoint: all 244 current messages are translated. Seven localization tests, TypeScript, web export and the Nepali 320px/enlarged-text browser flow pass. Onboarding and Today were visually inspected, with Devanagari text. The Chromium runtime lacks native Intl support for Nepali (and Sinhala), so numeric formatting currently falls back to English; deterministic locale-data fallback is still required. Thirteen of the 18 target languages are selectable in the working localization branch. Qualified translation review and native-device release qualification remain outstanding.

Locale runtime checkpoint: offline FormatJS locale data corrects missing Nepali/Sinhala number and date support while preserving the original device language and timezone. The fallback loads only when a runtime lacks a target locale; its data is bundled for all 18 target languages plus required regional variants. App foreground transitions refresh the device timezone. Local validation passes 52 app tests, 26 browser flows, formatting, attribution, web export and Android/iOS Hermes exports; the two dedicated Intl browser cases pass again after the foreground hook change. Nepali Today was visually inspected with localized currency digits. These exports do not prove physical-device or signed-release readiness.

Thai checkpoint: all 244 current messages are translated. Exact-key/placeholder tests, TypeScript, web export, attribution and the Thai 320px/enlarged-text browser flow pass. Onboarding and Today were visually inspected. The formatter now includes Buddhist-calendar data and selects it explicitly for Thai; browser checks verify the localized year without changing the canonical branch date. Both Intl browser tests pass after the calendar change. Fourteen of 18 target languages are selectable; qualified translation review and native-device release qualification remain outstanding.

Malayalam checkpoint: all 244 current messages are translated. Seven localization tests, TypeScript, web export and the Malayalam 320px/enlarged-text browser flow pass. Onboarding and Today were visually inspected. Fifteen of the 18 target languages are selectable in the working localization branch. Qualified translation review and native-device release qualification remain outstanding.

Kannada checkpoint: all 244 current messages are translated. Seven localization tests, TypeScript, web export and the Kannada 320px/enlarged-text browser flow pass. Onboarding and Today were visually inspected. Sixteen of the 18 target languages are selectable in the working localization branch. Qualified translation review and native-device release qualification remain outstanding.

Telugu checkpoint: all 244 current messages are translated. Seven localization tests, TypeScript, web export and the Telugu 320px/enlarged-text browser flow pass. Onboarding and Today were visually inspected. Seventeen of the 18 target languages are selectable in the working localization branch. Sinhala, qualified translation review and native-device release qualification remain outstanding.

Full catalog checkpoint: Sinhala completes the 18 planned language packs, each covering 244 current messages. The language screen now accurately describes all packs as available in this development build and still under review. All 52 app tests and 31 browser flows pass, including every language at 320px and a 200% text-size approximation. TypeScript, formatting, attribution and web export pass. Sinhala onboarding and Today were visually inspected. Qualified linguistic review and the pending localization/native release gates above remain open.

Both Android and iOS Hermes exports also pass with all 18 catalogs and Thai calendar data; each is approximately 12 MB. Physical-device startup/memory measurements and signed builds are still pending.

Approval-alert checkpoint: 71 app tests, all 31 browser flows, TypeScript, formatting and attribution checks pass. Android and iOS Hermes exports pass at approximately 12 MB each. The browser exercises separate alert opt-in, quiet-hour validation, unsaved-change retention, filtered empty-page pagination, expiry removal and secure review with lost-response recovery. Settings and Inbox were visually inspected at 390px. Paired POS validation passes 38 real-Mongo integration tests. These checks use controlled provider/browser responses and do not establish physical notification delivery, signed native readiness or qualified translations.

## Stock client contract (29 September)

The connected stock service negotiates `bounded-stock-v1` before an authenticated
request to the fixed issuer's `/api/business/v1/stock` endpoint. It requires
`stock.read` and a single accessible branch, without financial permission. Older
servers receive no stock request, and missing snapshots never become sample data.
The response validator enforces scope, unit thousandths, coverage and reason
counts, sorted unique IDs, bounded/truncated lists and incomplete freshness.
Expired, future, corrupt and falsely complete observations are rejected.

Six stock tests cover negotiation, ACL, old-server compatibility, corrupt data,
empty/truncated coverage and freshness. The stock screen, navigation, localized
coverage explanations and notification settings are not implemented yet. This
client work is not in Android preview 2.

## Connected stock screen (29 September)

Stock watch is now a capability-controlled account tab, available independently
of financial insights. It uses the existing branch scope control (no selector
for a single accessible branch), pull-to-refresh and an explicit refresh button.
It shows stored on-hand quantities in exact unit thousandths, item/branch reorder
levels, negative-stock guidance, observation time and checked/unavailable/excluded
coverage. Empty data never claims all stock is healthy. The first 20 returned
rows are rendered initially, with Load more in batches of 20 and a visible known
low-stock count. The server's 100-row bound remains explicit in that count.

Data is memory-only, scoped to session and current ACL context, cancelled on
screen exit or replacement, cleared on refresh failure and removed on expiry.
The stock screen does not edit inventory or calculate stock from sales. All ten
new messages have draft translations in the eighteen language packs. Qualified
language review remains outstanding.

Validation: 84 app tests, TypeScript, attribution, formatting, web export and all
35 browser flows pass. English and Arabic connected stock screens were inspected
at 320px; tests exercise stock-only access, RTL five-tab layout, negative quantities,
bounded loading and unavailable refresh clearing. Stock alert preferences/delivery,
physical-device validation and production source reconciliation remain open.
Android and iOS Hermes bundle exports also pass (about 12 MB each); these are
bundle checks, not installed-device qualification. Android preview 2 does not
include this screen.

Stock-alert preference client checkpoint: `stockNotifications` negotiates the
opt-in `stockAlertPreferences=1` discovery contract before both reads and saves.
It requires current stock/notification permission and branch scope, a valid
unexpired Business credential and the original issuer. Requests remain on the
fixed stock-preference endpoint within one 20-second operation budget. The strict
schema checks branch timezone, quiet hours, revision and supported 15/30/60/180
minute intervals. Saves send only controls plus expected revision and require an
exact confirmed response. HTTP 409 is a non-transient conflict, while decision
requests that explicitly accept 409 retain their existing response contract.

All 91 app tests, TypeScript, attribution and formatting pass. This is client
plumbing, not a mobile settings screen or notification-delivery completion. The
server advertises this preference capability only for the opt-in query with its
stock-alert flag enabled. Production activation and preview 3 are unchanged.

Stock-alert settings preview 4 checkpoint: the dedicated module page offers
branch-scoped opt-in, 15/30/60/180-minute intervals and quiet hours. Single-branch
accounts skip the branch chooser. Drafts survive conflicting saves; refresh
loads the current revision, and navigation protects unsaved edits. Labels are
in all eighteen draft language packs. Unsupported servers expose no save action.

Validation: 91 app tests and 37 browser flows pass, including English/Arabic
settings at 320px, conflict recovery, native-digit time entry and unsupported
server handling. TypeScript, attribution and web export pass. Preview 4 uses
Android versionCode 4. Stock-alert recipient delivery and production activation
remain unfinished; settings availability requires the companion server capability.
Physical-device and qualified translation review remain open.

## Stock Inbox history

The app requests `discovery?stockAlerts=1` and opts into Inbox `stockAlerts=1`
only after the original issuer advertises `inbox-stock-v1`. Older servers keep
their existing Inbox kinds. Unnegotiated stock entries and stock pages over ten
entries are rejected. Opaque Business credential format and expiry are checked
before networking and again after discovery, with stock access rechecked before
the authenticated read. Read acknowledgements also require a valid credential.

The Inbox tab and notification intent accept financial, approval or stock access
independently. Each returned entry still requires its own capability and current
branch membership; stock access never permits a daily or register financial
summary. The strict `stock_low` contract includes original observation times,
partial coverage, total/new low counts and at most twenty ordered item facts.
Contradictory counts, incomplete samples, unsafe quantities, false completeness,
extra private fields and invalid intervals are rejected. Historical observations
are not subjected to the live stock screen's freshness expiry.

Stock cards show newly low counts, branch-local observation time, coverage,
on-hand quantities, reorder levels and negative-stock guidance. Three sample
items appear initially, with an explicit expansion up to the server's twenty.
Details describe saved observations, not current inventory or a final balance.
All eighteen catalogues contain draft labels. Single-branch users see no branch
chooser. Existing native pull-to-refresh and a visible refresh button share the
same request path; pagination follows a cursor even when a page is empty. Failed
refreshes or read acknowledgements clear displayed entries until a new read.

Validation: 96 app tests, TypeScript and attribution checks pass. All 39 browser
flows passed, including two new 320px English/Arabic connected Inbox cases for
scope, hidden-page continuation, expanding details, read acknowledgement failure,
corrupt response clearing and refresh recovery. The final credential guard also
has a focused repeat of those two browser cases. Translations still need qualified
review. This is source work after Android preview 4; that APK is unchanged.
Delivery-time stock revalidation, push, retention cleanup, production scheduling
and physical-device validation remain release gates.

Android and iOS Hermes bundle exports passed for the stock Inbox source (about
12 MB each). Bundle export is not installed-device or production qualification.

Android preview 5 packaging checkpoint: versionCode 5 includes the scoped stock
Inbox source above and retains all preview 4 settings. Local release checks pass
96 app tests, 39 browser flows, TypeScript, attribution, formatting and web export.
The existing manual Android build and emulator smoke workflow will verify the
installable artifact before publication. Connected stock Inbox requires the
companion server capability and enabled feature flag; releasing this APK does
not deploy or enable backend services. Production and physical-device gates
remain open.
