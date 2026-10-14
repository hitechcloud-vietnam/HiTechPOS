'use strict';

/*
 * NOTHING HIDES UNDER THE CLOCK.
 *
 * Android 15 enforces edge-to-edge: an app whose targetSdk is 35 or higher
 * draws under the status bar and the old opt-outs are ignored. Capacitor 8
 * targets 36, so the day that upgrade shipped, every screen in this app moved
 * up behind the clock, the battery and the signal bars.
 *
 * The web side of that has TWO halves and only the pair works:
 *
 *   viewport-fit=cover   makes the browser report the inset at all. Without
 *                        it, env(safe-area-inset-top) is zero, so a stylesheet
 *                        that carefully steps around the status bar steps
 *                        around nothing and looks correct in every review.
 *
 *   env(...) padding     actually moves the content.
 *
 * Seven of the nine pages had neither, and two had the padding without the
 * viewport - which is the worse failure, because the code reads as if somebody
 * had thought about it.
 *
 * This holds the first half for every page, because that is the half that is
 * invisible in a diff and silent at runtime.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const pages = () => fs.readdirSync(ROOT).filter((name) => name.endsWith('.html'));
const coversViewport = html => {
  const meta = html.match(/<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*>/i);
  const content = meta?.[0].match(/\bcontent\s*=\s*(["'])(.*?)\1/is);
  return Boolean(content && /(?:^|,)\s*viewport-fit\s*=\s*cover\s*(?:,|$)/i.test(content[2]));
};

test('viewport detection accepts formatted attributes but still requires cover', () => {
  assert.ok(coversViewport('<meta\n name="viewport"\n content="width=device-width, viewport-fit=cover"\n/>'));
  assert.ok(coversViewport("<meta content='viewport-fit=cover,width=device-width' name='viewport'>"));
  assert.ok(!coversViewport('<meta name="viewport" content="width=device-width">'));
  assert.ok(!coversViewport('<meta name="viewport" content="viewport-fit=contain">'));
  assert.ok(!coversViewport('<meta name="description" content="viewport-fit=cover">'));
});

test('every page asks the phone where its clock is', () => {
  const blind = pages().filter((name) => {
    const html = fs.readFileSync(path.join(ROOT, name), 'utf8');
    return !coversViewport(html);
  });

  assert.deepStrictEqual(
    blind,
    [],
    'These draw under the status bar and cannot tell: add viewport-fit=cover to\n  ' +
      blind.join('\n  ')
  );
});

test('and something on each page steps around it', () => {
  /*
   * Deliberately not "this exact selector has this exact padding". Which
   * element clears the status bar is each screen's business - a sticky header
   * on the menu, the card itself on the login - and pinning that here would
   * make this test an obstacle to laying a screen out rather than a guard on
   * whether it is usable.
   *
   * What it holds is that SOMETHING on the page has been told about the inset.
   */
  const styles = new Map();
  const readStyle = (href) => {
    if (styles.has(href)) return styles.get(href);
    const file = path.join(ROOT, href.split('?')[0]);
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    styles.set(href, text);
    return text;
  };

  const unguarded = pages().filter((name) => {
    const html = fs.readFileSync(path.join(ROOT, name), 'utf8');
    if (/safe-area-inset-top/.test(html)) return false;

    const hrefs = [...html.matchAll(/<link[^>]+href="(assets\/[^"]+\.css)"/gi)].map((m) => m[1]);
    return !hrefs.some((href) => /safe-area-inset-top/.test(readStyle(href)));
  });

  assert.deepStrictEqual(
    unguarded,
    [],
    'Nothing on these pages clears the status bar:\n  ' + unguarded.join('\n  ')
  );
});
