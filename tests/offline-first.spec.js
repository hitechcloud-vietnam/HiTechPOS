import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/* Playwright runs these through a CommonJS transform, where import.meta is a
   syntax error. The runner starts in the project root. */
const ROOT = process.cwd();

/*
 * The app has to work on a shop's Wi-Fi with the internet down.
 *
 * That is the whole reason it prefers the till over the cloud address, and a
 * single <script src="https://cdn..."> undoes it: Bootstrap's JS drives every
 * modal on the KOT and order-history screens - the edit dialog, the update
 * dialog, both confirmations - so with no internet those buttons did nothing
 * at all, on the two screens the kitchen uses most.
 *
 * Read from the source rather than the browser: a page that fetched a CDN and
 * happened to have it cached would pass a runtime check.
 */
const EXTERNAL = /(?:src|href)\s*=\s*["']https?:\/\//i;

test('no page loads code or styles from the internet', () => {
  const offenders = [];
  for (const file of fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const line of html.split('\n')) {
      /* Only <script> and <link> actually block the page. An <a href> to a
         website is a link somebody may tap, not a dependency. */
      if (!/<(script|link)\b/i.test(line)) continue;
      if (EXTERNAL.test(line)) offenders.push(`${file}: ${line.trim()}`);
    }
  }
  expect(offenders, 'these would fail with the shop internet down').toEqual([]);
});

test('the vendored Bootstrap matches the stylesheet it drives', () => {
  /*
   * The CSS here is 5.3; the copy sitting in the desktop app is 4.3, and
   * Bootstrap 4 JS does not open a Bootstrap 5 modal - the data attributes
   * were renamed. Grabbing the nearest local copy would have looked right and
   * silently broken every dialog.
   */
  const css = fs.readFileSync(path.join(ROOT, 'assets', 'bootstrap.min.css'), 'utf8').slice(0, 400);
  const js = fs.readFileSync(
    path.join(ROOT, 'assets', 'vendor', 'bootstrap', 'bootstrap.bundle.min.js'), 'utf8').slice(0, 400);

  const major = (text) => (text.match(/Bootstrap\s+v?(\d+)\./i) || [])[1];
  expect(major(js)).toBe(major(css));
});
