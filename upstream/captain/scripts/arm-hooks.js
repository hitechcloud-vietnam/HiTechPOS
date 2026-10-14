#!/usr/bin/env node

/*
 * POINT GIT AT THE HOOKS, so the gate is on in every clone.
 *
 * There is no test workflow on GitHub for this repository. That was
 * deliberate: the checks moved into a pre-commit hook to stop paying a server
 * to run what a laptop can run. But a hook only runs if core.hooksPath points
 * at .githooks, and that was a line in the README somebody had to read and
 * type. A clone where nobody typed it commits with NO checks at all, and says
 * nothing about it, so the first sign is a broken build later.
 *
 * That is not a theory. It happened in this repository: a second checkout
 * committed a change without running one test, and looked exactly like a
 * checkout that had run them all.
 *
 * npm runs `prepare` after install, and installing is the one thing nobody
 * skips, so this is the place where "once per clone" can happen by itself.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const WANTED = '.githooks';

/* Not a git checkout at all: a tarball, or a vendored copy. Nothing to arm,
   and nothing worth an error either. */
if (!fs.existsSync(path.join(root, '.git'))) process.exit(0);

const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

const current = git('config', '--local', 'core.hooksPath');
if (current.error) process.exit(0); /* No git on PATH. Not this script's problem. */
if (String(current.stdout || '').trim() === WANTED) process.exit(0); /* Already armed. */

const set = git('config', '--local', 'core.hooksPath', WANTED);
if (set.status !== 0) {
  /*
   * A warning, never a failure. Refusing to install because a hook could not
   * be armed would be a worse trade than the missing hook.
   */
  process.stdout.write('Could not point git at .githooks; run `git config core.hooksPath .githooks` by hand.\n');
  process.exit(0);
}

process.stdout.write('The checks now run before a commit (core.hooksPath -> .githooks).\n');
