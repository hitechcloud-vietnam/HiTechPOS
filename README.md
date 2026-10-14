# Posnic Business

**[Download the latest build](https://github.com/Posnic/posnic-business/releases)** — Android APK. Open the newest release and download its `.apk` under **Assets**. Preview builds are for testing.

An owner and manager companion for Android and iOS. See daily performance, understand useful exceptions, and eventually review important business decisions away from the shop.

**Status: development build, not a production release.** Version 0.1.0 includes a clearly labelled synthetic sample business and separate real-account authorization screens. Cloud/Community browser sign-in, encrypted PIN storage, optional biometric unlock and connected-device removal are implemented for development testing with companion server changes. Server rollout, live reporting, push delivery, financial approvals and device qualification remain in progress. Use controlled test accounts for this preview. The existing Mobile POS and Captain apps retain their own selling and service workflows.

## Android test download

[Download the latest build](https://github.com/Posnic/posnic-business/releases) for ARM64 Android 7.0+ (also x86-64 emulators). Open the newest release and select its `.apk` under **Assets**. No development server is needed. These are development-signed test builds; read the release notes for validation, connected-server requirements and remaining qualification.

## Run locally

Use Node.js 22.13 or newer and npm.

```sh
npm ci
npm start
```

Use `npm run android` or `npm run ios` with the corresponding native development tools. iOS compilation requires macOS/Xcode. For a browser development preview:

```sh
npm run web
```

Choose **Explore sample business**. Under **More**, switch the sample access profile or connection state. This control is a development scenario selector, not a production role-switching feature.

## Implemented foundation

- Shared React Native/Expo application for Android, iOS and web preview, light/dark appearance and safe-area layout.
- Today, Insights, Inbox and More, with capability-based visibility and unavailable states.
- A branch chooser only when more than one branch is accessible; automatic single-branch scope and no data for zero access.
- Typed/versioned overview contract and validation for tenant/scope mismatch, unsafe money values, mixed currencies and invalid freshness claims.
- Integer minor-unit formatting and a bounded synthetic read adapter, without heavy queries or customer data.
- Native navigation stacks, pull-to-refresh, explicit Refresh, accessible record navigation, interior swipes and Android back-button handling.
- 18 language packs, RTL layout and offline localized number/date formatting. Qualified language and physical-device review remain outstanding.
- Credential-free Cloud/Community compatibility checks with cancellation and safe error states; a tested, separate reporting transport foundation. See the [client connection draft](docs/CONNECTION_PROTOCOL.md) for server and native requirements before live sign-in.

Read [implementation status](docs/IMPLEMENTATION_STATUS.md), [roadmap](docs/ROADMAP.md), [initial compatibility audit](docs/FOUNDATION_AUDIT.md), [language scope](docs/LANGUAGES.md), and [interaction rules](docs/INTERACTIONS.md).

## Verify

```sh
npm run check
npm run format:check
npm run build:web
npx playwright install chromium
npm run test:e2e
```

The browser checks run against the static export on loopback. Synthetic reconciliation tests verify the fixture contract, not reconciliation with production POS records. Android/iOS builds and device validation remain separate release gates.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Posnic credits human contributors only. The app source is public under [AGPL-3.0-only](LICENSE); infrastructure credentials and customer data never belong in this repository.
