'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist');
for (const name of ['tests', 'scripts', 'archive', 'artifacts', 'output', 'build-apk.js', 'build-ipa.js']) {
  assert.equal(fs.existsSync(path.join(root, name)), false, `${name} must not ship in the app`);
}
let checked = 0;
for (const name of fs.readdirSync(root).filter(name => name.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(root, name), 'utf8');
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const source = match[1];
    if (/^(?:https?:)?\/\//.test(source)) continue;
    const file = path.resolve(root, source.split(/[?#]/)[0].replace(/^\//, ''));
    assert.ok(file.startsWith(root + path.sep), `Script escapes the bundle: ${source}`);
    assert.ok(fs.existsSync(file), `${name} requires missing script ${source}`);
    checked++;
  }
}
assert.ok(checked > 0, 'No application script references checked');
console.log(`Web package verified: ${checked} script references; no test, build or archived code.`);
