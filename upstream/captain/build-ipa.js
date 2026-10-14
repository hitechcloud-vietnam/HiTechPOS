#!/usr/bin/env node
/*
 * Build the iOS app.
 *
 * macOS only, and not by choice: an iOS binary is produced by Xcode, and Apple
 * ships Xcode for nothing else. So this runs on a macOS CI runner rather than
 * on the machine the rest of this repo is developed on.
 *
 * Two outcomes, and the difference matters:
 *
 *   unsigned  - no certificate available. Proves the app compiles and produces
 *               a .ipa you can inspect, and that is all: it will not install on
 *               a phone. This is what every fork and every pull request gets,
 *               and it is worth having, because "does it still build for iOS"
 *               is the question that otherwise goes unanswered for months.
 *   signed    - a distribution certificate and provisioning profile are in the
 *               environment, so xcodebuild exports an installable build.
 *
 * The mode is decided by what is present, never by a flag, so the same command
 * works in both places and nobody has to remember which to pass.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const iosDir = path.join(root, 'ios');
const appDir = path.join(iosDir, 'App');
const outDir = path.join(root, 'build-output');

function run(command, cwd = root) {
  console.log(`\n> ${command}`);
  execSync(command, { stdio: 'inherit', cwd });
}

if (process.platform !== 'darwin') {
  console.error('\niOS builds require macOS and Xcode. On other platforms use the CI workflow.');
  process.exit(1);
}

/*
 * The declarations iOS needs, merged in after the project is generated.
 *
 * `npx cap add ios` regenerates ios/ from scratch, so anything edited into the
 * generated Info.plist is lost on the next run - and the symptom is not a build
 * failure. It is an app that installs, launches, and then cannot see the shop's
 * till, which looks like a bug in the discovery code. Kept in ios-templates/
 * and applied here so that cannot happen.
 */
function mergeInfoPlist() {
  const additions = path.join(root, 'ios-templates', 'Info.plist.additions.xml');
  const target = path.join(appDir, 'App', 'Info.plist');
  if (!fs.existsSync(additions) || !fs.existsSync(target)) return;

  const block = fs.readFileSync(additions, 'utf8');
  /* The file is commented for a reader; only the <dict> body is plist. */
  const body = block.slice(block.indexOf('<dict>') + '<dict>'.length, block.lastIndexOf('</dict>'));

  let plist = fs.readFileSync(target, 'utf8');

  /*
   * Merged KEY BY KEY, not all-or-nothing on one sentinel.
   *
   * `cap add ios` is skipped when ios/ already exists, so a machine that has
   * built before keeps the plist it has. A guard that returns early because
   * ONE key is present then silently withholds every key added since - and the
   * newest ones are the microphone declarations, whose absence does not
   * produce a build error. iOS terminates the app the moment it reaches for
   * the microphone, which reads as a crash in the voice code.
   */
  const chunks = splitPlistKeys(body);
  const missing = chunks.filter(({ key }) => !plist.includes(`<key>${key}</key>`));
  if (!missing.length) {
    console.log('Info.plist already carries every declaration.');
    return;
  }

  /* Into the root dict, immediately after it opens. */
  const at = plist.indexOf('<dict>') + '<dict>'.length;
  plist = plist.slice(0, at) + missing.map((c) => c.text).join('') + plist.slice(at);
  fs.writeFileSync(target, plist, 'utf8');
  console.log(`Info.plist: added ${missing.map((c) => c.key).join(', ')}.`);
}

/**
 * One plist dict body, split into a chunk per top-level key.
 *
 * Nesting is tracked so a <dict> or <array> VALUE stays with the key it
 * belongs to - NSAppTransportSecurity and NSBonjourServices are both of that
 * shape, and splitting on every <key> would tear their contents loose and
 * produce a plist Xcode refuses to read.
 */
function splitPlistKeys(body) {
  const lines = body.split('\n');
  const chunks = [];
  let current = null;
  let depth = 0;

  for (const line of lines) {
    const key = depth === 0 && line.match(/<key>([^<]+)<\/key>/);
    if (key) {
      if (current) chunks.push(current);
      current = { key: key[1], text: '' };
    }
    if (current) current.text += line + '\n';
    depth += (line.match(/<(dict|array)>/g) || []).length;
    depth -= (line.match(/<\/(dict|array)>/g) || []).length;
  }
  if (current) chunks.push(current);
  return chunks;
}

const teamId = process.env.IOS_TEAM_ID || '';
const profileName = process.env.IOS_PROVISIONING_PROFILE_NAME || '';
const bundleId = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8')).appId;
const canSign = !!(teamId && profileName);

console.log(`
Building Captain for iOS (${canSign ? 'signed' : 'unsigned'})...`);

run('npm run build');

/* The same stamp the Android build writes, so a phone of either kind can say
   which build it is. See build-version.js. */
const stamp = require('./scripts/build-version');
const version = stamp.resolveVersion(root);
const iosVersion = version.match(/^\d+\.\d+\.\d+/)?.[0];
if (!iosVersion) throw new Error('iOS requires a numeric release version.');
stamp.stampBundle(path.join(root, 'dist'), {
  version,
  commit: stamp.resolveCommit(root),
  at: new Date().toISOString(),
});
console.log(`Version ${version}`);
if (!fs.existsSync(iosDir)) run('npx cap add ios');
run('npx cap sync ios');
mergeInfoPlist();
require('./scripts/install-ios-plugins').install(root);

fs.mkdirSync(outDir, { recursive: true });
const archivePath = path.join(outDir, 'Captain.xcarchive');

/*
 * Ask for whatever `cap sync` just laid down, not for what Capacitor used to
 * produce.
 *
 * CAPACITOR 8 MOVED iOS TO SWIFT PACKAGE MANAGER. Its default template is
 * assets/ios-spm-template.tar.gz, and an SPM project has no workspace at all
 * - Capacitor's own answer to "which package manager" is whether a
 * CapApp-SPM directory exists. So v1.2.23's iOS job died on
 *
 *     xcodebuild: error: 'App.xcworkspace' does not exist.
 *
 * three lines after an `npx cap add ios` that had just succeeded. Nothing was
 * broken; the file was asking for a CocoaPods layout that stopped shipping.
 *
 * Reading it off disk means the next template change is a build that keeps
 * working rather than a release quietly missing a platform.
 */
const container = fs.existsSync(path.join(appDir, 'App.xcworkspace'))
  ? '-workspace App.xcworkspace'
  : fs.existsSync(path.join(appDir, 'App.xcodeproj'))
    ? '-project App.xcodeproj'
    : null;
if (!container) {
  throw new Error(
    `cap sync produced neither App.xcworkspace nor App.xcodeproj in ${appDir}`
  );
}
console.log(`Archiving ${container.split(' ')[1]}`);

/*
 * Archive unsigned, always, and sign at export.
 *
 * The obvious thing - passing CODE_SIGN_IDENTITY and PROVISIONING_PROFILE to
 * xcodebuild - applies them to EVERY target being built, and most of them are
 * frameworks: the Capacitor packages under SPM, the Pods-* targets before
 * that. Those cannot take a provisioning profile, so the build stops naming a
 * target nobody here wrote and did not mean to sign.
 *
 * Signing at export sidesteps it entirely: one app bundle, one profile, and
 * the frameworks inside it are re-signed with the same identity as a
 * consequence rather than by instruction.
 */
run([
  'xcodebuild',
  container,
  '-scheme App',
  '-configuration Release',
  '-sdk iphoneos',
  `-archivePath "${archivePath}"`,
  'archive',
  `MARKETING_VERSION=${iosVersion}`,
  `CURRENT_PROJECT_VERSION=${stamp.versionCode(iosVersion)}`,
  'CODE_SIGNING_ALLOWED=NO',
  'CODE_SIGNING_REQUIRED=NO',
  'CODE_SIGN_IDENTITY=""',
].join(' '), appDir);

const ipaPath = path.join(outDir, canSign ? 'Captain.ipa' : 'Captain-unsigned.ipa');

if (canSign) {
  const method = process.env.IOS_EXPORT_METHOD || 'ad-hoc';
  const optionsPath = path.join(outDir, 'ExportOptions.plist');
  fs.writeFileSync(optionsPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>${method}</string>
    <key>teamID</key>
    <string>${teamId}</string>
    <key>signingStyle</key>
    <string>manual</string>
    <key>compileBitcode</key>
    <false/>
    <key>stripSwiftSymbols</key>
    <true/>
    <!-- Only the app is named. The frameworks are re-signed as a consequence
         of signing what contains them. -->
    <key>provisioningProfiles</key>
    <dict>
        <key>${bundleId}</key>
        <string>${profileName}</string>
    </dict>
</dict>
</plist>
`, 'utf8');

  run([
    'xcodebuild',
    '-exportArchive',
    `-archivePath "${archivePath}"`,
    `-exportPath "${outDir}"`,
    `-exportOptionsPlist "${optionsPath}"`,
  ].join(' '), appDir);

  /* xcodebuild names the export after the scheme. */
  const exported = path.join(outDir, 'App.ipa');
  if (fs.existsSync(exported)) fs.renameSync(exported, ipaPath);
} else {
  /*
   * An .ipa is a zip with the .app inside Payload/. Assembled by hand because
   * -exportArchive refuses to run without a signing identity, and an artifact
   * somebody can unzip and inspect is more use than no artifact at all.
   */
  const appPath = path.join(archivePath, 'Products', 'Applications', 'App.app');
  if (!fs.existsSync(appPath)) throw new Error(`Archive built but App.app was not found: ${appPath}`);

  const payload = path.join(outDir, 'Payload');
  fs.rmSync(payload, { recursive: true, force: true });
  fs.mkdirSync(payload, { recursive: true });
  run(`cp -R "${appPath}" "${payload}/"`);
  run(`cd "${outDir}" && zip -qry "${path.basename(ipaPath)}" Payload`);
  fs.rmSync(payload, { recursive: true, force: true });
}

if (!fs.existsSync(ipaPath)) throw new Error(`Build completed but no .ipa was produced: ${ipaPath}`);
console.log(`\nBuilt: ${ipaPath}${canSign ? '' : '  (unsigned - will not install on a device)'}`);
