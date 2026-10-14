'use strict';

/*
 * ONE STAMP ON EVERY SCRIPT, AND THE BUILD WRITES IT.
 *
 * The pages carried cache busters somebody had typed. `indexedDB.js?v=5` on
 * six screens and `?v=6` on a seventh; `products/script.js` the same way.
 * Hand-typed numbers drift, because updating one page and not the other five
 * is a thing a person does on a Tuesday.
 *
 * The first cost is small: one file behind two query strings is two entries
 * in the WebView's cache, fetched twice. The second is not. After an update, a
 * screen pinned at ?v=5 can go on serving the copy it cached while the screen
 * beside it gets the new one - two versions of one file inside a single
 * session, which is exactly what "I fixed it but the phone still does the old
 * thing" is made of.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { stampAssetLinks } = require('../scripts/build-version');

/** A built page, written the way vite leaves one. */
function aBuild(pages) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'captain-stamp-'));
  for (const [name, html] of Object.entries(pages)) {
    fs.writeFileSync(path.join(dir, name), html, 'utf8');
  }
  return dir;
}

const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');

/** Every local script the page asks for, with whatever query it carries. */
const asked = (html) =>
  [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]);

test('the same file is asked for the same way on every page', () => {
  /*
   * The bug itself. Two screens loading one file under two names is the thing
   * that was true in the repository for months.
   */
  const dir = aBuild({
    'a.html': '<script src="indexedDB.js?v=5"></script>',
    'b.html': '<script src="indexedDB.js?v=6"></script>',
    'c.html': '<script src="indexedDB.js"></script>',
  });

  try {
    stampAssetLinks(dir, '1.2.25');

    const all = ['a.html', 'b.html', 'c.html'].map((p) => asked(read(dir, p))[0]);
    assert.deepStrictEqual(all, [
      'indexedDB.js?v=1.2.25',
      'indexedDB.js?v=1.2.25',
      'indexedDB.js?v=1.2.25',
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a hand-typed number is replaced, not added to', () => {
  const dir = aBuild({ 'a.html': '<script src="assets/products/script.js?v=6"></script>' });
  try {
    stampAssetLinks(dir, '1.2.25');
    const html = read(dir, 'a.html');
    assert.match(html, /script\.js\?v=1\.2\.25"/);
    assert.ok(!html.includes('v=6'), 'the old number is gone, not carried along');
    assert.strictEqual((html.match(/\?v=/g) || []).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stylesheets too, since a stale stylesheet is a broken screen', () => {
  const dir = aBuild({ 'a.html': '<link href="assets/common/design.css" rel="stylesheet">' });
  try {
    stampAssetLinks(dir, '1.2.25');
    assert.match(read(dir, 'a.html'), /design\.css\?v=1\.2\.25"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("somebody else's server is left alone", () => {
  /*
   * A query string we invented can miss a CDN's cache entirely, and their
   * caching was never ours to decide.
   */
  const dir = aBuild({
    'a.html':
      '<script src="https://cdn.example.com/x.js"></script>' +
      '<link href="//fonts.example.com/f.css" rel="stylesheet">',
  });

  try {
    const before = read(dir, 'a.html');
    stampAssetLinks(dir, '1.2.25');
    assert.strictEqual(read(dir, 'a.html'), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('only what caches badly: a page, an image and a font keep their URLs', () => {
  const dir = aBuild({
    'a.html':
      '<link href="images/icon.png" rel="icon">' +
      '<link href="assets/vendor/fa/webfonts/fa.woff2" rel="preload">' +
      '<script src="run.js"></script>',
  });

  try {
    stampAssetLinks(dir, '1.2.25');
    const html = read(dir, 'a.html');
    assert.ok(html.includes('images/icon.png"'), 'an icon gains nothing from a new URL');
    assert.ok(html.includes('fa.woff2"'), 'a font that never changes gains nothing either');
    assert.match(html, /run\.js\?v=1\.2\.25"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a stamp that is not a stamp changes nothing', () => {
  /* Called before the version is known, this must leave the build alone
     rather than write `?v=undefined` onto every page. */
  const dir = aBuild({ 'a.html': '<script src="run.js"></script>' });
  try {
    const before = read(dir, 'a.html');
    assert.strictEqual(stampAssetLinks(dir, ''), 0);
    assert.strictEqual(stampAssetLinks(dir, undefined), 0);
    assert.strictEqual(read(dir, 'a.html'), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a stamp cannot smuggle anything into the markup', () => {
  /* The version comes from package.json and git, neither of which is a
     stranger, but a value that lands inside an attribute is worth keeping
     boring. */
  const dir = aBuild({ 'a.html': '<script src="run.js"></script>' });
  try {
    stampAssetLinks(dir, '1.0.0" onload="alert(1)');
    const html = read(dir, 'a.html');
    /*
     * The letters survive, harmlessly: the stamp reads 1.0.0onloadalert1. What
     * must not survive is the punctuation that would END the attribute and
     * begin another one.
     */
    assert.ok(!html.includes('onload='), 'no second attribute got out');
    assert.strictEqual((html.match(/"/g) || []).length, 2, 'still one attribute, still two quotes');
    assert.match(html, /run\.js\?v=1\.0\.0onloadalert1"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('nothing to stamp is not a failure', () => {
  assert.strictEqual(stampAssetLinks(path.join(os.tmpdir(), 'captain-no-such-dir'), '1.2.25'), 0);
});
