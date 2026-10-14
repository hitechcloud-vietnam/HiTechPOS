# HiTechPOS (Mobile POS) – local changes

Offline-first mobile till vendored from https://github.com/Posnic/Mobile-App
(AGPL-3.0-only, see `LICENSE`), shipped as **HiTechPOS**.

## Changed

| Area | Before | After |
|---|---|---|
| Display name (`expo.name`, web name) | `Posnic POS` | `HiTechPOS` |
| Expo slug / npm name | `posnic-mobile` | `hitechpos-mobile` |
| iOS bundle id / Android package | `com.posnic.mobile` | `vn.hitechpos.mobile` |
| Deep-link scheme / auth return URL | `com.posnic.mobile://authorized` | `vn.hitechpos.mobile://authorized` (`app.json`, `src/services/browserAuthorization.ts`) |
| Apple team | `appleTeamId: VMG89YGXKR` (Posnic's) | removed; `scripts/build-ios-testflight.sh` now requires `IOS_TEAM_ID` |
| Xcode project (from expo.name) | `PosnicPOS` | `HiTechPOS` (build script, TestFlight workflow, IPA name) |
| Shop code → address | `https://<code>.posnic.io/api` | `https://<code>.hitechpos.vn/api` (`CLOUD_SUFFIX`) |
| Account approval service | `https://www.posnic.com` | `https://app.hitechpos.vn` (`ACCOUNT_ORIGIN`) |
| Device name / model sent to servers | `Posnic Mobile POS` | `HiTechPOS Mobile` |
| UI strings (`src/i18n/*.json`, server labels in `App.tsx`, logo label) | Posnic, Posnic Cloud (incl. hi/ml/kn/te/ne transliterations) | HiTechPOS, HiTechPOS Cloud |
| iOS local-network prompt | "…Posnic till…" | "…HiTechPOS till…" |
| Product scanner | rejected `posnic:` links | also rejects `hitechpos:` and `vn.hitechpos.*:` links |

Both cloud constants live in `src/config/hitechpos.ts` and can be overridden at
bundle time with `EXPO_PUBLIC_HITECHPOS_CLOUD_SUFFIX` and
`EXPO_PUBLIC_HITECHPOS_ACCOUNT_ORIGIN` (validated; test `tests/hitechposConfig.test.ts`).

### Kept on purpose

- Internal names: `PosnicApi`, native modules `modules/posnic-*` (Kotlin packages
  `com.posnic.printer`/`com.posnic.recognition`, `PosnicSecurity`), storage keys,
  `POSNIC-DEMO-*` training barcodes. Not user-visible; renaming storage keys would
  wipe devices.
- `LICENSE`, upstream docs and mockups under `docs/`.

## Left to do

- **No Vietnamese catalog.** The app picks the device language among its bundled
  catalogs (`src/i18n/imported.json` + `mobile.json`, no `vi`) and falls back to
  English. A real Vietnamese translation of `src/i18n/en.json` (348 keys) is needed
  before `vi` can be added and made the default (`detectLocale` in
  `src/i18n/index.ts`, `Locale` in `src/domain/types.ts`).
- **No About/licence screen** exists, so no in-app "dựa trên Posnic (AGPL-3.0)"
  line was added; add one together with the source-offer link when a settings
  "About" entry is built.
- **Privacy policy:** More → "Privacy policy" / "Account deletion" open
  `github.com/Posnic/Mobile-App/.../PRIVACY.md` (Posnic Innovations' policy,
  `docs/PRIVACY.md`). Replace with HiTechPOS's own policy URL before store release.
- **Artwork (replace with HiTechPOS artwork):** `assets/icon.png`,
  `assets/adaptive-icon.png` (+ background `#2969AD` in `app.json`),
  `assets/app-mark.svg`, `assets/posnic.svg`, and the inline Posnic wordmark in
  `src/components/Brand.tsx`.
- `app.hitechpos.vn/api/mobile/*` (cloud sign-in) does not exist yet; see
  `upstream/business/docs/HITECHPOS_SERVER_CONTRACT.md` §5. LAN and shop-address
  sign-in work.
- Release: Apple app record + team (`IOS_TEAM_ID` secret) and provisioning for
  `vn.hitechpos.mobile`, Play Console app + upload key (`scripts/play-signing.gradle`),
  store listings.
