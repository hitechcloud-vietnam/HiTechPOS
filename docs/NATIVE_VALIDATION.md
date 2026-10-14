# Native validation

Run checks locally and batch changes before pushing. Do not add paid/hosted build jobs or broaden Actions triggers without an explicit request.

## Android

The manually dispatched **Android test build** workflow builds a standalone APK with bundled JavaScript and assets for ARM64 phones and x86-64 emulators. It uses the generated development signing key and is for controlled testing, not store submission. Download `posnic-business-android-test` from the selected successful run. Its checksum, signing certificate, package metadata and exact source commit accompany the APK. Supplying that run's ID as `test_build_run` runs an install/launch/sample/resume smoke check on an Android 15 emulator without a development server.

For a published preview APK, open the download on an Android device and allow installation from the downloading app when prompted. Use **Explore sample business** for an immediate walkthrough. Connected accounts require the companion server changes; this build does not configure push-provider credentials. A previously installed APK signed with a different key cannot be updated in place; removing it also removes its local session data. Android 32-bit-only devices are not included in this test build.

Install Node 22+, Java 21 and an Android SDK accessible to your account. Set `ANDROID_HOME` to that SDK. Then:

```sh
npm ci
npx expo prebuild --no-install --platform android
cd android
./gradlew assembleDebug --no-daemon
```

On Windows use `gradlew.bat assembleDebug --no-daemon`. The APK is under `android/app/build/outputs/apk/debug/`. Generated native folders are ignored by Git. On this workstation `C:\Android\adb.exe` is available, but `adb devices -l` reports no connected devices. The earlier configured SDK was inaccessible; no successful local native compilation is recorded. Preview 7 was compiled and smoke-tested by the existing hosted workflow.

## iOS simulator

On macOS with Xcode and CocoaPods:

```sh
npm ci
npx expo prebuild --no-install --platform ios
cd ios
pod install
xcodebuild -workspace PosnicBusiness.xcworkspace -scheme PosnicBusiness -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
```

The simulator bundle is under `ios/build/Build/Products/Debug-iphonesimulator/`. Real-device distribution needs the owner's signing account and provisioning. No store release is implied by an unsigned simulator build.

## Device gates

- Cloud and Community test accounts; expired/denied consent, no network, timeout, host substitution and HTTPS redirect refusal.
- PIN enrollment, process restart, five-attempt exhaustion, backgrounding during derivation, sign-out and local storage failure.
- Strong Face ID/fingerprint opt-in, cancellation, changed enrollment, device passcode removal, PIN fallback and backgrounding during the OS prompt. Test physical devices: simulators do not prove keychain biometric enforcement.
- Privacy cover in app switching, foreground lock, server-revoked credentials, removed branch/ACL and account changes.
- VoiceOver/TalkBack, large text, reduced motion, one-handed navigation, low-memory devices, dark mode and Arabic RTL.
- Signed Android/iOS builds, privacy disclosures, pilot reconciliation and rollback before production publication.

Prior build evidence: GitHub run 36376341281 compiled the earlier authorization commit successfully for Android debug and iOS simulator. It predates subsequent Cloud/biometric work and is not final release evidence.

Native navigation/privacy qualification: check app-switcher snapshots while a branch modal, schedule discard dialog, keyboard and biometric prompt are visible. iOS adds an opaque native cover directly to the application window on resign-active/background, above native modal content, in addition to account background locking. It removes the cover on becoming active. Native modal coverage and rapid app switching must still be verified on device. Android 13+ disables Recents screenshots at the Activity level while preserving ordinary user screenshots. Earlier Android versions rely on the existing privacy cover and lock and require separate snapshot testing. These protections are implemented, not device-qualified.

## Android permission boundary

The app blocks `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE` and
`SYSTEM_ALERT_WINDOW` through Expo's Android manifest merger configuration.
The Business app has no shared-storage browsing or overlay feature. Network,
notifications and optional biometric unlock retain their required permissions.
The existing APK packaging check rejects those three permissions in `aapt`
badging output, including any that a dependency attempts to add later.

Preview 6 includes these removals. Build `36557212230` verified the merged APK
contains none of the three permissions and retains network/biometric declarations.
Android 15 smoke run `36558301683` passed fresh installation, sample navigation
and background/resume. Its signing certificate matches preview 5 and versionCode
increased to 6. An in-place upgrade, connected account and physical-device
qualification still require testing; the older preview 5 APK is unchanged.

## Android notification category qualification

Current source negotiates separate Approvals, Business summaries and Stock alerts
channels with the server. Legacy servers/builds retain the shared Phone
notifications channel. Native channels must all be created successfully before
the device advertises version 2. Creation inherits legacy importance; renaming for
a language change preserves per-category user overrides. The new summary-channel
label has draft translations in all eighteen catalogs.

These changes are included in preview 7, whose Android 15 sample smoke test passed.
Device qualification must still verify upgrade from a muted legacy channel, independent category
mute/unmute, language changes, server downgrade and token rotation on a physical
Android device. Check that a category never becomes audible solely because the
app updated. Check global OS permission denial and iOS behavior separately.

The checked-in app configuration has no owner EAS project UUID. Real push testing
needs the owner's public project identity and securely configured FCM/APNs
credentials, plus matching server provider configuration. No UUID or signing
identity is invented for a release. Permission denial and unavailable provider
configuration must continue to leave authenticated Inbox access usable.

## Notification tap and privacy-lock ordering

Background privacy locking retains only a pending generic Inbox destination.
Credentials, account data, PIN input and in-flight authenticated work are still
cleared/cancelled. Unlock must fetch fresh account/branch permissions before the
navigation layer can consume the hint. Access loss and sign-out discard it.
The native response listener rejects non-default actions and extra URL/token or
decision fields, ignores responses after disposal, and contains native last-
response read/clear failures. A notification is never approval authority.

Three adapter-level response tests cover cold/live responses, late responses after
cleanup, and native API failures. The full app suite passes 102 cases. They do not
simulate the physical OS event order: verify a tap before and after background
locking, a cold launch, failed PIN/biometric unlock, access removal, sign-out during
resume and app termination before unlock on Android/iOS. No business details may
appear before authentication, and a successfully unlocked permitted account should
open Inbox rather than silently dropping the pending navigation request.
