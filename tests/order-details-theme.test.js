'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const root = path.join(__dirname, '..');
const screenshots = path.join(root, 'test-results', 'order-details-theme');

test('order details remain readable in both phone themes, including a live theme change', async () => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('https://captain.test/**', async route => {
      const name = new URL(route.request().url()).pathname.slice(1);
      const file = path.resolve(root, name);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.abort();
      let body = fs.readFileSync(file);
      if (name.endsWith('.html')) body = body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      await route.fulfill({ body, contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'application/octet-stream' });
    });
    await page.goto('https://captain.test/order-history.html');
    const script = fs.readFileSync(path.join(root, 'assets/order-history/script.js'), 'utf8');
    const start = script.indexOf('function viewOrderDetails(');
    const end = script.indexOf('\n// Edit order', start);
    assert.ok(start >= 0 && end > start);
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'assets/common/money.js'), 'utf8') });
    const cancelledStart = script.indexOf('function lineIsCancelled(');
    const struckStart = script.indexOf('function struck(');
    const struckEnd = script.indexOf('\n}', struckStart) + 2;
    await page.addScriptTag({ content: script.slice(cancelledStart, struckEnd) });
    await page.evaluate(source => {
      window.currentOrderId = null;
      window.formatDateTime = () => '01 Oct, 13:00';
      window.allOrders = [{ _id: 'sample', order_id: 'KOT-126', table_number: '8', status: 'pending', customer_name: 'Walk-in', person_count: 2, items: [{ name: 'Chicken Fried Rice', quantity: 1, price: 250, notes: 'Less spicy' }], tax: 12.5, total_amount: 262.5, discount_description: 'Serve together' }];
      (0, eval)(source);
      window.viewOrderDetails('sample');
      document.getElementById('page-loader').remove();
      const modal = document.getElementById('orderDetailsModal');
      modal.classList.add('show');
      modal.style.display = 'block';
    }, script.slice(start, end));
    for (const colorScheme of ['light', 'dark', 'light']) {
      await page.emulateMedia({ colorScheme });
      for (const selector of ['.modal-title', '.history-detail-context h2', '.history-detail-context p', '.history-detail-items strong', '.history-detail-items small', '.history-detail-totals dt', '.history-detail-totals dd', '.history-detail-note p', '#edit-order-btn', '.close-btn']) {
        const contrast = await page.locator('#orderDetailsModal').locator(selector).first().evaluate(el => {
          const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
          const luminance = values => values.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
          const fg = luminance(rgb(getComputedStyle(el).color));
          let parent = el;
          while (parent && ['rgba(0, 0, 0, 0)', 'transparent'].includes(getComputedStyle(parent).backgroundColor)) parent = parent.parentElement;
          const bg = luminance(rgb(getComputedStyle(parent || document.body).backgroundColor));
          return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
        });
        assert.ok(contrast >= 4.5, `${colorScheme} ${selector}: contrast ${contrast}`);
      }
      fs.mkdirSync(screenshots, { recursive: true });
      await page.screenshot({ path: path.join(screenshots, `order-details-${colorScheme}.png`), fullPage: true });
    }
    await page.emulateMedia({ colorScheme: 'dark' });
    for (const status of ['completed', 'cancelled']) {
      await page.evaluate(value => { allOrders[0].status = value; viewOrderDetails('sample'); }, status);
      assert.equal(await page.locator('.history-detail-context p').nth(1).locator('span').textContent(), status);
      assert.equal(await page.locator('#edit-order-btn').isVisible(), false);
    }
  } finally { await browser.close(); }
});
