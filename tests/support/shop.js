/*
 * A signed-in handset at a table, looking at a menu.
 *
 * WHY THIS IS SHARED. Two specs need the same journey, and a second copy of a
 * fixture always drifts - which is the exact mistake the menu rewrite found in
 * the app itself, where the ordinary list and the search results had been
 * written twice and quietly disagreed about discounts and stock counts.
 *
 * THE ROUTE IS WALKED, not jumped to. products.html reads state the pages
 * before it write - the branch, the table, the cart - and a handset that
 * arrives there without them shows an empty screen, which is exactly what a
 * shortcut here produced.
 */

import { expect } from '@playwright/test';

export const SHOP_ORIGIN = 'https://smoke.posnic.io';
export const API_BASE = `${SHOP_ORIGIN}/api`;

/* What a Posnic server says about itself. Discovery accepts nothing else. */
export const RUNTIME_INFO = {
  edition: 'cloud',
  mode: 'cloud',
  version: '1.0.0',
  channel: null,
  apiSchema: 1,
  syncProtocol: 1,
  features: { account: true, idempotentOrders: true },
};

export const item = (id, name, price, over = {}) => ({
  id,
  name,
  available_quantity: 50,
  negative_stock: false,
  price,
  final_price: price,
  discount_price: 0,
  tax_price: 0,
  img: '',
  ...over,
});

/** The menu a spec gets unless it asks for a different one. */
export const ONE_CATEGORY = [
  {
    category_name: 'Food',
    items: [
      item('p-biryani', 'Chicken Biryani', 220),
      item('p-coffee', 'Coffee', 40),
      item('p-dosa', 'Masala Dosa', 90),
    ],
  },
];

const responses = (products) => ({
  '/runtime-info': RUNTIME_INFO,
  '/captain/v1/takeaway-number': { number: 1 },
  '/users/kioskMobileLogin': {
    tokenType: 'Bearer',
    token: 'smoke-token',
    expiresIn: 86400,
    shopKey: 'smoke-shop-key',
    user: { id: 'user-1', name: 'smoke-user' },
    branches: [
      {
        branch_name: 'Main Branch',
        store_id: 'store-1',
        branch_id: 'branch-1',
        branch_image: 'store.png',
      },
    ],
  },
  '/items/accessQr': {
    type: 'success',
    data: { restaurant_service_v1: true, products, kiosk_images: {}, tableorders: [], kiosk_payment: {} },
  },
  '/sales/getTablesWithActiveOrders': { type: 'success', data: { tables: [] } },
  '/sales/getFrequentItems': { type: 'success', data: [] },
  '/sales/getListKot': { type: 'success', data: { orders: [] } },
  '/sales/getOrderHistory': { type: 'success', data: { orders: [] } },
});

/**
 * A handset signed in, at a table, looking at the menu.
 *
 * `heard` stubs the recogniser so it reports those words; pass nothing and the
 * stub is still installed, which keeps a headless browser from being asked for
 * a microphone it does not have.
 */
export async function onTheMenu(page, heard, options = {}) {
  const products = options.menu || ONE_CATEGORY;
  const table = responses(products);
  table['/items/accessQr'].data.restaurant_service_v1 = options.serviceControls !== false;

  await page.addInitScript(
    ({ url, heard }) => {
      localStorage.setItem('posnic.server', JSON.stringify({ pinned: url, active: url }));

      /* Stubbed before any page script runs, so the mic button is drawn as
         available and listening resolves without a microphone. */
      window.__voiceHeard = heard;

      /*
       * A recogniser that is HELD OPEN, like the real one now is: it reports
       * words while it runs and only ends when the page stops it. A stub that
       * ended by itself would pass a test the app cannot pass, because the
       * whole gesture is the page deciding when the order is finished.
       */
      function Recogniser() {
        this.start = () => {
          window.__voiceStarted = (window.__voiceStarted || 0) + 1;
          setTimeout(() => {
            if (this.onresult) {
              this.onresult({ results: [[{ transcript: window.__voiceHeard }]] });
            }
          }, 0);
        };
        this.stop = () => setTimeout(() => this.onend && this.onend(), 0);
        this.abort = () => {
          window.__voiceAborted = (window.__voiceAborted || 0) + 1;
          this.stop();
        };
      }
      /* BOTH names. Chromium defines the unprefixed SpeechRecognition as well
         as the webkit one, and speech.js reads the unprefixed first - so
         replacing only the prefixed name leaves the real recogniser in charge
         and the test asks a headless browser for a microphone. */
      for (const name of ['SpeechRecognition', 'webkitSpeechRecognition']) {
        Object.defineProperty(window, name, { configurable: true, value: Recogniser });
      }
    },
    { url: API_BASE, heard }
  );

  await page.route(`${SHOP_ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(table[path] || (path === '/items/instantItemTax' ? {type:'success',data:{id:'test-zero-tax',name:'Tax',rate:0,type:'exclusive'}} : null) || { type: 'success', data: {} }),
    });
  });

  await page.goto('/index.html');
  await page.locator('#username').fill('smoke-user');
  await page.locator('#password').fill('smoke-password');
  await page.locator('#login-btn').click();

  /* One branch, so the app chooses it rather than asking. basic-flow.spec.js
     covers the picker; this needs a handset at a table. */
  await expect(page).toHaveURL(/kot-management\.html$/);

  await page.waitForFunction(() => typeof window.goToAddKot === 'function');
  /* The floor screen's one named action. It was .kot-btn-add, one of four
     buttons of equal weight; only one of them was ever what somebody came
     here to do. */
  await page.locator('.floor-new').click();
  await expect(page).toHaveURL(/discount\.html$/);
  await page.locator('#manual_table_input').fill('T1');
  /*
   * BY THE CLASS, NOT BY THE WORD ON IT.
   *
   * This read `getByRole('button', { name: /Next/ })` until the app learned
   * Tamil, and then every test that walks the app in Tamil stalled here: the
   * button now says அடுத்து and the walk could not find it. The screen was
   * right and the harness was wrong.
   *
   * A test that navigates by display text quietly forbids translating that
   * text, which is a veto nobody voted for.
   *
   * By what the button DOES, not by its class either: `.btn-next` is on the
   * Back button as well, so it matches two things and neither reading is
   * wrong. The action is the one unambiguous thing about this button.
   */
  await page.locator('[onclick*="goToProductsWithTableCheck"]').click();

  await expect(page).toHaveURL(/products\.html$/);
  await expect(page.locator('.dish').first()).toBeVisible();
}
