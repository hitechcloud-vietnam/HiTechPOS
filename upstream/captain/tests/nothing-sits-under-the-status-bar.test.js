'use strict';

/*
 * NOTHING A THUMB USES SITS UNDER THE CLOCK.
 *
 * Owner, with a photograph of it: "when you search input box overlapting with
 * top network symbol, time and etc."
 *
 * The app draws under the system bar, which is right - a menu that scrolls
 * behind a translucent status bar looks like an app rather than a web page -
 * and every fixed thing at the top has to pay for that by keeping clear of the
 * inset.
 *
 * The header does, by padding. The search row did not: it stops at the
 * header's MEASURED height, and when that is small or the header is not on
 * screen the row stopped at zero, with the clock sitting on top of what
 * somebody was typing.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const MENU = read('assets', 'products', 'menu.css');

/** The body of one rule, by its selector. */
function rule(css, selector) {
  const at = css.indexOf(selector + ' {');
  assert.ok(at > -1, 'no rule for ' + selector);
  return css.slice(at, css.indexOf('}', at));
}

test('THE STICKY SEARCH ROW CLEARS THE STATUS BAR', () => {
  const body = rule(MENU, '.fixed-heading');

  assert.match(body, /position:\s*sticky/);
  assert.match(
    body,
    /env\(safe-area-inset-top/,
    'the search row stops at the header height alone, so the clock lands on it'
  );
  assert.match(
    body,
    /max\(/,
    'it must take whichever is lower, the header or the inset, not one of them'
  );
});

test('and the header still pays for the inset itself', () => {
  /* Both are needed. The header pads so its own contents clear the bar; the
     row below stops at whichever is lower. Removing either puts something
     under the clock. */
  const body = rule(MENU, '.mobile-header');
  /* [^)]* cannot cross the `)` in calc(var(--s2) + env(...)), which is how
     the first version of this line failed on css that was perfectly right. */
  assert.match(body, /padding-top:\s*calc\([\s\S]*?env\(safe-area-inset-top/);
});

test('the shared theme sets the page up to draw under it', () => {
  /* If this ever stops being true the rules above are harmless rather than
     wrong, but the reason for them is gone and somebody should know. */
  assert.match(read('assets', 'common', 'ui-theme.css'), /env\(safe-area-inset-top/);
});
