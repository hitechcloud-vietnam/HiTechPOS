#!/usr/bin/env node
'use strict';

/*
 * THE DEVICE CHECK, ON A PHONE PLUGGED INTO THIS MACHINE.
 *
 * Owner: "actually let ci want to achieve locally run before commit as pre
 * hook or ai ruleset. reduce actions money please."
 *
 * This is what `device-test.yml` did on a GitHub runner: build the APK, put it
 * on an Android, start it pointed at a server, and read back the one line the
 * app prints about whether its own networking works. The workflow is gone; the
 * check is here.
 *
 * WHY THIS ONE COULD NOT JUST MOVE INTO THE COMMIT HOOK WITH THE REST. The
 * browser suite runs in desktop Chromium. The failures this catches are the
 * ones that only happen inside an Android WebView - a fetch that behaves
 * differently under Capacitor, a request shape the platform refuses - and no
 * amount of Chromium proves anything about that. It needs a real Android.
 *
 * So it is NOT in the pre-commit hook: a hook that fails because nobody has a
 * phone plugged in is a hook that gets switched off, and then the suites that
 * CAN run stop running too. It is a command you run when you have changed how
 * the app talks to a server, with a phone or an emulator attached:
 *
 *     npm run check:device                    against the shop's develop server
 *     npm run check:device -- https://...     against one you name
 *
 * With nothing attached it says so and exits 0. That is deliberate: this is a
 * tool, not a gate, and the thing it would be gating is a phone somebody has
 * to go and find.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APK = path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const APP = 'com.posnic.captain/.MainActivity';
const MARKER = 'POSNIC_SELFTEST';

const target = process.argv[2] || 'https://develop.posnic.io/api';

const run = (command, args, options = {}) =>
  spawnSync(command, args, { encoding: 'utf8', timeout: 120000, ...options });

const say = (line) => process.stdout.write(`${line}\n`);

/* ------------------------------------------------------------ is there one */

const adb = run('adb', ['devices']);
if (adb.error) {
  say('No adb on this machine, so there is no phone to ask.');
  say('Install Android platform-tools if you want to run this; nothing else needs it.');
  process.exit(0);
}

const attached = String(adb.stdout || '')
  .split('\n')
  .slice(1)
  .map((line) => line.trim())
  .filter((line) => line && line.endsWith('device'));

if (attached.length === 0) {
  say('No Android attached, so there is nothing to check.');
  say('Plug a phone in with USB debugging on, or start an emulator, and run this again.');
  process.exit(0);
}

say(`Found ${attached.length === 1 ? 'a phone' : `${attached.length} devices`}.`);

/* ------------------------------------------------------------ build it */

{
  say('Building the current source before checking the device.');
  const built = run('node', ['build-apk.js'], { cwd: ROOT, stdio: 'inherit', timeout: 600000 });
  if (built.status !== 0) {
    say('The build failed, so there is nothing to install.');
    process.exit(1);
  }
}

/* ------------------------------------------------- install, start, listen */

say('Installing.');
const installed = run('adb', ['install', '-r', APK], { stdio: 'inherit' });
if (installed.status !== 0) {
  say('Could not install it. Is the phone unlocked and the cable a data cable?');
  process.exit(1);
}

run('adb', ['logcat', '-c']);

say(`Asking it about ${target}`);
run('adb', [
  'shell',
  'am',
  'start',
  '-n',
  APP,
  '-e',
  'selftest',
  target,
  '--ez',
  'matrix',
  'false',
]);

/*
 * The app answers when it answers. Forty tries at three seconds is the same
 * budget the workflow used, and it is generous on purpose: a cold start on a
 * real phone is slower than an emulator on a server with nothing else to do.
 */
let said = '';
for (let i = 0; i < 40; i += 1) {
  const log = run('adb', ['logcat', '-d']);
  const line = String(log.stdout || '')
    .split('\n')
    .filter((row) => row.includes(MARKER))
    .pop();
  if (line) {
    said = line;
    break;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
}

if (!said) {
  say('');
  say('The app never answered. That is itself the finding: it started and said');
  say('nothing, which is what a broken WebView looks like from the outside.');
  process.exit(1);
}

say('');
say('--- what the handset said ---');
say(said.trim());

/* The line is JSON with an `ok` in it. Read it rather than eyeballing it: a
   report nobody parses is a report somebody skims past. */
const json = said.slice(said.indexOf('{'));
let verdict = null;
try {
  verdict = JSON.parse(json);
} catch (e) {
  say('');
  say('That line was not the shape this expects, which is worth looking at.');
  process.exit(1);
}

say('');
if (verdict.ok) {
  say(`It reached ${verdict.base || target} over ${verdict.transport || 'its own transport'}.`);
  process.exit(0);
}

say(`It could NOT reach ${target}.`);
say(`why: ${verdict.why || 'the app did not say'}`);
process.exit(1);
