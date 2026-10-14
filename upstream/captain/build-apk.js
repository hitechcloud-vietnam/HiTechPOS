#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const stamp = require('./scripts/build-version');

function readDirectories(dir) {
  try {
    return fs.readdirSync(dir).map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

function resolveJavaHome() {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;

  const candidates = [
    path.join(__dirname, '.android-build-tools', 'jdk17'),
    // Reuse the existing local toolchain during migration from apk-converter.
    path.resolve(__dirname, '..', 'apk-converter', '.android-build-tools', 'jdk17'),
    'E:\\Android\\jbr',
    'E:\\Android\\jre',
    'C:\\Program Files\\Android\\Android Studio\\jbr',
    'C:\\Program Files\\Android\\Android Studio\\jre',
    ...readDirectories('C:\\Program Files\\Eclipse Adoptium'),
    ...readDirectories('C:\\Program Files\\Microsoft'),
    ...readDirectories('C:\\Program Files\\Java').filter((dir) => /jdk/i.test(dir))
  ];

  return candidates.find((dir) => fs.existsSync(path.join(dir, 'bin', 'java.exe'))) || null;
}

function run(command, cwd = __dirname) {
  console.log(`\n> ${command}`);
  execSync(command, { stdio: 'inherit', cwd });
}

/*
 * The same commands, spelled the way each platform spells them.
 *
 * This script hard-coded npm.cmd, npx.cmd and gradlew.bat, so it ran on
 * Windows and nowhere else - which is why building an APK meant having the
 * whole Android toolchain on one particular laptop. A CI runner already has
 * that toolchain installed; it just could not run this file.
 */
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';
const npx = isWindows ? 'npx.cmd' : 'npx';
/* `.\` matters: cmd.exe on a machine with NoDefaultCurrentDirectoryInExePath
   set does not resolve a command from the working directory, and the failure
   it prints - "not recognized as an operable program" - reads as if Gradle
   were missing rather than unqualified. Cost a full build to find. */

const javaHome = resolveJavaHome();
if (!javaHome) {
  console.error('\nJAVA_HOME is not set and no JDK was found. Install Android Studio/JDK 17 or set JAVA_HOME.');
  process.exit(1);
}

process.env.JAVA_HOME = javaHome;
process.env.PATH = `${path.join(javaHome, 'bin')};${process.env.PATH}`;
console.log(`Using JDK: ${javaHome}`);

/*
 * An SDK path is only worth honouring if an SDK is actually there.
 *
 * This trusted ANDROID_HOME on sight. On a machine where it is set
 * system-wide to another user's profile - `C:\Users\office\...`, left behind
 * by whoever installed Android Studio - the build inherited a path that does
 * not exist, skipped the local toolchain sitting right next to it, and failed
 * in Gradle with "SDK location not found" a minute later. The env var names a
 * location; it does not promise one.
 */
const looksLikeSdk = (dir) =>
  !!dir && fs.existsSync(path.join(dir, 'platforms')) && fs.existsSync(path.join(dir, 'build-tools'));

if (!looksLikeSdk(process.env.ANDROID_HOME) && !looksLikeSdk(process.env.ANDROID_SDK_ROOT)) {
  /* Said before anything is reassigned, so the person who set it wrong finds
     out from one line instead of from a Gradle error a minute later. */
  for (const name of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    if (process.env[name]) console.log(`Ignoring ${name} (no SDK there): ${process.env[name]}`);
  }

  const localSdk = path.join(__dirname, '.android-build-tools', 'android-sdk');
  const legacyLocalSdk = path.resolve(__dirname, '..', 'apk-converter', '.android-build-tools', 'android-sdk');
  const defaultSdk = path.join('C:\\Users', os.userInfo().username, 'AppData', 'Local', 'Android', 'Sdk');
  const sdk = fs.existsSync(localSdk)
    ? localSdk
    : fs.existsSync(defaultSdk)
      ? defaultSdk
      : fs.existsSync(legacyLocalSdk)
        ? legacyLocalSdk
        : null;

  if (sdk) {
    process.env.ANDROID_HOME = sdk;
    process.env.ANDROID_SDK_ROOT = sdk;
    process.env.PATH = `${path.join(sdk, 'platform-tools')};${path.join(sdk, 'cmdline-tools', 'latest', 'bin')};${process.env.PATH}`;
    console.log(`Using Android SDK: ${sdk}`);
  }
}

const isRelease = process.argv.includes('--release');
const gradleTask = isRelease ? 'assembleRelease' : 'assembleDebug';
const apkRelativePath = isRelease
  ? path.join('app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
  : path.join('app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const androidDir = path.join(__dirname, 'android');

console.log(`\nBuilding Captain ${isRelease ? 'release' : 'debug'} APK...`);
run(`${npm} run build`);

/*
 * Stamp the version into the bundle BEFORE cap sync copies it.
 *
 * Every release went out as versionCode 1 / versionName "1.0" - the Capacitor
 * default nobody changed - so every build looked identical to Android and to
 * the person holding the phone. A shopkeeper who installed a fix and said
 * "nothing changed" could not be answered. See build-version.js.
 */
const version = stamp.resolveVersion(__dirname);
const build = { version, commit: stamp.resolveCommit(__dirname), at: new Date().toISOString() };
stamp.stampBundle(path.join(__dirname, 'dist'), build);
console.log(`Version ${version} (${build.commit || 'no commit'})`);

if (!fs.existsSync(androidDir)) {
  run(`${npx} cap add android`);
}

run(`${npx} cap sync android`);

/* After sync, because `cap add` writes the gradle file this edits. */
stamp.stampGradle(path.join(androidDir, 'app', 'build.gradle'), version);

const javaSourceDir = path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'posnic', 'captain');
const javaTemplateDir = path.join(__dirname, 'android-templates');
fs.mkdirSync(javaSourceDir, { recursive: true });
for (const fileName of ['MainActivity.java', 'LocalNetworkPlugin.java', 'SecureSessionPlugin.java']) {
  fs.copyFileSync(
    path.join(javaTemplateDir, fileName),
    path.join(javaSourceDir, fileName)
  );
}

const appGradlePath = path.join(androidDir, 'app', 'build.gradle');
const signingGradleName = 'release-signing.gradle';
fs.copyFileSync(
  path.join(javaTemplateDir, signingGradleName),
  path.join(androidDir, 'app', signingGradleName)
);
let appGradle = fs.readFileSync(appGradlePath, 'utf8');
const signingApply = `apply from: '${signingGradleName}'`;
if (!appGradle.includes(signingApply)) {
  appGradle += `\n${signingApply}\n`;
  fs.writeFileSync(appGradlePath, appGradle, 'utf8');
}

const manifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
if (fs.existsSync(manifestPath)) {
  const networkSecurityPath = path.join(androidDir, 'app', 'src', 'main', 'res', 'xml', 'network_security_config.xml');
  fs.mkdirSync(path.dirname(networkSecurityPath), { recursive: true });
  fs.writeFileSync(
    networkSecurityPath,
    '<?xml version="1.0" encoding="utf-8"?>\n<network-security-config>\n    <base-config cleartextTrafficPermitted="true" />\n</network-security-config>\n',
    'utf8'
  );

  let manifest = fs.readFileSync(manifestPath, 'utf8');
  if (!manifest.includes('usesCleartextTraffic')) {
    manifest = manifest.replace('<application', '<application\n        android:usesCleartextTraffic="true"');
  }
  if (!manifest.includes('networkSecurityConfig')) {
    manifest = manifest.replace('<application', '<application\n        android:networkSecurityConfig="@xml/network_security_config"');
  }

  /*
   * The camera, for scanning the shop's code.
   *
   * Without this the scanner does not fail loudly: getUserMedia rejects with
   * NotAllowedError and the screen reports the camera as blocked, sending
   * somebody into Settings to grant a permission the app never asked for.
   * required="false" so a device without a camera can still install and use
   * the other two ways in.
   */
  if (!manifest.includes('android.permission.CAMERA')) {
    const camera = [
      '<uses-permission android:name="android.permission.CAMERA" />',
      '    <uses-feature android:name="android.hardware.camera" android:required="false" />',
      '',
      '    <application',
    ].join('\n');
    manifest = manifest.replace('<application', camera);
  }

  /*
   * The microphone, for a waiter who says the order instead of tapping it.
   *
   * BOTH permissions, because Capacitor's WebView asks for both when a page
   * calls getUserMedia({audio}): it launches RECORD_AUDIO and
   * MODIFY_AUDIO_SETTINGS together, and an undeclared one makes the whole
   * request fail. The page then sees a plain permission denial with nothing to
   * explain it, which reads as a broken microphone rather than a missing line
   * in a manifest.
   *
   * required="false" so a handset without one still installs and takes orders
   * by hand; the mic button is simply absent there.
   */
  if (!manifest.includes('android.permission.RECORD_AUDIO')) {
    const microphone = [
      '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
      '    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
      '    <uses-feature android:name="android.hardware.microphone" android:required="false" />',
      '',
      '    <application',
    ].join('\n');
    manifest = manifest.replace('<application', microphone);
  }
  /*
   * The keyboard has to be able to appear, and the page has to move out of its
   * way.
   *
   * Capacitor's generated manifest sets no windowSoftInputMode, which leaves
   * the system to choose for a full-screen WebView - and what it chooses does
   * not reliably raise the IME or resize the page around it. A waiter taps the
   * address box, nothing happens, and the app looks broken.
   *
   * adjustResize, so the WebView shrinks and the focused field stays on
   * screen rather than being covered by the keyboard that was meant to fill
   * it in.
   */
  /*
   * Chromium's net stack watches connectivity through this.
   *
   * Not required to open a socket, and its absence is quiet: the WebView's
   * NetworkChangeNotifier simply never learns what kind of connection the
   * device has. Declared because a net stack that cannot see the network is
   * the wrong thing to be guessing about while chasing requests that hang.
   */
  if (!manifest.includes('ACCESS_NETWORK_STATE')) {
    manifest = manifest.replace(
      '<uses-permission android:name="android.permission.INTERNET" />',
      '<uses-permission android:name="android.permission.INTERNET" />' +
        '\n    <uses-permission android:name=\"android.permission.ACCESS_NETWORK_STATE\" />'
    );
  }

  if (!manifest.includes('windowSoftInputMode')) {
    manifest = manifest.replace(
      'android:name=".MainActivity"',
      'android:name=".MainActivity"' +
        '\n            android:windowSoftInputMode=\"adjustResize\"'
    );
  }
  if (!manifest.includes('android:scheme="com.posnic.captain"')) {
    manifest = manifest.replace('</activity>', `<intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="com.posnic.captain" android:host="authorized" />
            </intent-filter>\n        </activity>`);
  }
  manifest = manifest.replace(/android:allowBackup="true"/g, 'android:allowBackup="false"');
  fs.writeFileSync(manifestPath, manifest, 'utf8');
}

if (!isWindows) {
  /* `cap add android` can write the wrapper without the execute bit, and
     Gradle is the last step, so it would fail several minutes in. */
  try { fs.chmodSync(path.join(androidDir, 'gradlew'), 0o755); } catch (e) { /* already fine */ }
}

/* The wrapper by absolute path, quoted.
   Invoking it as a bare `gradlew.bat` relies on cmd.exe resolving a command
   from the working directory, which a machine with
   NoDefaultCurrentDirectoryInExePath set does not do - and the error it
   prints, "not recognized as an operable program", reads as if Gradle were
   missing rather than merely unqualified. An absolute path needs no PATH
   lookup and no shell-specific prefix. */
run(`"${path.join(androidDir, isWindows ? 'gradlew.bat' : 'gradlew')}" ${gradleTask}`, androidDir);

const apkPath = path.join(androidDir, apkRelativePath);
if (!fs.existsSync(apkPath)) {
  throw new Error(`Gradle completed but APK was not found: ${apkPath}`);
}

if (isRelease) {
  const sdkRoot = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
  const buildToolsRoot = sdkRoot ? path.join(sdkRoot, 'build-tools') : null;
  const buildTools = buildToolsRoot
    ? readDirectories(buildToolsRoot).sort((a, b) => path.basename(b).localeCompare(path.basename(a), undefined, { numeric: true }))
    : [];
  const apkSigner = buildTools
    .map((dir) => path.join(dir, process.platform === 'win32' ? 'apksigner.bat' : 'apksigner'))
    .find((file) => fs.existsSync(file));

  if (!apkSigner) throw new Error('apksigner was not found in the Android SDK build-tools.');
  run(`"${apkSigner}" verify --verbose "${apkPath}"`, androidDir);
}

console.log(`\nAPK built successfully: ${apkPath}`);
