#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${IOS_CERT_P12:?Missing distribution certificate}"
: "${IOS_CERT_PASSWORD:?Missing certificate password}"
: "${IOS_APPSTORE_PROVISIONING_PROFILE:?Missing Business provisioning profile}"
: "${IOS_TEAM_ID:?Missing Apple team}"
signing_dir="$(mktemp -d)"
keychain="$signing_dir/business.keychain-db"
profile_path=""
cleanup() {
  security delete-keychain "$keychain" 2>/dev/null || true
  if [[ -n "$profile_path" ]]; then rm -f "$profile_path"; fi
  rm -rf "$signing_dir"
}
trap cleanup EXIT
export SIGNING_DIR="$signing_dir"
python3 - <<'PY'
import os, base64, pathlib
p = pathlib.Path(os.environ['SIGNING_DIR'])
(p/'distribution.p12').write_bytes(base64.b64decode(os.environ['IOS_CERT_P12']))
(p/'profile.mobileprovision').write_bytes(base64.b64decode(os.environ['IOS_APPSTORE_PROVISIONING_PROFILE']))
PY
security cms -D -i "$signing_dir/profile.mobileprovision" > "$signing_dir/profile.plist"
profile_uuid=$(/usr/libexec/PlistBuddy -c 'Print UUID' "$signing_dir/profile.plist")
app_id=$(/usr/libexec/PlistBuddy -c 'Print Entitlements:application-identifier' "$signing_dir/profile.plist")
[[ "$app_id" == "$IOS_TEAM_ID.com.posnic.business" ]] || { echo 'Wrong app provisioning profile'; exit 1; }
mkdir -p "$HOME/Library/MobileDevice/Provisioning Profiles"
profile_path="$HOME/Library/MobileDevice/Provisioning Profiles/$profile_uuid.mobileprovision"
cp "$signing_dir/profile.mobileprovision" "$profile_path"
keychain_password="$(openssl rand -hex 24)"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 7200 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$signing_dir/distribution.p12" -k "$keychain" -P "$IOS_CERT_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
security list-keychains -d user -s "$keychain" "$HOME/Library/Keychains/login.keychain-db"
export BUSINESS_PROFILE_UUID="$profile_uuid"
ruby - <<'RUBY'
require 'xcodeproj'
project = Xcodeproj::Project.open('ios/PosnicBusiness.xcodeproj')
project.targets.each do |target|
  next unless target.product_type == 'com.apple.product-type.application'
  target.build_configurations.each do |config|
    config.build_settings['CODE_SIGN_STYLE'] = 'Manual'
    config.build_settings['DEVELOPMENT_TEAM'] = ENV.fetch('IOS_TEAM_ID')
    config.build_settings['CODE_SIGN_IDENTITY'] = 'Apple Distribution'
    config.build_settings['PROVISIONING_PROFILE_SPECIFIER'] = ENV.fetch('BUSINESS_PROFILE_UUID')
  end
end
project.save
RUBY
mkdir -p build-output
python3 - <<'PY'
import plistlib, os
with open(os.environ['SIGNING_DIR']+'/ExportOptions.plist', 'wb') as f:
    plistlib.dump({'method':'app-store-connect', 'teamID':os.environ['IOS_TEAM_ID'],
      'signingStyle':'manual', 'signingCertificate':'Apple Distribution',
      'provisioningProfiles':{'com.posnic.business':os.environ['BUSINESS_PROFILE_UUID']},
      'manageAppVersionAndBuildNumber':False, 'uploadSymbols':True}, f)
PY
xcodebuild -workspace ios/PosnicBusiness.xcworkspace -scheme PosnicBusiness -configuration Release -destination 'generic/platform=iOS' -archivePath "$signing_dir/Business.xcarchive" archive > "$signing_dir/archive.log" 2>&1 || { tail -150 "$signing_dir/archive.log"; exit 1; }
xcodebuild -exportArchive -archivePath "$signing_dir/Business.xcarchive" -exportOptionsPlist "$signing_dir/ExportOptions.plist" -exportPath build-output
test -s build-output/PosnicBusiness.ipa
printf '%s\n' "$GITHUB_SHA" > build-output/SOURCE_COMMIT.txt
(cd build-output && shasum -a 256 *.ipa > SHA256SUMS.txt)
