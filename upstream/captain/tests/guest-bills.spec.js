import { test, expect } from "@playwright/test";
import { onTheMenu } from "./support/shop.js";
const snapshot = {
  table: "T1",
  revision: "v1",
  currency: "₹",
  totalMinor: 10001,
  guests: 2,
  labels: { base: "Subtotal", "tax:Tax": "Tax" },
  lines: [
    {
      id: "one",
      name: "Soup",
      quantity: 2,
      amountMinor: 3001,
      components: [
        { key: "base", minor: 2801 },
        { key: "tax:Tax", minor: 200 },
      ],
    },
    {
      id: "two",
      name: "Main dish",
      quantity: 1,
      amountMinor: 7000,
      components: [
        { key: "base", minor: 6000 },
        { key: "tax:Tax", minor: 1000 },
      ],
    },
  ],
};
async function setup(page) {
  await onTheMenu(page, "nothing");
  await page.route("**/sales/getTablesWithActiveOrders", (r) =>
    r.fulfill({
      json: {
        type: "success",
        data: {
          tables: [{ table_number: "T1", order_count: 1, total: 100.01 }],
        },
      },
    }),
  );
  await page.route("**/sales/getListKot**", (r) =>
    r.fulfill({
      json: {
        type: "success",
        data: {
          list: [
            {
              _id: "o1",
              sales_id: "K1",
              table_number: "T1",
              person_count: 2,
              sales_total: 100.01,
              items: [{ item_name: "Soup", item_quantity: 2, item_price: 15 }],
            },
          ],
        },
      },
    }),
  );
  await page.route("**/sales/guestBills/table?**", (r) =>
    r.fulfill({ json: { type: "success", data: snapshot } }),
  );
  const posts = [];
  await page.route("**/sales/guestBills/print", (r) => {
    posts.push(r.request().postDataJSON());
    return r.fulfill({ json: { type: "success", data: { queued: true } } });
  });
  await page.goto("/kot-management.html");
  await page.waitForFunction(() => typeof selectTable === "function");
  await page.evaluate(() => selectTable("T1", false));
  await page.locator('[data-split-table="T1"]').click();
  await expect(page.locator("#guest-bills [data-action=next]")).toBeEnabled();
  return posts;
}
const next = (page) => page.locator("#guest-bills [data-action=next]").click();
test("equal guest bills preview the exact total and send once without settling the order", async ({
  page,
}) => {
  const posts = await setup(page);
  await page.locator("#guest-bills [data-action=more]").click();
  await next(page);
  await expect(page.locator(".guest-bill-review b")).toHaveText([
    "₹33.34",
    "₹33.34",
    "₹33.33",
  ]);
  await expect(page.locator(".guest-bill-total")).toContainText("₹100.01");
  await page.screenshot({
    path: "test-artifacts/equal-guest-bills.png",
    fullPage: true,
  });
  await next(page);
  await expect(page.locator("#guest-bills")).not.toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0].plan).toMatchObject({
    mode: "equal",
    guests: ["Guest 1", "Guest 2", "Guest 3"],
  });
  expect(posts[0]).not.toHaveProperty("payment_status");
});
test("items can be assigned individually or shared and nothing unassigned can be sent", async ({
  page,
}) => {
  const posts = await setup(page);
  await page.locator("input[value=items]").check();
  await next(page);
  await expect(page.locator("#guest-bills [data-action=next]")).toBeDisabled();
  await page.locator("select[data-line=one]").selectOption("0");
  await page.locator("select[data-line=two]").selectOption("1");
  await page.locator(".guest-bill-line").nth(1).locator("summary").click();
  await page.locator("[data-action=share-all][data-line-id=two]").click();
  await next(page);
  await expect(page.locator(".guest-bill-review b")).toHaveText([
    "₹65.01",
    "₹35.00",
  ]);
  await next(page);
  expect(posts[0].plan.allocations).toEqual({ one: [1, 0], two: [1, 1] });
});
test("an uncertain response retries the same immutable print request", async ({
  page,
}) => {
  await setup(page);
  const posts = [];
  await page.route("**/sales/guestBills/print", (r) => {
    posts.push(r.request().postDataJSON());
    return r.fulfill({
      status: posts.length === 1 ? 503 : 200,
      json:
        posts.length === 1
          ? { type: "error", message: "Temporary problem" }
          : { type: "success", data: { queued: true } },
    });
  });
  await next(page);
  await next(page);
  await expect(page.locator(".guest-bill-error")).toContainText(
    "Could not confirm",
  );
  await next(page);
  expect(posts).toHaveLength(2);
  expect(posts[0]).toEqual(posts[1]);
});
test("a changed table requires a fresh split and never reports printing success", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/sales/guestBills/print", (r) =>
    r.fulfill({
      status: 409,
      json: { type: "error", message: "The table changed" },
    }),
  );
  await page.route("**/sales/guestBills/table?**", (r) =>
    r.fulfill({
      json: { type: "success", data: { ...snapshot, revision: "v2" } },
    }),
  );
  await next(page);
  await next(page);
  await expect(page.locator(".guest-bill-error")).toContainText(
    "table changed",
  );
  await expect(page.locator(".guest-bill-modes")).toBeVisible();
});
test("Cancel keeps a prepared split available offline and leaves the floor usable", async ({
  page,
}) => {
  await setup(page);
  await next(page);
  await page.locator("#guest-bills footer [data-action=close]").click();
  await expect(page.locator("#guest-bills")).not.toBeVisible();
  await page.route("**/sales/guestBills/table?**", (r) =>
    r.fulfill({ status: 503, json: { message: "Offline" } }),
  );
  await page.locator('[data-split-table="T1"]').click();
  await expect(page.locator(".guest-bill-error")).toContainText("Offline.");
  await expect(page.locator(".guest-bill-review")).toHaveCount(2);
  await page.locator("#guest-bills header [data-action=close]").click();
  await expect(page.locator("#guest-bills")).not.toBeVisible();
});

for (const code of ["ta", "ur"]) {
  test(`split-bill controls work on a narrow phone in ${code}`, async ({
    page,
  }) => {
    await page.addInitScript(
      (code) => localStorage.setItem("posnic.language", code),
      code,
    );
    await page.setViewportSize({ width: 320, height: 740 });
    await setup(page);
    const words = await page.evaluate(() => I18N.t("Split bill"));
    await expect(page.locator("#guest-bills h2")).toHaveText(words);
    await next(page);
    expect(
      await page
        .locator("#guest-bills")
        .evaluate((el) => el.scrollWidth <= innerWidth),
    ).toBe(true);
    const box = await page
      .locator("#guest-bills [data-action=next]")
      .boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(740);
    await page.screenshot({
      path: `test-artifacts/guest-bills-${code}.png`,
      fullPage: true,
    });
  });
}

test('same-shop route switching retains a prepared split; another staff member cannot send it', async ({page}) => {
  const posts=await setup(page);
  await page.locator('#guest-bills [data-action=more]').click();
  await next(page);
  await page.locator('#guest-bills header [data-action=close]').click();
  await page.evaluate(()=>Object.defineProperty(POSNIC.session,'base',{configurable:true,get:()=> 'https://backup.posnic.io/api'}));
  await page.evaluate(()=>GuestBills.open('T1'));
  await expect(page.locator('.guest-bill-review')).toHaveCount(3);
  await page.evaluate(()=>Object.defineProperty(POSNIC.session,'user',{configurable:true,get:()=>({id:'another-staff'})}));
  await next(page);
  await expect(page.locator('#guest-bills')).toBeHidden();
  expect(posts).toHaveLength(0);
  await page.evaluate(()=>GuestBills.open('T1'));
  await expect(page.locator('.guest-bill-modes')).toBeVisible();
  await next(page);
  await expect(page.locator('.guest-bill-review')).toHaveCount(2);
});

test('native Back from split review returns to split setup without dismissing the order beneath it', async ({page})=>{
  await setup(page);
  await next(page);
  await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
  await expect(page.locator('.guest-bill-modes')).toBeVisible();
  await expect(page.locator('#guest-bills')).toBeVisible();
});

test('an uncertain guest-bill print stays with its issuing server across route changes', async ({page}) => {
  await setup(page);
  const issuer = await page.evaluate(() => POSNIC.session.base || POSNIC.server.baseUrl);
  const posts = [];
  await page.route('**/sales/guestBills/print', route => {
    posts.push(route.request().postDataJSON());
    return route.fulfill({status: posts.length === 1 ? 503 : 200, json: posts.length === 1 ? {type:'error',message:'Lost acknowledgement'} : {type:'success',data:{queued:true}}});
  });
  await next(page);
  await next(page);
  await expect(page.locator('.guest-bill-error')).toContainText('Could not confirm');
  await page.locator('#guest-bills header [data-action=close]').click();
  await page.evaluate(() => Object.defineProperty(POSNIC.session,'base',{configurable:true,get:()=> 'https://backup.posnic.io/api'}));
  await page.evaluate(() => GuestBills.open('T1'));
  await next(page);
  await expect(page.locator('.guest-bill-error')).toContainText('Reconnect to the server that authorized');
  expect(posts).toHaveLength(1);
  await page.evaluate(base => Object.defineProperty(POSNIC.session,'base',{configurable:true,get:()=>base}), issuer);
  await next(page);
  await expect(page.locator('#guest-bills')).toBeHidden();
  expect(posts).toHaveLength(2);
  expect(posts[0]).toEqual(posts[1]);
});
