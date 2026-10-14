/*
 * indexedDB.js is loaded by EVERY page, and must not assume any one of them.
 *
 * WHAT HAPPENED. The menu was rewritten and loadProducts started calling
 * MenuScreen.draw(). Login also calls loadProducts - to fill `products` the
 * moment a branch's items arrive, before it redirects - and on the login page
 * there is no MenuScreen, because only products.html loads it.
 *
 * The ReferenceError threw inside an await. Nothing stopped, nothing printed
 * anywhere a person would look, and the login simply never redirected: the
 * screen sat there looking like a server that had not answered. Twenty-three
 * browser tests went red and not one of them said "MenuScreen".
 *
 * This is the same shape as the `root` bug in assets/common/self-test.js - a
 * name that exists in one context reached for in another - and it earns a test
 * for the same reason: the symptom never names the cause.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

/** Which globals a page has to load a script of its own to get. */
const PAGE_ONLY = ['MenuScreen', 'MenuView', 'ItemSearch', 'Speech', 'VoiceOrderUI'];

test('shared code does not assume a page-only global is there', () => {
  const source = fs.readFileSync(path.join(root, 'indexedDB.js'), 'utf8');

  /*
   * Per function, not per line.
   *
   * The guard is usually an early return several lines above the use, and it
   * protects everything after it - so a line-by-line check reports the real
   * guard as the violation. What matters is that a function reaching for one
   * of these names has said somewhere that it might not be there.
   */
  const functions = source.split(/\n(?=(?:async )?function )/);

  const naked = [];
  for (const name of PAGE_ONLY) {
    const uses = new RegExp('\\b' + name + '\\s*\\.');
    const guarded = new RegExp('typeof\\s+' + name + '\\b');
    for (const body of functions) {
      /* Comments talk about these names constantly and call none of them. */
      const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (!uses.test(code) || guarded.test(code)) continue;
      const named = /^(?:async )?function (\w+)/.exec(body);
      naked.push((named ? named[1] : '(top level)') + ' uses ' + name);
    }
  }

  assert.deepEqual(
    naked,
    [],
    'indexedDB.js reaches for a page-only global unguarded: ' +
      naked.join('; ') +
      '. Every page loads this file; only some load those.'
  );
});

test('the page that draws the menu loads what draws it', () => {
  /* The other half of the same mistake: guarding the call and then forgetting
     the script tag would make the menu quietly never render. */
  const page = fs.readFileSync(path.join(root, 'products.html'), 'utf8');
  for (const file of ['assets/common/menu-view.js', 'assets/products/menu.js']) {
    assert.ok(page.includes(file), 'products.html does not load ' + file);
  }

  assert.ok(
    page.indexOf('assets/common/menu-view.js') < page.indexOf('assets/products/menu.js'),
    'menu-view.js must be loaded before menu.js, which calls it'
  );
});

test('a stylesheet that is linked exists', () => {
  /* A 404 on a stylesheet is silent: the page renders unstyled and looks like
     a design decision somebody made badly. */
  for (const page of ['index.html', 'products.html', 'cart.html']) {
    const source = fs.readFileSync(path.join(root, page), 'utf8');
    const links = [...source.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map((m) => m[1]);
    for (const href of links) {
      if (/^https?:/.test(href)) continue;
      assert.ok(fs.existsSync(path.join(root, href)), page + ' links ' + href + ', which is not there');
    }
  }
});

test('a script that is linked exists', () => {
  for (const page of ['index.html', 'products.html', 'cart.html']) {
    const source = fs.readFileSync(path.join(root, page), 'utf8');
    const links = [...source.matchAll(/<script[^>]+src="([^"?]+)[^"]*"/g)].map((m) => m[1]);
    for (const src of links) {
      if (/^https?:/.test(src)) continue;
      /* Written at build time by scripts/build-version.js, so it is correctly
         absent at a desk - where the app simply says "dev", which is true. */
      if (src.endsWith('app-build.js')) continue;
      assert.ok(fs.existsSync(path.join(root, src)), page + ' loads ' + src + ', which is not there');
    }
  }
});

/*
 * WHY THERE ARE NO TABLES, which is two different answers.
 *
 * The table screen drew the same bare "Enter Table Number" box whether the
 * shop had not finished setting its tables up or did not do table service at
 * all. A waiter at a restaurant mid-setup and somebody signing in at a grocer
 * got the same blank box, and neither was told which they were looking at.
 */

test('the handset stores whether this shop does table service', () => {
  const source = fs.readFileSync(path.join(root, 'indexedDB.js'), 'utf8');
  assert.match(
    source,
    /result\.data\.table_service === true \? 'yes' : 'no'/,
    'the table service switch is not stored'
  );

  /*
   * Compared explicitly, because localStorage has only strings and both ''
   * and 'false' are truthy - which is how a switch ends up permanently on.
   */
  const page = fs.readFileSync(path.join(root, 'discount.html'), 'utf8');
  assert.match(page, /tableService === 'no'/, 'the flag is read as a truthy string');
});

test('an empty floor plan says WHICH kind of empty it is', () => {
  const page = fs.readFileSync(path.join(root, 'discount.html'), 'utf8');
  assert.match(page, /Restaurant is turned off for this shop/, 'no message for a shop without table service');
  assert.match(page, /No tables set up yet/, 'no message for a restaurant mid-setup');
});

test('the message never blocks the order', () => {
  /*
   * Typing a table number by hand has to keep working while somebody goes and
   * changes the setting. A notice that stops the order helps nobody standing
   * at a table with a customer waiting.
   */
  const page = fs.readFileSync(path.join(root, 'discount.html'), 'utf8');
  /* Forward from the notice, not from the top of the file: restoreTableChoice
     is called in several places and the first one is well above this. */
  const from = page.indexOf('const tableService');
  const block = page.slice(from, page.indexOf('restoreTableChoice(choice)', from));
  assert.match(block, /manual_table_input/, 'the box is gone when there are no tables');
  assert.match(block, /You can still type a table number below/, 'the message does not say the order can continue');
});

test('the flag is forgotten when the shop is', () => {
  /* Or a handset moved to a second shop keeps the first shop's answer. */
  const source = fs.readFileSync(path.join(root, 'indexedDB.js'), 'utf8');
  const cleared = source.slice(source.indexOf('"kiosk_selected_branch"'), source.indexOf('].forEach'));
  assert.match(cleared, /kiosk_table_service/, 'the flag survives clearing the shop');
});

/*
 * THE SELECTORS THE BROWSER TESTS WALK THROUGH.
 *
 * A renamed class does not break a Playwright test loudly - it makes it HANG,
 * for the full timeout, on a click for an element that will never exist. That
 * is a ten minute wait to learn one thing, and it has happened twice in this
 * codebase already: once when the bill markup was rebuilt and the notes modal
 * kept binding to .item-name, and once when the floor screen replaced
 * .kot-btn-add with .floor-new and the harness kept clicking the old one.
 *
 * Node finds it in milliseconds instead.
 */

test('every selector the browser harness clicks still exists', () => {
  const pages = {};
  for (const page of ['index.html', 'kot-management.html', 'discount.html', 'products.html', 'cart.html']) {
    pages[page] = fs.readFileSync(path.join(root, page), 'utf8');
  }
  const everywhere = Object.values(pages).join('\n');

  /* The route tests/support/shop.js walks to reach the menu. */
  const walked = [
    { what: '.floor-new', why: 'the floor screen has no New order button' },
    { what: '#manual_table_input', why: 'a table cannot be typed in' },
    { what: '#username', why: 'the sign-in form has no username field' },
    { what: '#password', why: 'the sign-in form has no password field' },
    { what: '#login-btn', why: 'there is no sign-in button' },
  ];

  for (const step of walked) {
    const bare = step.what.replace(/^[.#]/, '');
    /*
     * Plain string matching, not a built regex.
     *
     * The first version assembled one from the selector name and lost a
     * backslash on the way into the file, so `\\b` became `\b` - a backspace
     * character - and the check reported every selector missing. A test that
     * cries wolf is worse than no test, and this one is checking for exactly
     * the class of mistake it made itself.
     */
    const found = step.what.startsWith('#')
      ? everywhere.includes('id="' + bare + '"') || everywhere.includes("id='" + bare + "'")
      : everywhere.includes('class="' + bare + '"') ||
        everywhere.includes('class="' + bare + ' ') ||
        everywhere.includes(' ' + bare + '"') ||
        everywhere.includes(' ' + bare + ' ');
    assert.ok(found, step.what + ' is gone: ' + step.why);
  }
});

test('the pax stepper drives the same field everything else reads', () => {
  /*
   * The old icon row and the old text box are still in the page and still
   * driven by setPersonCount; the box is hidden by CSS rather than removed,
   * because handlePersonInput and the restore-after-poll path both read it.
   * One function stays the source of truth for how many people are at the
   * table, so nothing can disagree about it.
   */
  const page = fs.readFileSync(path.join(root, 'discount.html'), 'utf8');
  assert.match(page, /id="pax_less"/, 'there is no way to take a person off');
  assert.match(page, /id="pax_more"/, 'there is no way to add a person');
  assert.match(page, /id="person_count"/, 'the field the backend reads is gone');
  assert.match(page, /id="person_input"/, 'handlePersonInput has nothing to read');

  /* The buttons go through setPersonCount, never straight to the field. */
  assert.match(page, /setPersonCount\(target\.id === 'pax_more'/, 'the stepper bypasses setPersonCount');
});

test('every screen in the journey loads the design system', () => {
  /* Six screens, one design. A screen that misses this is the one that looks
     like it came from a different app - which is the whole reason for the
     rebuild. */
  for (const page of [
    'index.html', 'kot-management.html', 'discount.html',
    'products.html', 'cart.html', 'thankyou.html',
  ]) {
    const source = fs.readFileSync(path.join(root, page), 'utf8');
    assert.match(source, /assets\/common\/design\.css/, page + ' does not load design.css');
  }
});

/*
 * FINDING THE TILL ON THE WI-FI, without looking like a hang.
 *
 * The sweep fired 2..254 on every subnet at once. A Windows machine offers
 * four of them, so that is a thousand requests in flight - and the 500ms probe
 * timeout starts when fetch is CALLED, not when the socket opens. The later
 * batches therefore timed out having never left the queue, the search took
 * tens of seconds, and it was reported as a hang. It was not hanging; it was
 * queueing.
 */

test('the likely addresses are tried before the other two hundred', () => {
  /* A till is nearly always low on its subnet or on a round static number.
     About thirty probes instead of a thousand, and it answers in a second. */
  const config = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
  assert.match(config, /const LIKELY_HOSTS = \[/, 'there is no fast first pass');

  const list = /const LIKELY_HOSTS = \[([\s\S]*?)\]/.exec(config)[1];
  const hosts = list.split(',').map((n) => Number(n.trim())).filter((n) => Number.isFinite(n));

  /* The range a router hands out from. The owner's own observation: "most of
     the time within 10 or 15 ip it will get". */
  for (const host of [2, 5, 10, 15, 20]) {
    assert.ok(hosts.includes(host), 'the first pass skips .' + host);
  }
  /* And the round numbers a static address gets given. */
  assert.ok(hosts.includes(100), 'the first pass skips .100');
  assert.ok(hosts.includes(200), 'the first pass skips .200');

  /* Small enough to actually run rather than queue. */
  assert.ok(hosts.length <= 40, 'the first pass is too big to be a first pass');
});

test('the search cannot outlive a deadline', () => {
  const config = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
  assert.match(config, /SEARCH_DEADLINE_MS/, 'the sweep has no hard stop');
  assert.match(
    config,
    /Date\.now\(\) > deadline/,
    'the deadline is declared but never checked'
  );
});

test('many networks do not mean many times the requests', () => {
  /*
   * The concurrency is divided across the subnets rather than applied to each.
   * Four networks at 64 apiece is 256 in flight, which is the state that made
   * every later batch time out in the queue instead of on the wire.
   */
  const config = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
  assert.match(
    config,
    /SCAN_CONCURRENCY \/ Math\.max\(1, subnets\.length\)/,
    'the sweep still fires full concurrency per subnet'
  );
});

test('a wrong password does not blame the shop server', () => {
  /*
   * A tokenless 401 really does mean an old server everywhere else - one from
   * before the bearer-token work, refusing the route to everybody. But
   * kioskMobileLogin answers 401 for a bad credential, which is correct and
   * ordinary, and this turned it into "update POSNIC on the till": a confident
   * wrong diagnosis that sends somebody to upgrade a server because they
   * mistyped a password.
   */
  const config = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
  const branch = /if \(error\.status === 401 && !session\.token[^)]*\)/.exec(config);
  assert.ok(branch, 'the SERVER_TOO_OLD branch has moved');
  assert.match(
    branch[0],
    /!path\.includes\('kioskMobileLogin'\)/,
    'a failed sign-in is still reported as an out-of-date server'
  );
});

test('the search looks near the address this device was given', () => {
  /*
   * THE STRONGEST HINT THERE IS, and a guessed list is not it.
   *
   * A router hands out its pool in order, so whatever address the phone got,
   * the till is usually within a dozen of it. A real shop's till came back on
   * .170 - not low, not round, and on no list anybody would have written. Its
   * phone would have been in the same part of the pool.
   */
  const config = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
  assert.match(config, /ownHosts/, 'the device does not remember its own host number');
  assert.match(config, /add\(own - step\)/, 'the search does not look below its own address');
  assert.match(config, /add\(own \+ step\)/, 'the search does not look above its own address');

  /* And that neighbourhood is part of the FAST pass, not the slow one. */
  assert.match(
    config,
    /likelyCount = \(\) =>[\s\S]{0,160}ownHosts\.length/,
    'the neighbourhood is not counted into the first pass'
  );
});

test('a page that uses icon-font glyphs loads the icon font', () => {
  /*
   * NOTHING ERRORS WHEN AN ICON FONT IS MISSING. The glyph simply is not
   * there, and an empty box is easy to read as "the image did not load" or
   * "the local server is wrong" - which is exactly how this one was reported.
   *
   * The connect sheet used `fas fa-qrcode`, `fa-wifi` and `fa-keyboard`, and
   * index.html has never loaded Font Awesome, so all three choices showed a
   * blank square. They are inline SVG now: this is the first screen, often on
   * a bad connection, and a whole icon font for three glyphs is a request that
   * buys nothing.
   */
  const pages = [
    'index.html', 'kot-management.html', 'discount.html',
    'products.html', 'cart.html', 'thankyou.html', 'order-history.html',
  ];

  const missing = [];
  for (const page of pages) {
    const source = fs.readFileSync(path.join(root, page), 'utf8');
    const usesFont = /class="fa[srb]? fa-/.test(source);
    const loadsFont = /fontawesome/.test(source);
    if (usesFont && !loadsFont) missing.push(page);
  }

  assert.deepEqual(
    missing,
    [],
    'these pages draw Font Awesome glyphs without loading it: ' + missing.join(', ')
  );
});
