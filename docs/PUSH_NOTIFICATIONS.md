# Phone notifications

The native app supports optional Expo push registration. The web preview does not
register a phone. Permission is requested only after the user taps Enable phone
notifications; denial leaves the Inbox usable. Registration is bound to the
current Business session and refreshed after unlocking or provider-token changes.
Revoked sessions, expired credentials and removed branch/financial access stop
server delivery. The app never stores an account password for background work.

Alerts contain a generic update message and an opaque Inbox entry ID. They carry
no sales figures, account credentials, URLs or approval commands. Tapping an alert
opens the authenticated Inbox after any required unlock; it cannot approve an
action. An iOS permission prompt uses the privacy cover, while actual background
transitions still cancel registration and lock the account.

## Provider ownership

Posnic manages the push project and credentials for Posnic Cloud. Cloud shop owners only enable notifications; they do not configure a provider. Community owners may use their own project with a separately built app, or choose Posnic-managed delivery once the scoped Community relay is implemented. The relay is not available yet. Provider credentials must never be shared with Community servers.

## Deployment requirements

Build with `POSNIC_BUSINESS_EXPO_PROJECT_ID` set to the app publisher's EAS project UUID.
For Android, set `POSNIC_BUSINESS_GOOGLE_SERVICES_FILE` to the appropriate
`google-services.json` outside source control. Configure the project's FCM/APNs
credentials and enable Expo enhanced push security. Credentials belong to the
deployment operator's secret store; never put an Expo access token in the app.

The server uses `POSNIC_BUSINESS_PUSH_ENABLED=1`, the same
`POSNIC_BUSINESS_EXPO_PROJECT_ID` and a secret
`POSNIC_BUSINESS_EXPO_ACCESS_TOKEN`. Missing configuration leaves the durable
Inbox available and reports phone delivery unavailable. This adapter is for a
deployment that owns that Expo project. Do not distribute Posnic's project access
token to Community operators. Official-app Community delivery still needs a
scoped relay; a separately built Community app can use its own project.

Server delivery uses durable per-event/device records, bounded retries and
provider receipts. Stable collapse/tag identities reduce duplicate visible
alerts after ambiguous network failures; delivery is not exactly-once. Acceptance
by Expo or APNs/FCM is not proof that a user read the alert. Invalid registrations
are removed only when their registration generation still matches the failed
delivery. Financial details remain available through the authenticated Inbox.

## Verification still required

Local tests use a fake provider; no real notification has been sent. Native
JavaScript exports pass, but physical Android/iPhone permission, cold-start tap,
token rotation, background lock, focus/quiet modes and real provider-receipt
validation remain release gates. Signing accounts, project credentials and a
physical device have not been supplied in this workspace.

References: [Expo setup](https://docs.expo.dev/push-notifications/push-notifications-setup/),
[delivery and receipts](https://docs.expo.dev/push-notifications/sending-notifications/),
[native notification API](https://docs.expo.dev/versions/latest/sdk/notifications/).

## Approval-request delivery

Approval alerts have a separate account/branch opt-in and quiet-hours preference. The server materializes only new, pending, unexpired requests the recipient can review, excluding self-requests and discounts above the current limit. It repeats authorization, preference, session and expiry checks before every send/retry. Requests that would expire during quiet hours are not sent afterward. Daily-summary failures do not block the approval stage.

The phone negotiates support before reading settings. The Inbox request opts into `approval_requested` events, whose strict payload adds only `requestId` and `requestExpiresAt` to the generic entry fields. Opening Review request uses the existing live decision reader and password-confirmation flow. Provider payloads remain generic and contain no decision action. Actual APNs/FCM and physical-device validation remain pending.

## Register-close schedule client foundation

The schedule service negotiates `registerSessions=1` and requires the reporting,
Inbox and schedule capability versions before enabling the version-2 contract.
An older Community server retains the exact legacy daily GET/POST shape. Close
mode cannot be saved through that fallback. Responses are checked against current
branch permissions and timezone; saves bind the observed revision and require a
matching acknowledgement of the intended settings. Unknown versions, malformed
quiet hours and changed scope fail without claiming a save.

This service is not yet wired into the notification settings screen. Register
Inbox validation/rendering, translations and mobile interaction tests remain next.
The published Android preview is unchanged. Local verification passes all 74 app
tests, TypeScript, attribution and targeted formatting.

The register Inbox validator now checks exact versioned fields, branch/financial
and notification scope, close timing and branch-local day, the SHA-256 source
fingerprint, currency precision, safe integer reconciliation and explicitly
incomplete freshness. Overnight sessions and net refunds are supported. Embedded
entry metadata must match the summary's close. The client still does not request
register Inbox entries until their rendering and labels are implemented. All 77
app tests, TypeScript, attribution, targeted formatting and web export pass.

## Register-close controls and Inbox

Notification settings now use the negotiated schedule service. Supported servers
show mutually exclusive daily/register-close radio options; close mode hides the
fixed time input and explains the per-register scope. Unsupported Community
servers retain daily controls. Saved acknowledgements clear when another edit
makes the form dirty. Existing unsaved-change navigation protection remains.

Inbox opts into register entries only for accounts with notification-management
permission. Entries name the register, show the session bounds in the branch
timezone, and distinguish unavailable totals without sending users to an
unrelated daily total. Four new messages are present in all 18 development
catalogs; qualified translation review remains required. All 77 app tests and 33
browser flows pass, including connected close-mode saving, narrow-screen layout
and register Inbox rendering. TypeScript, formatting, attribution and web export
pass. The narrow settings and Inbox screenshots were inspected. Physical-device
close notifications and a new installable build remain unqualified.

Native bundle checkpoint: Android and iOS Hermes exports pass for the close-summary UI (approximately 12 MB each). This verifies packaging, not physical-device push or production signing.
