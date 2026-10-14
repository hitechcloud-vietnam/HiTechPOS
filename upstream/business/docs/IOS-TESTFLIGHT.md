# iPhone test builds

The manual `Native test build` workflow builds Android by default. Select
`platform: ios` and a new positive `ios_build_number` to build and upload an iPhone
archive. Use the reviewed branch or commit containing the intended changes.

The iOS job runs on a GitHub macOS runner. It generates the native Expo project,
installs CocoaPods, imports the company distribution certificate into a temporary
keychain, and signs with the Business-specific App Store profile. It does not
require an Expo account or publish the app to the public App Store.

## App identity and signing

- Bundle ID: `com.posnic.business`
- App Store Connect app ID: `6818860502`
- Internal group: `Posnic Business Internal Testers`
- Signing profile: `Posnic Business TestFlight`

Required repository secrets:

| Secret                              | Contents                                                      |
| ----------------------------------- | ------------------------------------------------------------- |
| `IOS_CERT_P12`                      | Base64 company Apple Distribution certificate and private key |
| `IOS_CERT_PASSWORD`                 | Password for that P12                                         |
| `IOS_APPSTORE_PROVISIONING_PROFILE` | Base64 App Store profile for the Business bundle ID           |
| `IOS_TEAM_ID`                       | Apple Developer team ID                                       |
| `ASC_API_KEY_ID`                    | Existing App Store Connect API key ID                         |
| `ASC_API_ISSUER`                    | API issuer ID                                                 |
| `ASC_API_KEY_P8`                    | API private key in PEM format                                 |

Never commit signing files. The build checks the profile's application identifier
before signing and deletes its temporary keychain and profile on completion.
Captain's app-specific provisioning profile cannot be used for Business.

## Verification and distribution

1. Confirm the workflow checks, archive, export, and Apple upload succeed.
2. Wait for Apple processing to complete successfully in TestFlight.
3. Complete the encryption questionnaire for the actual build and distribution
   scope, then assign the build to the internal group.
4. Verify the tester has an available build and an invitation status in Apple.
5. On an iPhone, verify launch, sample business, PIN unlock, background privacy,
   Face ID, language switching, and supported-server authentication.

The artifact includes the IPA, source commit, and SHA-256 checksum. An uploaded
archive is not evidence that an iPhone installation or live-server test passed.

## Encryption and notifications

Business uses HTTPS and Apple Keychain, plus standard AES-GCM and scrypt from the
Noble libraries to protect remembered authentication credentials. Do not answer
the questionnaire as though all cryptography is provided by Apple's operating
system, or automatically declare non-exempt encryption absent. Revisit export
documentation before changing distribution countries or cryptography.

The Business App ID and signing profile support push notifications. Provider
configuration and end-to-end delivery are separate from successful native
signing: Cloud uses Posnic's provider; Community uses its owner's provider setup.
