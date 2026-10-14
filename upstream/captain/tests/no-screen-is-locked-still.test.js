/*
 * NO SCREEN MAY END UP WITH A DOCUMENT NOBODY CAN SCROLL.
 *
 * Two of this app's base stylesheets open with
 *
 *     html, body { height: 100%; overflow: hidden }
 *
 * which is how a full-height flex app is usually started, and which locks the
 * document. The newer sheets that replaced those layouts undo it - and
 * products/menu.css undid it on `body` alone, leaving `html` hidden. The menu
 * could not be scrolled by a finger on any handset, and the same omission in
 * table/seat.css did it to the table screen.
 *
 * IT HID BECAUSE overflow:hidden STILL ALLOWS PROGRAMMATIC SCROLLING. Every
 * automated check moves a page with window.scrollTo, which is the one way of
 * moving a document that overflow:hidden does not refuse - so 136 browser
 * tests passed over a menu nobody could scroll, repeatedly, for weeks.
 *
 * a-thumb-can-move-the-page.spec.js proves the two screens we know about with
 * a real gesture. This is the cheaper, wider net: whenever a page loads a
 * stylesheet that locks `html`, some later stylesheet on that same page has to
 * let it go again. It costs nothing to run and it fails on the next screen
 * somebody builds this way.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

/** The stylesheets a page loads, in the order it loads them. */
function sheetsOf(page) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  const out = [];
  const link = /<link[^>]+href="([^"]+\.css)[^"]*"/g;
  let found;
  while ((found = link.exec(html))) {
    const file = found[1].split('?')[0];
    if (file.startsWith('http')) continue;
    const full = path.join(root, file);
    if (fs.existsSync(full)) out.push({ file, css: fs.readFileSync(full, 'utf8') });
  }
  return out;
}

/** Every rule whose selector names `html`, with its body. */
function htmlRules(css) {
  const out = [];
  const rule = /(^|[}\s])((?:[^{}]*\bhtml\b[^{}]*))\{([^}]*)\}/g;
  let found;
  while ((found = rule.exec(css))) {
    const selector = found[2].trim();
    /* Only bare element rules. `html[data-theme]` and the like are somebody
       being deliberate about a state, not the page's base layout. */
    if (/@/.test(selector)) continue;
    out.push({ selector, body: found[3] });
  }
  return out;
}

const locks = (rule) => /overflow\s*:\s*hidden/.test(rule.body);
const frees = (rule) => /overflow\s*:\s*(visible|auto|scroll)/.test(rule.body);

const PAGES = fs
  .readdirSync(root)
  .filter((name) => name.endsWith('.html'))
  .sort();

test('every page ships at least one stylesheet', () => {
  /* If this ever finds nothing the rest of the file passes vacuously, which
     is the failure mode a guard like this dies of. */
  const withCss = PAGES.filter((page) => sheetsOf(page).length);
  assert.ok(withCss.length >= 5, `only ${withCss.length} pages had stylesheets`);
});

test('a page that locks the document also unlocks it', () => {
  const stuck = [];

  for (const page of PAGES) {
    const sheets = sheetsOf(page);
    let lockedBy = null;

    for (const sheet of sheets) {
      for (const rule of htmlRules(sheet.css)) {
        if (locks(rule)) lockedBy = sheet.file;
        else if (frees(rule)) lockedBy = null;
      }
    }

    if (lockedBy) stuck.push(`${page} (locked by ${lockedBy}, never released)`);
  }

  assert.deepEqual(
    stuck,
    [],
    'these screens cannot be scrolled by a finger:\n  ' + stuck.join('\n  ')
  );
});

test('the two screens this was actually reported on say so explicitly', () => {
  /*
   * Named, because they are the ones a person sat in front of and could not
   * use, and because the general rule above would still pass if somebody
   * "fixed" them by deleting the lock from the base sheet instead - which
   * would take the flex layout the other screens still depend on with it.
   */
  const menu = fs.readFileSync(path.join(root, 'assets', 'products', 'menu.css'), 'utf8');
  const seat = fs.readFileSync(path.join(root, 'assets', 'table', 'seat.css'), 'utf8');

  assert.ok(
    htmlRules(menu).some(frees),
    'menu.css no longer releases the document element'
  );
  assert.ok(
    htmlRules(seat).some(frees),
    'seat.css no longer releases the document element'
  );
});
