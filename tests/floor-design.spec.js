import { test, expect } from "@playwright/test";
import { onTheMenu } from "./support/shop.js";
for (const width of [320, 768])
  test(`floor filters use current kitchen status and table metadata at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await onTheMenu(page, "nothing");
    let fail = false;
    await page.route("**/sales/getTablesWithActiveOrders", (r) =>
      r.fulfill({
        json: {
          type: "success",
          data: {
            tables: ["1", "2"],
            table_details: [
              { table_number: "1", orders: 1 },
              { table_number: "2", orders: 1 },
            ],
          },
        },
      }),
    );
    await page.route("**/captain/v1/tables", (r) =>
      r.fulfill({
        json: {
          tables: [
            {
              id: "one",
              tableorder_value: "1",
              area: "Main",
              capacity: 4,
              shape: "round",
              status: "occupied",
            },
            {
              id: "two",
              tableorder_value: "2",
              area: "Patio",
              capacity: 2,
              shape: "square",
              status: "occupied",
            },
            {
              id: "three",
              tableorder_value: "3",
              area: "Main",
              capacity: 6,
              shape: "rectangle",
              status: "cleaning",
            },
          ],
        },
      }),
    );
    await page.route("**/captain/v1/kitchen-ready", (r) =>
      fail
        ? r.fulfill({ status: 503, json: { message: "Unavailable" } })
        : r.fulfill({
            json: {
              tickets: [{ table: "2", items: [{ ready: 1, served: 0 }] }],
            },
          }),
    );
    await page.goto("/kot-management.html");
    await expect(page.locator(".floor-ready")).toHaveText("Ready");
    await expect(page.locator(".floor-card")).toHaveCount(2);
    const gap = await page.evaluate(() =>
      document.querySelector('.floor-section').getBoundingClientRect().top -
      document.querySelector('.floor-head').getBoundingClientRect().bottom);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(12);
    await expect(page.getByRole('link', {name: 'Message kitchen'})).toHaveAttribute('href', 'kitchen-message.html');

    await page.locator("[data-floor-filter=ready]").click();
    await expect(page.locator(".floor-card")).toHaveCount(1);
    await expect(page.locator(".floor-name")).toHaveText("Table 2");
    await page.locator("[data-floor-filter=all]").click();
    await expect(page.locator(".floor-card")).toHaveCount(3);
    await page.locator("#floor-area").selectOption("Main");
    await expect(page.locator(".floor-card")).toHaveCount(2);
    await expect(page.locator("#floor-shapes")).toHaveCount(0);
    await expect(page.locator(".floor-table-shape")).toHaveCount(0);
    await expect(
      page.locator('.floor-card[data-table-number="3"]'),
    ).toHaveAttribute("href", "tables.html?source=floor&table=3");
    await page.locator("#floor-refresh").click();
    await expect(page.locator("[data-floor-filter=all]")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("#floor-area")).toHaveValue("Main");
    await expect(page.locator(".floor-card")).toHaveCount(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-artifacts/full-design-floor-${width}.png`,
      fullPage: true,
    });
    fail = true;
    await page.locator("#floor-area").selectOption("");
    await page.locator("[data-floor-filter=ready]").click();
    await page.locator("#floor-refresh").click();
    await expect(page.locator("#floor-filter-status")).toHaveText(
      "Connection failed",
    );
    await expect(page.locator(".floor-card")).toHaveCount(0);
    await page.locator("[data-floor-filter=active]").click();
    await expect(page.locator(".floor-card")).toHaveCount(2);
  });

test("saved orders stay grey on the floor and the navigation count excludes other staff", async ({
  page,
}) => {
  await onTheMenu(page, "nothing");
  await page.goto("/kot-management.html");
  await page.waitForFunction(
    () => window.POSNIC_ORDER_QUEUE_UI && POSNIC.session.active,
  );
  await page.evaluate(() => {
    OrderQueue.add({
      key: "pending-own",
      body: { kiosk_table_no: "7", items: [] },
    });
    OrderQueue.update("pending-own", { state: "attention", message: "Table is unavailable" });
    const rows = OrderQueue.all();
    rows.push({
      ...rows[0],
      key: "pending-other",
      owner: { ...rows[0].owner, user: "other" },
      body: { kiosk_table_no: "Private table", items: [] },
    });
    localStorage.setItem("posnic.pending-orders", JSON.stringify(rows));
    POSNIC_ORDER_QUEUE_UI.render();
  });
  await expect(page.locator(".floor-card.is-pending")).toHaveCount(1);
  await expect(page.locator(".floor-card.is-pending")).toContainText("7");
  await expect(page.locator(".floor-card.is-pending")).toContainText("Table is unavailable");
  await expect(page.locator(".floor-card.is-pending")).toContainText("Needs attention");
  await expect(page.locator(".navigation-count")).toHaveText("1");
  await expect(page.getByText("Private table")).toHaveCount(0);
  await expect(page.locator("#no-orders-message")).toBeHidden();
  await page.locator(".floor-card.is-pending").click();
  await expect(page).toHaveURL(/pending.html$/);
  await expect(page.locator(".pending-order-card")).toHaveCount(1);
});
