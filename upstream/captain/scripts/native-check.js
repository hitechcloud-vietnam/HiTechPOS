#!/usr/bin/env node
'use strict';

/*
 * DOES THE NATIVE PROJECT STILL ASSEMBLE ITSELF?
 *
 * Not "does it compile" - that needs an Android SDK, and most machines here do
 * not have one. This asks the cheaper question that catches most of the same
 * breakages, in about five seconds and with nothing installed:
 *
 *   can the CLI lay out an Android project from its templates
 *   can it copy the web bundle into it
 *   does every Capacitor plugin still resolve against this Capacitor
 *   do the patches in android-templates/ still find what they patch
 *
 * WHY IT EXISTS. Upgrading Capacitor 6 to 8 moved `tar` off a line with eight
 * open advisories, and the risk in that change was never the app - it was
 * whether the CLI could still unpack its own templates. With the CI gone, the
 * first thing that would have tried was a release build, at a tag, with a
 * shopkeeper waiting.
 *
 * So: run this after touching capacitor.config.json, any @capacitor package, a
 * plugin, or anything in android-templates/. It needs no SDK, no Java and no
 * phone.
 *
 *     npm run check:native
 *
 * It does NOT prove the Java compiles. `npm run check:device` does that, and
 * needs a real Android; the release build is the last word.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const ANDROID = path.join(ROOT, 'android');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const say = (line) => process.stdout.write(`${line}\n`);

/*
 * ONE STRING, THROUGH A SHELL. `npm` and `npx` are batch files on Windows and
 * Node refuses to spawn a .cmd without a shell; passing an argument ARRAY with
 * `shell: true` is the thing Node warns about, because those arguments are
 * concatenated rather than escaped. Joining them is the shape that needs
 * neither, and every command here is a literal.
 */
function run(command, args, label) {
  const out = spawnSync([command, ...args].join(' '), {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
  });
  if (out.status !== 0) {
    say(`\n✖ ${label}`);
    say((out.stdout || '').trim().split('\n').slice(-12).join('\n'));
    say((out.stderr || '').trim().split('\n').slice(-12).join('\n'));
    process.exit(1);
  }
  return out;
}

/*
 * THE NODE VERSION FIRST, because that is what broke the last release.
 *
 * Capacitor 8 requires Node >= 22 and enforces it by exiting 1 from `cap add`
 * with nothing printed - the log reads as a build that failed for no reason.
 * v1.2.23 died that way on both platforms while every local check passed,
 * because the machine it was developed on runs Node 24 and the runner was
 * pinned to 20.
 *
 * A check that only passes because of what happens to be installed is not a
 * check. This reads the requirement out of the CLI's own package rather than
 * restating it, so it stays true when Capacitor moves again.
 */
function nodeIsNewEnough() {
  let wanted = '';
  try {
    wanted = String(require('@capacitor/cli/package.json').engines.node || '');
  } catch (e) {
    return; /* No CLI installed yet; npm ci will say so more clearly. */
  }

  const least = Number((wanted.match(/(\d+)/) || [])[1]);
  const here = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(least) || !Number.isFinite(here)) return;

  say(`Node ${process.versions.node}; Capacitor wants ${wanted}`);
  if (here < least) {
    say(`
✖ this Node is too old for Capacitor, which will fail without saying so`);
    say(`  install Node ${least} or newer, and check .github/workflows/release.yml agrees`);
    process.exit(1);
  }
}

nodeIsNewEnough();

/* The bundle first: `cap sync` copies webDir, and copying a directory that is
   not there is a confusing way to be told the build never ran. */
say('Building the web bundle.');
run(npm, ['run', 'build'], 'the web bundle did not build');

/*
 * FROM NOTHING, EVERY TIME.
 *
 * A project left over from an older Capacitor hides exactly the failure this
 * looks for: `cap sync` is happy to update a tree that `cap add` could never
 * have created. Five seconds is worth not being lied to.
 */
if (fs.existsSync(ANDROID)) {
  say('Removing the generated Android project so it is laid out afresh.');
  fs.rmSync(ANDROID, { recursive: true, force: true });
}

say('Laying out the Android project.');
run(npx, ['cap', 'add', 'android'], 'the CLI could not lay out an Android project');

say('Syncing the bundle and the plugins.');
const synced = run(npx, ['cap', 'sync', 'android'], 'the CLI could not sync');

/*
 * A plugin that does not resolve is reported as a WARNING and a zero exit, so
 * a silent one would pass this and fail at a tag. The app has one plugin and
 * the sync names every plugin it found; if that list is empty, something has
 * come loose.
 */
const found = String(synced.stdout || '');
if (!/Found \d+ Capacitor plugin/.test(found)) {
  say('\n✖ the sync did not report any plugins at all, which it always does');
  process.exit(1);
}
say(found.split('\n').filter((l) => l.includes('plugin')).join('\n').trim());

/* And the patches this repo applies on top of the generated project. */
say('Checking the patches still find what they patch.');
const MUST_EXIST = [
  ['app/build.gradle', 'the gradle file the version stamp edits'],
  ['app/src/main/AndroidManifest.xml', 'the manifest the permissions are added to'],
  ['app/src/main/java/com/posnic/captain/MainActivity.java', 'the activity that is replaced'],
];

for (const [relative, what] of MUST_EXIST) {
  if (!fs.existsSync(path.join(ANDROID, relative))) {
    say(`\n✖ ${what} is not where the build expects it: android/${relative}`);
    say('  A Capacitor upgrade has moved it. build-apk.js needs the same change.');
    process.exit(1);
  }
}

/*
 * AND THE JAVA THE TEMPLATES ASK FOR, against the one the release installs.
 *
 * v1.2.23 failed twice. The second time it got past the CLI and died in gradle
 * with `invalid source release: 21`: Capacitor 8's Android library is compiled
 * for Java 21 and the workflow handed the runner Java 17. Nothing local can
 * compile that - there is no SDK here - but the two NUMBERS can be compared,
 * and that is the whole failure.
 *
 * Read out of Capacitor's own gradle file and out of the workflow, so neither
 * is restated here and neither can drift without this saying so.
 */
const capacitorGradle = path.join(
  ROOT,
  'node_modules',
  '@capacitor',
  'android',
  'capacitor',
  'build.gradle'
);
const workflow = path.join(ROOT, '.github', 'workflows', 'release.yml');

if (fs.existsSync(capacitorGradle) && fs.existsSync(workflow)) {
  const wants = (fs.readFileSync(capacitorGradle, 'utf8').match(/JavaVersion\.VERSION_(\d+)/) || [])[1];
  const builds = (fs.readFileSync(workflow, 'utf8').match(/java-version:\s*(\d+)/) || [])[1];

  if (wants && builds) {
    say(`Capacitor wants Java ${wants}; the release build installs ${builds}`);
    if (Number(builds) < Number(wants)) {
      say(`
✖ the release build would fail with "invalid source release: ${wants}"`);
      say('  set java-version in .github/workflows/release.yml to at least ' + wants);
      process.exit(1);
    }
  }
}

/*
 * AND THE iOS CONTAINER, which is the other half of what v1.2.23 lost.
 *
 * Capacitor 8 lays iOS out with Swift Package Manager. Its only iOS template
 * is now ios-spm-template.tar.gz, which carries App.xcodeproj and CapApp-SPM
 * and NO Podfile - so nothing runs `pod install`, and nothing ever creates
 * App.xcworkspace. build-ipa.js had asked xcodebuild for that workspace since
 * the first release, so the job died on
 *
 *     xcodebuild: error: 'App.xcworkspace' does not exist.
 *
 * seconds after `npx cap add ios` reported success. The Android half of that
 * release was fixed and shipped; the iPhone build was simply missing.
 *
 * There is no Xcode on this machine and this does not pretend otherwise. But
 * WHICH container Capacitor will produce is knowable from the template it
 * ships, and that is the thing that changed. Read out of the tarball, so it
 * keeps telling the truth when Capacitor moves again.
 */
function iosContainerMatches() {
  const cli = path.join(ROOT, 'node_modules', '@capacitor', 'cli');
  const config = path.join(cli, 'dist', 'config.js');
  const ipa = path.join(ROOT, 'build-ipa.js');
  if (!fs.existsSync(config) || !fs.existsSync(ipa)) return;

  const named = (fs.readFileSync(config, 'utf8').match(/['"](ios-[\w-]*template\.tar\.gz)['"]/) || [])[1];
  const archive = named && path.join(cli, 'assets', named);
  if (!archive || !fs.existsSync(archive)) return;

  /* Tar keeps its entry names in plain text, so the gunzipped bytes can be
     read for what is in there without unpacking any of it. */
  const inside = require('node:zlib').gunzipSync(fs.readFileSync(archive)).toString('latin1');
  const pods = inside.includes('Podfile');
  const wanted = pods ? 'App.xcworkspace' : 'App.xcodeproj';

  say(`Capacitor lays iOS out with ${pods ? 'CocoaPods' : 'SPM'} (${named}); the build must archive ${wanted}`);

  if (!fs.readFileSync(ipa, 'utf8').includes(wanted)) {
    say(`
✖ the iOS release build would fail with "'...' does not exist"`);
    say(`  build-ipa.js never names ${wanted}, and ${named} is what Capacitor lays down`);
    process.exit(1);
  }
}

iosContainerMatches();

say('');
say('The native project lays out, syncs, and has everything the build patches.');
say('It is NOT proof that the Java compiles - that is `npm run check:device`, or the release build.');
