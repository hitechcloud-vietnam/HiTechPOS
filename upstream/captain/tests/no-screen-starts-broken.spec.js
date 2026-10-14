import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';

/*
 * NO SCREEN STARTS BROKEN.
 *
 * The cart and the discount screen threw "MenuScreen is not defined" on the
 * first line of their startup for five days. Every test passed the whole
 * time. It was found by eye, in a wall of web server output that scrolls past
 * during an unrelated run, which is not a way of finding anything.
 *
 * The reason it hid so well: the handler is async, so the throw became an
 * unhandled rejection shown to nobody, and both screens carried on using
 * their fallbacks. A screen missing half its startup looks exactly like a
 * screen that started.
 *
 * So this walks into every page this app has and asserts it started without
 * throwing. It knows nothing about any of them, which is the point - a test
 * that has to be taught about a screen is a test somebody has to remember to
 * teach, and the next shared script loaded on a page that lacks one of its
 * globals will be found here rather than in a log six months later.
 *
 * It is a smoke test and says so: it proves a page came up, never that it is
 * right. The screens' own tests do that.
 */

/* Every page in the app, which is every entry vite builds. If a page is added
   without a line here it is not covered, so the last test holds that too. */
const SCREENS = [
  'index.html',
  'products.html',
  'cart.html',
  'discount.html',
  'kot-management.html',
  'order-history.html',
  'number-card.html',
  'me.html',
  'my-sales.html',
  'thankyou.html',
  'access-denied.html',
  'branch-details.html',
  'help.html',
  'kitchen-message.html',
  'payment-settings.html',
  'pending.html',
  'tables.html',
];

/** Everything the page threw on its way up, however it was thrown. */
function watchForThrows(page) {
  const thrown = [];

  /* An uncaught exception. */
  page.on('pageerror', (error) => thrown.push(String(error)));

  /*
   * And a rejected promise nobody handled, which is the shape this class of
   * bug actually takes: every startup handler in this app is async, so a
   * throw inside one never reaches pageerror.
   */
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const said = message.text();
    if (/unhandled|rejection|is not defined|is not a function|cannot read/i.test(said)) {
      thrown.push(said);
    }
  });

  return thrown;
}

for (const screen of SCREENS) {
  test(`${screen} comes up without throwing`, async ({ page }) => {
    /* A shop, a menu and a table, because a screen that has never been set up
       is allowed to complain and that is not what this is looking for. */
    await onTheMenu(page, 'nothing');

    /*
     * LISTENING STARTS HERE, after the walk and not before it.
     *
     * Attached earlier, this collected whatever the pages walked through on
     * the way here threw, and then reported it against the page under test.
     * Every screen failed for one screen's bug, which points at the wrong
     * file and is worse than not failing: the first run of this test with the
     * old code blamed index.html for something in cart.html.
     */
    const thrown = watchForThrows(page);

    await page.goto(`/${screen}`);
    await page.waitForLoadState('domcontentloaded');

    /*
     * Startup is asynchronous everywhere here, so the page has to be given
     * the moment it needs to throw. Waiting on the network going quiet is the
     * closest thing to "it has finished starting" that holds for nine screens
     * that share nothing else.
     */
    // Polling screens remain active after startup. Bound this settling window
    // while continuing to collect every script error, including async errors.
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    expect(thrown, `${screen} threw on startup`).toEqual([]);
  });
}

test('every page in the app is on the list', () => {
  /*
   * A screen added without a line above would be uncovered and nobody would
   * know. The build's own entry points are the list that cannot be forgotten,
   * because a page missing from those does not ship at all.
   */
  const config = fs.readFileSync(path.join(process.cwd(), 'vite.config.mjs'), 'utf8');

  const built = [...config.matchAll(/ROOT,\s*'([\w-]+\.html)'\)/g)].map((m) => m[1]).sort();

  expect(built.length).toBeGreaterThan(0);
  expect([...SCREENS].sort()).toEqual(built);
});
