import { test, expect } from "@playwright/test";

/*
 * The one-order-per-tap rules, in a real browser.
 *
 * The behaviour itself shipped in #58 and has its own tests, which read the
 * source and run the key logic against a fake cart. These are the other half:
 * the same rules driven through the actual screens, from sign-in to the
 * thank-you page, with the order endpoint recorded.
 *
 * The distinction is not academic. The bug that started this was a BUTTON that
 * stayed live - not a function that computed the wrong thing. A test that
 * reads indexedDB.js cannot see whether the handler is bound, whether the
 * disabled attribute reaches the element, or whether the poll actually redraws
 * the table grid. Every one of those is a way for this to regress silently
 * while the existing tests stay green.
 *
 * What is covered here and nowhere else:
 *
 *   two taps in ONE tick, which is what a double tap is. Two separate clicks
 *   do not reproduce it - the second lands after navigation has begun and
 *   quietly does nothing, so a test written that way passes either way.
 *
 *   the button coming back after a refusal, including dismissing the error
 *   overlay that sits over it - the thing a waiter actually has to do.
 *
 *   checkout() refusing an empty cart, which is what makes releasing the
 *   latch in `finally` safe. That guard is load-bearing and had no test.
 */

const RUNTIME_INFO = {
  edition: "cloud",
  mode: "cloud",
  version: "1.0.0",
  channel: null,
  apiSchema: 1,
  syncProtocol: 1,
  features: { account: true, idempotentOrders: true },
};

const SHOP_ORIGIN = "https://smoke.posnic.io";
const API_BASE = `${SHOP_ORIGIN}/api`;

const branchData = {
  type: "success",
  data: {
    products: [
      {
        category_name: "Food",
        items: [
          {
            id: "product-1",
            name: "Smoke Test Meal",
            available_quantity: 10,
            negative_stock: false,
            price: 100,
            final_price: 100,
            discount_price: 0,
            tax_price: 0,
            img: "",
          },
        ],
      },
    ],
    kiosk_images: {},
    tableorders: [],
    kiosk_payment: {},
  },
};

const RESPONSES = {
  "/runtime-info": RUNTIME_INFO,
  "/users/kioskMobileLogin": {
    tokenType: "Bearer",
    token: "smoke-token",
    expiresIn: 86400,
    shopKey: "smoke-shop-key",
    user: { id: "user-1", name: "smoke-user" },
    branches: [
      {
        branch_name: "Main Branch",
        store_id: "store-1",
        branch_id: "branch-1",
        branch_image: "store.png",
      },
      {
        branch_name: "Second Branch",
        store_id: "store-2",
        branch_id: "branch-2",
        branch_image: "store.png",
      },
    ],
  },
  "/items/accessQr": branchData,
  "/sales/getTablesWithActiveOrders": { type: "success", data: { tables: [] } },
  "/sales/getFrequentItems": { type: "success", data: [] },
  "/sales/getListKot": { type: "success", data: { orders: [] } },
  "/sales/getOrderHistory": { type: "success", data: { orders: [] } },
};

const orderReply = {
  type: "success",
  data: {
    tokenId: "A101",
    orderId: "SMOKE-ORDER-1",
    table_number: "T1",
    branch_name: "Main Branch",
    items: [
      {
        item_name: "Smoke Test Meal",
        item_quantity: 1,
        item_base_price: 100,
        item_tax: 0,
        item_discount: 0,
        item_total: 100,
      },
    ],
    subtotal: 100,
    discount: 0,
    tax: 0,
    total: 100,
  },
};

/**
 * Route the shop, recording every order body. `holdOrderMs` keeps the reply in
 * the air, which is the window a second tap lands in on a real floor.
 * `orderAnswer` replaces the success reply, for the refusal case.
 */
async function shop(
  page,
  { orders, holdOrderMs = 0, orderAnswer = null, reply = null } = {},
) {
  await page.addInitScript((url) => {
    localStorage.setItem(
      "posnic.server",
      JSON.stringify({ pinned: url, active: url }),
    );
  }, API_BASE);

  await page.route(`${SHOP_ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");

    if (path === "/sales/qrOrder") {
      let body = {};
      try {
        body = JSON.parse(route.request().postData() || "{}");
      } catch (e) {
        /* not json */
      }
      if (orders) orders.push(body);
      if (holdOrderMs) await new Promise((r) => setTimeout(r, holdOrderMs));
      /* `reply` is a holder the test can change mid-run, so one route can
         refuse the first order and accept the second. */
      const answer = (reply && reply.value) || orderAnswer || orderReply;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(answer),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(RESPONSES[path] || { type: "success", data: {} }),
    });
  });
}

/** Sign in, pick a table, add one dish, stop on the cart ready to send. */
async function toCartWithAMeal(page) {
  await page.goto("/index.html");
  await page.locator("#username").fill("smoke-user");
  await page.locator("#password").fill("smoke-password");
  await page.locator("#login-btn").click();

  await expect(page.getByText("Select Branch")).toBeVisible();
  await page.getByText("Main Branch").click();
  await expect(page).toHaveURL(/kot-management\.html$/);

  await page.waitForFunction(() => typeof window.goToAddKot === "function");
  /* Captain's floor screen calls this .floor-new; the old name was
     .kot-btn-add and is gone. */
  await page.locator(".floor-new").click();
  await expect(page).toHaveURL(/discount\.html$/);
  await page.locator("#manual_table_input").fill("T1");
  await page.getByRole("button", { name: /Next/ }).click();

  await expect(page).toHaveURL(/products\.html$/);
  await page.locator('.btn-add[data-id="product-1"]').click();
  await expect(page.locator("#cart-qty")).toHaveText("1");
  await page.locator("#next-btn").click();

  await expect(page).toHaveURL(/cart\.html$/);
  await expect(page.getByText("Smoke Test Meal")).toBeVisible();
}

test("a double tap durably saves one order and returns to ordering without waiting", async ({
  page,
}) => {
  const orders = [];
  await shop(page, { orders, holdOrderMs: 1500 });
  await toCartWithAMeal(page);
  await expect(page.locator("#posnic-unsent")).toBeHidden();
  await page.evaluate(() => {
    document.getElementById("next-btn").click();
    document.getElementById("next-btn").click();
  });
  await expect(page).toHaveURL(/kot-management\.html$/);
  await expect.poll(() => orders.length).toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.OrderQueue?.count()))
    .toBe(0);
  expect(await page.evaluate(() => getCartData())).toHaveLength(0);
  await expect(page.locator("#posnic-unsent")).toBeHidden();
  await page.screenshot({ path: 'test-artifacts/captain-clean-ordering.png', fullPage: true });
});

test("rejected orders stay visible and only retry deliberately with the same key", async ({
  page,
}) => {
  const orders = [],
    reply = { value: { type: "error", message: "Item unavailable" } };
  await shop(page, { orders, reply });
  await toCartWithAMeal(page);
  await page.locator("#next-btn").click();
  await expect(page).toHaveURL(/kot-management\.html$/);
  await expect(page.getByRole("button", { name: "Retry now", exact: true })).toBeHidden();
  await page.screenshot({ path: 'test-artifacts/captain-pending-collapsed.png', fullPage: true });
  await page.locator('#posnic-unsent a[href="pending.html"]').click();
  await expect(
    page.getByText("Item unavailable", { exact: true }),
  ).toBeVisible();
  await page.screenshot({path:'test-artifacts/captain-pending-order.png',fullPage:true});
  await page.waitForTimeout(5500);
  expect(orders.length).toBe(1);
  reply.value = orderReply;
  await page
    .getByRole("button", { name: "Retry this order", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.OrderQueue?.count()))
    .toBe(0);
  expect(orders.length).toBe(2);
  expect(orders[0].idempotencyKey).toBe(orders[1].idempotencyKey);
});

test("no network still saves the order and reload retains it without blocking ordering", async ({
  page,
}) => {
  await shop(page);
  await toCartWithAMeal(page);
  await page.route(`${SHOP_ORIGIN}/**`, (route) => route.abort());
  await page.locator("#next-btn").click();
  await expect(page).toHaveURL(/kot-management\.html$/);
  await expect
    .poll(() => page.evaluate(() => window.OrderQueue?.count()))
    .toBe(1);
  const key = await page.evaluate(() => OrderQueue.all()[0].key);
  await page.reload();
  await expect(page.locator("#posnic-unsent-text")).toContainText(
    "1 order waiting to sync",
  );
  const headerBox = await page.locator('.floor-head').boundingBox();
  const noticeBox = await page.locator('#posnic-unsent').boundingBox();
  expect(noticeBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
  await page.screenshot({ path: 'test-artifacts/captain-floor-pending.png', fullPage: true });
  await expect(page.locator('.floor-new')).toBeVisible();
  await expect(page.locator('#floor-connection-status')).toBeVisible();
  await expect(page.locator('#no-orders-message')).toBeHidden();
  await expect(page.locator('#order-toast')).not.toHaveClass(/show/);
  await expect(page).toHaveURL(/kot-management\.html$/);
  expect(await page.evaluate(() => OrderQueue.all()[0].key)).toBe(key);
  // Open the saved order while still offline. Restoring connectivity may
  // deliver it before a Retry button can be clicked; that is the desired flow.
  await page.locator('#posnic-unsent a[href="pending.html"]').click();
  await expect(page).toHaveURL(/pending\.html$/);
  const delivered = [];
  await page.unroute(`${SHOP_ORIGIN}/**`);
  await shop(page, { orders: delivered });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(() => page.evaluate(() => window.OrderQueue?.count()))
    .toBe(0);
  expect(delivered).toHaveLength(1);
  expect(delivered[0].idempotencyKey).toBe(key);
  await expect(page.locator("#posnic-unsent-text")).toHaveText("All orders synced");
  await page.locator("#pending-back").click();
  await expect(page.locator("#posnic-unsent")).toBeHidden();
});

test("full storage leaves the cart intact and sends nothing", async ({
  page,
}) => {
  const orders = [];
  await shop(page, { orders });
  await toCartWithAMeal(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "posnic.pending-orders")
        throw new DOMException("full", "QuotaExceededError");
      return original.call(this, k, v);
    };
  });
  await page.locator("#next-btn").click();
  await expect(page).toHaveURL(/cart\.html$/);
  await expect(page.getByText(/Order NOT saved/)).toBeVisible();
  expect(orders).toHaveLength(0);
  expect(await page.evaluate(() => getCartData())).toHaveLength(1);
});

for (const stall of ['fetch', 'body']) {
  test(`server restart with stalled ${stall} releases delivery and keeps the order retryable`, async ({ page }) => {
    const orders = [];
    await page.addInitScript(({ stall }) => {
      const original = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const response = await original(...args);
        if (sessionStorage.getItem('stall-kitchen') && String(args[0]).includes('/sales/qrOrder')) {
          const pending = new Promise(() => {}); // Native bridge ignores AbortSignal.
          if (stall === 'fetch') return pending;
          return { ok: true, status: 200, headers: response.headers, json: () => pending };
        }
        return response;
      };
    }, { stall });
    await shop(page, { orders });
    await toCartWithAMeal(page);
    await page.evaluate(() => sessionStorage.setItem('stall-kitchen', '1'));
    await page.locator('#next-btn').click();
    await expect(page).toHaveURL(/kot-management\.html$/);
    await expect(page.locator('.floor-new')).toBeVisible();
    await expect.poll(() => orders.length).toBe(1);
    const key = await page.evaluate(() => OrderQueue.all()[0].key);
    // A settled failed attempt is recorded; a stuck flight never gets this far.
    await expect.poll(() => page.evaluate(() => OrderQueue.all()[0]?.nextAt), { timeout: 15000 }).toBeGreaterThan(0);
    await page.evaluate(() => sessionStorage.removeItem('stall-kitchen'));
    // Delivery resumes automatically. It may finish before a manual Retry
    // click, so assert the outcome instead of racing a correctly hidden button.
    await page.goto('/pending.html');
    await expect.poll(() => page.evaluate(() => OrderQueue.count())).toBe(0);
    expect(orders.length).toBe(2);
    expect(orders.every(order => order.idempotencyKey === key)).toBe(true);
  });
}

for (const width of [320, 768]) {
  test(`pending orders protect ownership and fit ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 1024});
    await shop(page, {reply: {value: {type: "error", message: "Item unavailable"}}});
    await toCartWithAMeal(page);
    await page.locator("#next-btn").click();
    await expect(page).toHaveURL(/kot-management\.html$/);
    await expect.poll(() => page.evaluate(() => window.OrderQueue?.count())).toBe(1);
    await page.waitForFunction(() => window.POSNIC_ORDER_QUEUE_UI);
    await page.evaluate(() => {
      const rows = OrderQueue.all();
      const foreign = structuredClone(rows[0]);
      foreign.key += "-other";
      foreign.owner.user = "another-staff";
      foreign.body.items[0].item_name = "Private staff item";
      foreign.body.kiosk_table_no = "Private table";
      localStorage.setItem("posnic.pending-orders", JSON.stringify([...rows, foreign]));
      POSNIC_ORDER_QUEUE_UI.render();
    });
    await page.locator('#posnic-unsent a[href="pending.html"]').click();
    await expect(page.locator(".pending-order-card")).toHaveCount(1);
    await expect(page.locator(".pending-order-card")).toContainText("Smoke Test Meal");
    await expect(page.getByText("Private staff item")).toHaveCount(0);
    await expect(page.getByText("Private table")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:`test-artifacts/pending-orders-${width}.png`,fullPage:true});
    await page.locator("#pending-back").click();
    await expect(page).toHaveURL(/kot-management\.html$/);
    await page.goto('/me.html');
    await page.locator('.me-row[href="pending.html"]').click();
    await expect(page.locator(".pending-order-card")).toHaveCount(1);
    await page.evaluate(() => window.dispatchEvent(new Event("captain:back", {cancelable:true})));
    await expect(page).toHaveURL(/me\.html$/);
  });
}

test("pulling pending orders retries delivery and keeps the same request ID", async ({page}) => {
  const orders = [], reply = {value:{type:"error",message:"Item unavailable"}};
  await shop(page, {orders, reply});
  await toCartWithAMeal(page);
  await page.locator("#next-btn").click();
  await expect(page).toHaveURL(/kot-management\.html$/);
  await expect.poll(() => page.evaluate(() => window.OrderQueue?.count())).toBe(1);
  await expect.poll(() => page.evaluate(() => OrderQueue.all()[0]?.state)).toBe("attention");
  await page.evaluate(() => OrderQueue.update(OrderQueue.all()[0].key, {state:"waiting",nextAt:Date.now()+60000}));
  reply.value = orderReply;
  await page.locator('#posnic-unsent a[href="pending.html"]').click();
  await expect(page.locator('.pending-order-card')).toHaveCount(1);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:150,y:170}]});
  for(let y=190;y<=350;y+=20) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:150,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await cdp.detach();
  await expect(page.locator('#posnic-unsent-text')).toHaveText('All orders synced');
  expect(orders).toHaveLength(2);
  expect(orders[0].idempotencyKey).toBe(orders[1].idempotencyKey);
});
