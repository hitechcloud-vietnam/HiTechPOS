#!/usr/bin/env bash
set -euo pipefail
test -n "${IOS_CERT_P12:?Signing certificate is required}"
test -n "${IOS_CERT_PASSWORD:?Certificate password is required}"
test -n "${IOS_APPSTORE_PROVISIONING_PROFILE:?App Store profile is required}"
test -n "${IOS_TEAM_ID:?HiTechPOS Apple team ID is required}"
export IOS_TEAM_ID
BUNDLE_ID=vn.hitechpos.mobile
KEYCHAIN="$RUNNER_TEMP/hitechpos-mobile.keychain-db"
KEYCHAIN_PASSWORD=$(uuidgen)
PROFILE="$HOME/Library/MobileDevice/Provisioning Profiles/hitechpos-mobile.mobileprovision"
cleanup() {
  security delete-keychain "$KEYCHAIN" 2>/dev/null || true
  rm -f "$RUNNER_TEMP/mobile-cert.p12" "$PROFILE" "$RUNNER_TEMP/mobile-profile.plist"
}
trap cleanup EXIT
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 3600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
printf '%s' "$IOS_CERT_P12" | base64 -D > "$RUNNER_TEMP/mobile-cert.p12"
security import "$RUNNER_TEMP/mobile-cert.p12" -k "$KEYCHAIN" -P "$IOS_CERT_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security list-keychains -d user -s "$KEYCHAIN" login.keychain-db
mkdir -p "$(dirname "$PROFILE")" artifacts/ios-release
printf '%s' "$IOS_APPSTORE_PROVISIONING_PROFILE" | base64 -D > "$PROFILE"
security cms -D -i "$PROFILE" > "$RUNNER_TEMP/mobile-profile.plist"
test "$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$RUNNER_TEMP/mobile-profile.plist")" = "$IOS_TEAM_ID.$BUNDLE_ID"
export IOS_PROFILE_NAME
IOS_PROFILE_NAME=$(/usr/libexec/PlistBuddy -c 'Print :Name' "$RUNNER_TEMP/mobile-profile.plist")
ruby <<'RUBY'
require 'xcodeproj'
project = Xcodeproj::Project.open('ios/HiTechPOS.xcodeproj')
project.targets.select { |target| target.product_type == 'com.apple.product-type.application' }.each do |target|
  target.build_configurations.each do |config|
    config.build_settings['CODE_SIGN_STYLE'] = 'Manual'
    config.build_settings['DEVELOPMENT_TEAM'] = ENV.fetch('IOS_TEAM_ID')
    config.build_settings['CODE_SIGN_IDENTITY'] = 'iPhone Distribution'
    config.build_settings['PROVISIONING_PROFILE_SPECIFIER'] = ENV.fetch('IOS_PROFILE_NAME')
  end
end
project.save
RUBY
python3 <<'PY'
import os, plistlib
options = {'method': 'app-store-connect', 'teamID': os.environ['IOS_TEAM_ID'], 'signingStyle': 'manual',
           'provisioningProfiles': {'vn.hitechpos.mobile': os.environ['IOS_PROFILE_NAME']},
           'manageAppVersionAndBuildNumber': False, 'uploadSymbols': True}
with open('artifacts/ios-release/ExportOptions.plist', 'wb') as f:
    plistlib.dump(options, f)
PY
xcodebuild -workspace ios/HiTechPOS.xcworkspace -scheme HiTechPOS -configuration Release -destination 'generic/platform=iOS' -archivePath "$RUNNER_TEMP/HiTechPOS.xcarchive" archive
xcodebuild -exportArchive -archivePath "$RUNNER_TEMP/HiTechPOS.xcarchive" -exportOptionsPlist artifacts/ios-release/ExportOptions.plist -exportPath artifacts/ios-release
test -f artifacts/ios-release/HiTechPOS.ipa
