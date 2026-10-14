# Posnic Mobile POS

**[Download the latest Android build](https://github.com/Posnic/Mobile-App/releases)** — open the newest release and download its `.apk` under **Assets**. Beta builds are included.

A dedicated mobile till for Posnic, built with React Native, Expo and TypeScript.
This is an **independent offline counter beta for pilot testing**.
Start with **Try a training shop**. Practice transactions stay
on the device and are never uploaded.

## Run

Requires Node.js 22+, npm and, for Android, a configured Android SDK and JDK.

```sh
npm ci
npm run build:web
node scripts/serve-preview.mjs
```

The browser preview uses IndexedDB and is for UX evaluation. Native builds use
SQLCipher SQLite with a key in the OS secure store. **Expo Go is not supported**
because its SQLite build does not provide this encryption setup.

```sh
npx expo prebuild --platform android
npm run android
```

iOS uses the same source but requires macOS/Xcode and device testing. Native
project directories are generated from app.json and are not committed.
Do not uninstall or clear storage on a device with unsynced sales.

## Connection setup and switching

Cloud sign-in opens the account browser for approval and returns directly to Sell.
A PIN is optional. Community shops can use Wi-Fi discovery, a shop QR code, a
pairing code with a server address, or a typed server address. Login fields appear
only after selecting a compatible server.

Tap the Wi-Fi/globe icon beside the shop name to choose **Shop Wi-Fi** or
**Internet**. Authenticate once for each endpoint; subsequent switches reuse that
endpoint's own saved session. The destination must identify the same shop,
branch and cashier. Expired sessions require authorization again. LAN discovery
requires shop Wi-Fi; if the phone hosts a hotspot, use the till QR/address.

Switching between independent till/cloud ledgers requires all pending sales and
print requests to be resolved and current/parked baskets to be finished or cleared.
Receipts remain associated with the endpoint that accepted them; switching back
restores its history. Stock drafts remain scoped to their original endpoint.
The app does not silently move queued sales to a different ledger. Updating an
unreachable till address with pending sales requires server identity and shared
idempotency support; do not uninstall or clear app storage to work around it.

## Implemented

- Persistent cashier/branch favourites with compact star controls.
- Visual item tiles, hidden numeric quick codes, camera scanning and amount-only sales.
- Integer-money checkout, cash received/change, optional customer, held carts and receipts.
- Transactional sale/outbox commits, retry identifiers, pinned shop/branch, review state
  and atomic catalogue snapshot replacement. Existing carts retain price snapshots.
- Permissions and offline grant expiry.
- Branch UPI account selection and amount-bound QR generation. Manual confirmation
  stays explicitly staff-confirmed; it never implies bank verification.
- Direct Android Bluetooth Classic/USB printer-class ESC/POS, optional printer-connected
  cash drawer, durable print recovery, OS print service and Till receipt status.
- Indexed offline product browsing/scanning, atomic persisted-page activation, cached
  product images and protected receipt retention. Items have no receipt-history cap.
- Explicit quantity entry for configured weighed items, localized decimals and receipt units.
- Cloud receipt status backed by an explicit gateway acknowledgment; community installs
  retain shop-server acknowledgment.
- All 18 POS languages with complete mobile message coverage, Arabic direction,
  localized receipts and offline language packs. Translations remain beta pending
  native-speaker review; shop-entered product names are preserved.
- Isolated training shop for evaluation without a server.
- Pull-to-refresh on data lists, receipt swipe navigation, platform back handling,
  keyboard dismissal and accessible button alternatives. See the
  [gesture inventory and device checks](docs/MOBILE_GESTURES.md).
- Account-first browser sign-in and free-trial signup, explicit device approval,
  authenticated local-till discovery, Community LAN/QR/code fallback and PIN unlock.

## Release work still required

The matching POS API implements bootstrap, one-use pairing, durable sale ingestion,
branch payments, device revocation and till receipt jobs. Live onboarding requires
features.mobilePosV1; a legacy server must be updated. Account sign-in also requires
the matching web-api, Gateway and website release. See the release notes for deployment status.

See [implementation status](docs/IMPLEMENTATION_STATUS.md) and the required
[server contract](docs/MOBILE_API.md). The [offline test guide](docs/OFFLINE_DIRECT_PRINT_BETA.md)
maps all nine approved offline designs to implemented screens. Provider-confirmed UPI/card
payments, iOS direct adapters, richer selling options and physical hardware qualification
remain separate roadmap work. All language packs have every current
mobile key; native-speaker review and physical-device font checks remain outstanding.
See [language support](docs/LANGUAGES.md).

## iPhone and iPad TestFlight builds

Run the manually dispatched **iOS TestFlight** workflow in GitHub Actions. It runs
the checks, generates the Expo iOS project on a Mac runner, signs an App Store
archive and uploads it to Apple. It does not publish to the public App Store.

The Apple app is `6818860892`, bundle `com.posnic.mobile`, team `VMG89YGXKR`.
The pilot tester group is **Posnic POS Pilot**. After Apple finishes processing,
resolve any export-compliance questions, assign the processed build to that group
and verify that the tester is invited. An uploaded build alone is not confirmation
that testers can install it.

Required repository secrets: `IOS_CERT_P12` (base64), `IOS_CERT_PASSWORD`,
`IOS_APPSTORE_PROVISIONING_PROFILE` (base64, specifically for `com.posnic.mobile`),
`ASC_API_KEY_ID`, `ASC_API_ISSUER` and `ASC_API_KEY_P8`. Signing files stay outside
the repository; the temporary Mac keychain and API-key file are cleaned after use.
The workflow uses a unique numeric build number for each run/attempt. The separate
numeric `ios.version` must be updated when releasing a new iOS marketing version.

The iOS build uses the system print dialog and configured Till printing; the direct
Bluetooth Classic/USB ESC/POS adapter is Android-only. Validate local-network
permission, camera scanning, offline catalogue/sales, PIN and receipts on an iPhone
before treating an uploaded build as production-ready.

## Checks

```sh
npm run check
npm run format:check
npm run build:web
npx playwright install chromium
npm run test:e2e
```

Tests cover transaction failure/retry, money, tax, permissions, catalogue replacement,
receipt escaping, persisted checkout, offline cash, hidden codes, hold/resume and
language changes. Native storage, printer and terminal tests must run on devices.

See the [research and roadmap](docs/MOBILE_POS_ROADMAP.md) for the approved direction.
See [Devices](docs/DEVICES.md) for external scanning, printer setup and Till receipt status.
See [connection and PIN unlock](docs/CONNECTION_AND_PIN.md) for Wi-Fi discovery,
remembered credentials, supported addresses and local PIN behavior.

Licensed under [AGPL-3.0-only](LICENSE). Inherited language strings come from Posnic
POS under the same license.
