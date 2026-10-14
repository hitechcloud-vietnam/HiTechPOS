import { test, expect } from "@playwright/test";
import { onTheMenu } from "./support/shop.js";
for (const width of [320, 800])
  test(`bill review shows confirmed totals, requests print and supports Back at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await onTheMenu(page, "nothing");
    const data = {
      table: "T1",
      currencySymbol: "₹",
      currencyCode: "INR",
      currencyDigits: 2,
      totalMinor: 10500,
      paidMinor: 3500,
      dueMinor: 7000,
      collectEnabled: true,
      labels: { base: "Subtotal", "tax:GST": "GST" },
      lines: [
        {
          name: "Soup <b>",
          quantity: 2,
          amountMinor: 10500,
          components: [
            { key: "base", minor: 10000 },
            { key: "tax:GST", minor: 500 },
          ],
        },
      ],
    };
    let failed = false;
    const prints = [];
    await page.route("**/captain/v1/bill?*", (r) =>
      failed
        ? r.fulfill({
            status: 503,
            json: { error: { message: "Could not load the bill." } },
          })
        : r.fulfill({ json: data }),
    );
    await page.route("**/sales/requestBillPrint", (r) => {
      prints.push(r.request().postDataJSON());
      return r.fulfill({ json: { type: "success" } });
    });
    await page.goto("/kot-management.html");
    await page.evaluate(() => CaptainBill.open("T1"));
    const dialog = page.locator("#bill-review");
    await expect(dialog.locator(".bill-review-lines")).toContainText(
      "Soup <b>",
    );
    await expect(dialog.locator(".bill-review-lines b")).toHaveCount(0);
    await expect(dialog.locator(".bill-review-totals")).toContainText("₹70.00");
    await expect(dialog.locator("[data-bill-pay]")).toBeVisible();
    await dialog.locator("[data-bill-print]").click();
    await expect(dialog.locator("[role=status]")).toHaveText("Bill asked for");
    expect(prints[0].table_number).toBe("T1");
    failed = true;
    await dialog.locator("[data-bill-refresh]").click();
    await expect(dialog.locator("[role=status]")).toHaveText(
      "Could not load the bill.",
    );
    await expect(dialog.locator(".bill-review-totals")).toContainText("₹70.00");
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `test-artifacts/bill-review-${width}.png`,
      fullPage: true,
    });
    await page.evaluate(() =>
      window.dispatchEvent(new Event("captain:back", { cancelable: true })),
    );
    await expect(dialog).toBeHidden();
    failed = false;
    data.paidMinor = 10500;
    data.dueMinor = 0;
    await page.evaluate(() => CaptainBill.open("T1"));
    await expect(
      dialog.getByRole("link", { name: "Close order", exact: true }),
    ).toHaveAttribute("href", "tables.html?source=floor&table=T1");
    await expect(dialog.locator("[data-bill-pay]")).toHaveCount(0);
  });
