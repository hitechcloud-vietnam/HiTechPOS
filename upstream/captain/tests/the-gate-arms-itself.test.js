/*
 * THE GATE ARMS ITSELF.
 *
 * There is no test workflow on GitHub for this repository, on purpose: the
 * checks moved into a pre-commit hook so a server is not paid to run what a
 * laptop runs. That makes the hook the only gate there is.
 *
 * A hook only runs when core.hooksPath points at .githooks, and that used to
 * be a line in the README somebody had to read and type. A clone where nobody
 * typed it commits with no checks at all and looks identical to one that ran
 * them, which is the worst way for a gate to fail.
 *
 * It failed that way here: a second checkout of this repository committed a
 * change without running a single test, silently, because core.hooksPath was
 * unset in it.
 *
 * npm runs `prepare` after install, and installing is the one step nobody
 * skips. These tests hold that wiring in place, and hold the script to
 * arming a real repository rather than merely existing.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'arm-hooks.js');

/** A throwaway checkout with the script in it, laid out as the repo lays it. */
function aFreshClone({ git = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'captain-hooks-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(SCRIPT, path.join(dir, 'scripts', 'arm-hooks.js'));
  if (git) spawnSync('git', ['init', '--quiet'], { cwd: dir });
  return dir;
}

const armed = (dir) =>
  String(
    spawnSync('git', ['config', '--local', 'core.hooksPath'], { cwd: dir, encoding: 'utf8' })
      .stdout || ''
  ).trim();

const arm = (dir) =>
  spawnSync(process.execPath, [path.join(dir, 'scripts', 'arm-hooks.js')], {
    cwd: dir,
    encoding: 'utf8',
  });

test('a clone that has never been told anything ends up armed', () => {
  const dir = aFreshClone();
  try {
    assert.strictEqual(armed(dir), '', 'a fresh clone starts with nothing set');

    const ran = arm(dir);

    assert.strictEqual(ran.status, 0);
    assert.strictEqual(armed(dir), '.githooks');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('running it again changes nothing and says nothing', () => {
  const dir = aFreshClone();
  try {
    arm(dir);
    const again = arm(dir);

    assert.strictEqual(again.status, 0);
    assert.strictEqual(armed(dir), '.githooks');
    assert.strictEqual(String(again.stdout || '').trim(), '', 'already armed is not news');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('somewhere that is not a checkout at all is not an install failure', () => {
  /*
   * A tarball or a vendored copy has no .git. Refusing to install because a
   * hook could not be armed would be a worse trade than the missing hook.
   */
  const dir = aFreshClone({ git: false });
  try {
    assert.strictEqual(arm(dir).status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('install is what arms it, so the wiring is part of the package', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(String(pkg.scripts.prepare || ''), /arm-hooks/);
});

test('what it points at is what the hooks are actually in', () => {
  /* Pointing git at a directory nobody keeps hooks in is the same as not
     pointing it anywhere. */
  assert.ok(fs.existsSync(path.join(ROOT, '.githooks', 'pre-commit')));
});
