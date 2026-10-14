import { test, expect } from "@playwright/test";
import { onTheMenu } from "./support/shop.js";
for (const width of [320, 900])
  test(`history opens orders directly, keeps filters and supports safe details at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    await onTheMenu(page, "nothing");
    const orders = [
      {
        _id: "o1",
        order_id: "A1",
        table_number: "1",
        status: "pending",
        total_amount: 40,
        created_at: "2026-09-30T12:00:00Z",
        items: [
          { name: "Coffee <large>", quantity: 1, price: 40, note: "No sugar" },
        ],
      },
      {
        _id: "o2",
        order_id: "A2",
        table_number: "2",
        status: "completed",
        total_amount: 90,
        items: [],
      },
    ];
    await page.route("**/sales/getOrderHistory", (r) =>
      r.fulfill({ json: { type: "success", data: { orders } } }),
    );
    await page.goto("/order-history.html");
    await expect(page.locator("#order-list-screen")).toBeVisible();
    await expect(page.locator("[data-view-order]")).toHaveCount(2);
    await expect(page.locator(".order-actions")).not.toBeVisible();

    await page.locator("#order-search").fill("A1");
    await expect(page.locator(".order-card")).toHaveCount(1);
    await page.locator("#refresh-btn").click();
    await expect(page.locator(".order-card")).toHaveCount(1);
    await page.locator("[data-view-order=o1]").click();
    await expect(page.locator("#order-details-content")).toContainText(
      "Coffee <large>",
    );
    await expect(page.locator("#order-details-content large")).toHaveCount(0);
    await expect(page.locator("#orderDetailsModal")).toHaveClass(/show/);
    await page.locator("#orderDetailsModal").evaluate(async (el) => {
      await Promise.all(
        el
          .getAnimations({ subtree: true })
          .map((a) => a.finished.catch(() => {})),
      );
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-artifacts/history-details-${width}.png`,
      fullPage: true,
    });
    await page
      .locator("#orderDetailsModal .modal-footer [data-bs-dismiss]")
      .click();
    await expect(page.locator("#orderDetailsModal")).toBeHidden();
    await expect(page.locator(".modal-backdrop")).toHaveCount(0);
    await expect(page.locator("#order-list-screen")).toBeVisible();
    await expect(page.locator("#order-search")).toHaveValue("A1");
    await page.screenshot({
      path: `test-artifacts/history-list-${width}.png`,
      fullPage: true,
    });
    await page.evaluate(() =>
      window.dispatchEvent(new Event("captain:back", { cancelable: true })),
    );
    await expect(page).toHaveURL(/kot-management.html$/);
  });

test("cart shares the menu note presets and preserves each item note separately", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await onTheMenu(page, "nothing");
  await page.locator('.dish[data-id="p-coffee"] .dish-add').click();
  await page.locator('.dish[data-id="p-dosa"] .dish-add').click();
  await page.locator("#next-btn").click();
  await expect(page).toHaveURL(/cart.html$/);
  await page.locator("#cart-item-p-coffee .bill-note-action").click();
  await page.locator('#cart-notes-chips [data-say="Less sweet"]').click();
  await expect(page.locator("#cart-notes-text")).toHaveValue("Less sweet");
  await expect(
    page.locator('#cart-notes-chips [data-say="Less sweet"]'),
  ).toHaveAttribute("aria-pressed", "true");
  await page.emulateMedia({ colorScheme: "dark" });
  expect(
    await page
      .locator("#cart-notes-modal")
      .evaluate((el) => el.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: "test-artifacts/cart-notes-dark-320.png",
    fullPage: true,
  });
  await page.locator("#cart-notes-save-btn").click();
  await expect(page.locator("#cart-item-p-coffee .bill-note")).toHaveText(
    "Less sweet",
  );
  await page.locator("#cart-item-p-dosa .bill-note-action").click();
  await expect(page.locator("#cart-notes-text")).toHaveValue("");
  await page.locator('#cart-notes-chips [data-say="Less salt"]').click();
  await page.locator("#cart-notes-save-btn").click();
  await expect(page.locator("#cart-item-p-dosa .bill-note")).toHaveText(
    "Less salt",
  );
  await expect(page.locator("#cart-item-p-coffee .bill-note")).toHaveText(
    "Less sweet",
  );
  await page.locator(".cart-add-items").click();
  await expect(page).toHaveURL(/products.html$/);
  await expect(page.locator("#cart-qty")).toHaveText("2");
});


test('history dates accept legacy timestamps and never display Invalid Date',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.route('**/sales/getOrderHistory',route=>route.fulfill({json:{type:'success',data:{orders:[
  {_id:'legacy-date',table_number:'8',status:'pending',total_amount:20,created_date:{$date:'2026-09-30T12:00:00Z'},items:[]},
  {_id:'missing-date',table_number:'9',status:'pending',total_amount:20,items:[]}
 ]}}}));
 await page.goto('/order-history.html');
 await expect(page.locator('.order-card')).toHaveCount(2);
 await expect(page.locator('[data-view-order=legacy-date]')).toContainText('2026');
 await expect(page.locator('[data-view-order=missing-date]')).toContainText('—');
 await expect(page.locator('#order-list-screen')).not.toContainText('Invalid Date');
 await page.locator('[data-view-order=legacy-date]').click();
 await expect(page.locator('#order-details-content time')).toContainText('2026');
 expect(await page.evaluate(()=>formatDateTime({$date:{$numberLong:'1790769600000'}}))).not.toBe('—');
 expect(await page.evaluate(()=>formatDateTime('malformed'))).toBe('—');
});
