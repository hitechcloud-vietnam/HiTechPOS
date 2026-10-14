# HiTechPOS Chủ cửa hàng (Business) – local changes

Owner/manager companion vendored from https://github.com/Posnic/posnic-business
(AGPL-3.0-only, see `LICENSE`), shipped as **HiTechPOS Chủ cửa hàng**.

## Changed

| Area                                                     | Before                                     | After                                                                                                                  |
| -------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Home-screen name                                         | `Posnic Business`                          | `HiTechPOS Chủ cửa hàng` (iOS `CFBundleDisplayName`, Android `app_name` via `plugins/withDisplayName.js`, web name)    |
| `expo.name` (also names native projects)                 | `Posnic Business` → Xcode `PosnicBusiness` | `HiTechPOS Business` → `HiTechPOSBusiness` (ASCII on purpose)                                                          |
| Expo slug / npm name                                     | `posnic-business`                          | `hitechpos-business`                                                                                                   |
| iOS bundle id / Android package                          | `com.posnic.business`                      | `vn.hitechpos.business` (also `scripts/build-ios.sh`, `android-*.py`, workflows, PIN-QA `vn.hitechpos.business.pinqa`) |
| Deep-link scheme                                         | `com.posnic.business`                      | `vn.hitechpos.business`                                                                                                |
| Cloud origin                                             | `https://www.posnic.com` (Posnic Cloud)    | `https://app.hitechpos.vn`, `src/config/hitechpos.ts`, override `EXPO_PUBLIC_HITECHPOS_CLOUD_ORIGIN`                   |
| Session vault accepted authorization origin              | `https://www.posnic.com`                   | `CLOUD_ORIGIN`                                                                                                         |
| UI strings (all 18 catalogs, Face ID texts, splash text) | Posnic Business / Posnic Cloud             | HiTechPOS Business / HiTechPOS Cloud                                                                                   |
| Device name sent at sign-in                              | `Posnic Business`                          | `HiTechPOS Business`                                                                                                   |

The server contract the cloud origin must implement is in
[`docs/HITECHPOS_SERVER_CONTRACT.md`](docs/HITECHPOS_SERVER_CONTRACT.md). Until
it exists, "Continue with HiTechPOS Cloud" says the server is not supported;
"Explore sample business" (offline sample data) and "own server"
(`https://<shop>.hitechpos.vn`, served by the Posnic shard) keep working.

### Kept on purpose

- Protocol literals `product`/`audience: "posnic-business"` (the shard sends them).
- Keychain services `com.posnic.business.*`, storage keys and env names
  `POSNIC_BUSINESS_*` / `POSNIC_IOS_BUILD_NUMBER` (internal, not user-visible).
- `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md` contacts and upstream history docs.

## Left to do

- **No Vietnamese catalog** (`src/i18n/` has 18 languages, no `vi`; English is the
  fallback in `src/i18n/index.ts`). Add a reviewed `vi.json`, register it in
  `definitions`/`bundledCatalogs`/`native-permissions.json`, then make it the default.
- **No About/licence screen**, so no in-app "dựa trên Posnic (AGPL-3.0)" line yet.
- **Artwork (replace with HiTechPOS artwork):** `assets/posnic-icon.png` (app icon);
  no splash image is configured.
- Build the cloud origin (contract doc) and patch the shard's consent page in
  `upstream/pos` that still links to `com.posnic.business://authorized`.
- Push: HiTechPOS EAS project id, FCM `google-services.json`, APNs keys.
- Release: Apple team/provisioning for `vn.hitechpos.business`, Play signing,
  store listings (Vietnamese name/description, screenshots, privacy policy).
  Android launchers may truncate the 22-character label.
