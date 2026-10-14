# Captain test delivery — 26 September 2026

The latest resilience follow-up supersedes the Android/Windows builds below. See [resilience delivery and acceptance guide](CAPTAIN_RESILIENCE.md): Android `Captain-1.2.37-resilience-test.apk` and Windows `Posnic-1.8.0-captain-resilience-test-win-x64.zip`. Earlier validation below describes the original access/discovery delivery.

## Installable artifacts

- Android: `C:/Users/Kayal/captain-onboarding/test-builds/captain-access/Captain-1.2.36-discovery-test.apk` — updated discovery test build, Android version code 10236, using the existing Captain release signing configuration. Release build and APK signature verification passed.
- Windows: `C:/Users/Kayal/POS/.worktrees/pos-captain-access/test-builds/captain-access/Posnic-1.8.0-captain-access-test-win-x64.zip` — extract the complete archive, then run `Posnic.exe`. This is an unsigned test package, not an installer or published release. Keep the accompanying resources together.
- Extracted Windows package: `C:/Users/Kayal/POS/.worktrees/pos-captain-access/test-builds/captain-access/win-unpacked`.

Use a test shop. For an isolated desktop profile, launch the extracted executable with `--user-data-dir=C:\Users\Kayal\AppData\Local\PosnicCaptainAccessTest`. The normal test-profile setup still needs a shop and permitted staff. Do not reuse or modify a live shop database for this test.

See [the setup and phone test guide](CAPTAIN_ACCESS.md) for the manager and waiter steps, credential lifetimes, recovery behavior and service rollout order.

## Validation actually performed

Discovery follow-up: saved local addresses (including custom ports) are checked before the subnet scan. Native Wi-Fi IP guides the scan order, excluding the phone itself and including host `.1`. Duplicate results are suppressed. Cancelling or selecting a till prevents late results from replacing the status, and selecting/editing an address clears the old manager confirmation. Native Wi-Fi lookup has a three-second limit; discovery after lookup has a twenty-second limit. Unreachable and refused addresses no longer incorrectly report that an API update is required.

Follow-up validation: 532 Node tests and 89 discovery/onboarding browser tests passed. New coverage includes custom-port discovery, hung native lookup, cancellation, late results, scan deadline and host ordering. Discovery still scans port 5555 for previously unknown tills; use QR or an explicit address for an unknown custom port. This does not add automatic local/cloud failover. Physical phone/router testing remains required.

| Check | Result |
| --- | --- |
| Captain Node unit suite | 529 passed, including secure-vault migration, concurrent/lost-response renewal, revocation, PIN/offline unlock, sign-out race, queue persistence/storage failure and iOS legacy compatibility |
| Initial full Captain Playwright suite | 345 passed; 7 failures investigated: 5 expectations of the replaced onboarding UI and 2 intermittent gesture/voice failures |
| Discovery/login/onboarding/voice recheck after fixes | 120 passed; updated first-run expectations and the voice failure passed |
| Scroll regression recheck | All 5 tests passed, including the initial gesture failure |
| Final dedicated onboarding browser suite | 9 passed, including approved cloud polling through pairing and the PIN step |
| POS Captain integration suite | 10 passed, including real HTTP pairing, tenant/branch scope, no unscoped cookie issuance, expiry/replay, revocation and manager QR generation in a real browser with cookie/CSRF authentication |
| Existing Mobile POS API regression | 10 passed; 5 optional full-app/UI cases were skipped because their opt-in environments were not configured |
| POS authentication, tenant and handset Jest regression | 58 passed |
| Account authorization tests | 17 passed |
| Gateway device/enrolment/grant tests | 8 passed |
| Captain Vite production build | Passed |
| Android Java/Gradle release build and APK signature | Passed with Java 21 |
| Windows build and dependency loading | Passed; packaged Electron updater, MongoDB, serial port and unzip modules load; packaged Captain API/auth files match source |
| POS packaged-module check | 60 local modules checked, passed |
| API lint | No errors; one existing unused `tokenService` warning in auth middleware |
| Attribution and whitespace checks | Passed |

The initial full browser run was not relabelled as a clean full run. Its failing areas were rerun as shown above. No unresolved failure remains in those targeted checks. The cloud browser and phone tests use test fixtures; the POS manager-page test uses a real temporary MongoDB/API.

## Not deployed or device-verified

No changes were merged, pushed, published or deployed. The live account capability endpoint returned HTTP 404 on 26 September. The APK detects that and explains that cloud approval is unavailable; local Community pairing works against the matching new API without a cloud account.

No physical Android device was connected. The emulator initially appeared offline and was absent on the final ADB check. Camera scanning, Android Keystore/PIN persistence across a real app restart, and the system-browser return still require the phone steps in the guide. Native code compiled successfully; browser/native-vault fixtures do not substitute for those hardware checks. The Windows package was checked for contents and module loading; its full interactive shop startup was not run.

## Source and evidence

Original dirty workspaces were preserved. In particular, `C:/Users/Kayal/captain/tests/a-refusal-is-not-a-missing-till.test.js` remains untouched. Work is isolated in these branches/checkouts:

| Repository | Branch | Checkout |
| --- | --- | --- |
| Captain | `codex/captain-remembered-access` | `C:/Users/Kayal/captain-onboarding` |
| POS | `codex/captain-session-api` | `C:/Users/Kayal/POS/.worktrees/pos-captain-access` |
| Account API | `codex/captain-account-approval` | `C:/Users/Kayal/captain-account-api` |
| Gateway | `codex/captain-enrolment` | `C:/Users/Kayal/captain-gateway` |

Captain test/build logs are `onboarding-*.log` in its checkout. Screenshots are in `test-artifacts`. POS logs and the manager-page screenshot are in `test-builds/captain-access/evidence`. Cloud and Gateway logs are in their respective checkouts. These are test artifacts, not production records.
