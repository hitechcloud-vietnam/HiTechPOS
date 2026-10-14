import { test, expect } from "@playwright/test";
test("connected insights preserve dates across drilldowns and retain Inbox and More", async ({
  page,
  context,
}) => {
  const origin = "https://insights.example.com",
    branchId = "a".repeat(24),
    businessId = "b".repeat(24);
  const account = {
    accountId: "c".repeat(24),
    businessId,
    businessName: "Insight Test",
    capabilities: [
      "overview.read",
      "items.read",
      "reporting.manage",
      "tenders.read",
      "approvals.read",
    ],
    branches: [
      {
        id: branchId,
        name: "Main",
        currency: "INR",
        currencyDigits: 2,
        timezone: "Asia/Kolkata",
      },
    ],
  };
  const requests: string[] = [];
  await context.route(origin + "/api/business/v1/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    let result: unknown;
    if (path.endsWith("/discovery"))
      result = {
        product: "posnic-business",
        apiVersion: 1,
        issuer: origin,
        authorization: "business-pkce-v1",
        audience: "posnic-business",
        reporting: "bounded-summary-v2",
        insightReporting: "bounded-insights-v1",
      };
    else if (path.endsWith("/requests"))
      result = {
        request: "r".repeat(43),
        authorizationUrl:
          origin + "/api/business/v1/authorize?request=" + "r".repeat(43),
        expiresIn: 600,
        interval: 5,
      };
    else if (path.endsWith("/authorize")) {
      await route.fulfill({
        contentType: "text/html",
        body: "<h1>Consent fixture</h1>",
      });
      return;
    } else if (path.endsWith("/token"))
      result = {
        token: "pb1_" + "s".repeat(43),
        expiresAt: "2099-01-01T00:00:00.000Z",
        context: account,
      };
    else if (path.endsWith("/context")) result = account;
    else if (path.endsWith("/insights")) {
      requests.push(url.search);
      const from = url.searchParams.get("from") || "2026-01-01",
        to = url.searchParams.get("to") || "2026-10-14";
      const billed = from === to ? 50000 : 210000;
      result = {
        schemaVersion: 1,
        businessId,
        branchId,
        from,
        to,
        currency: "INR",
        currencyDigits: 2,
        timezone: "Asia/Kolkata",
        billedSalesMinor: billed,
        refundsMinor: 0,
        salesAfterReturnsMinor: billed,
        bills: 4,
        checkedAt: new Date().toISOString(),
        complete: false,
        items: {
          bySales: [
            {
              itemId: "fish",
              name: "Fish",
              billedSalesMinor: billed,
              refundsMinor: 0,
              salesAfterReturnsMinor: billed,
              quantities: [
                { unit: "plate", soldMilli: 4000, returnedMilli: 0 },
              ],
            },
          ],
          byQuantity: [],
        },
        staff: [
          {
            id: "priya",
            name: "Priya",
            billedSalesMinor: billed,
            refundsMinor: 0,
            salesAfterReturnsMinor: billed,
          },
        ],
        hours: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          billedSalesMinor: hour === 12 ? billed : 0,
          bills: hour === 12 ? 4 : 0,
        })),
        discounts: { amountMinor: 1000, bills: 1 },
        returns: { amountMinor: 0, transactions: 0 },
        payments: {
          basis: "invoice-date",
          receivedMinor: billed,
          outstandingMinor: 0,
          methods: [{ name: "UPI", amountMinor: billed }],
        },
        details: [],
      };
    } else {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: "{}",
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Connect your own server" }).click();
  await page
    .getByRole("textbox", { name: "HTTPS server address" })
    .fill(origin);
  const popup = context.waitForEvent("page");
  await page
    .getByRole("button", { name: "Sign in securely", exact: true })
    .click();
  await popup;
  await expect(page.getByRole("heading", { name: "Insight Test" })).toBeVisible(
    { timeout: 15000 },
  );
  await page.getByRole("tab", { name: "Insights", exact: true }).click();
  const report = page.getByTestId("business-insights");
  await expect(report.getByRole("button", { name: /Fish/ })).toBeVisible();
  await page.screenshot({
    path: "test-results/implemented-insights.png",
    fullPage: true,
  });
  await report.getByRole("button", { name: "Last week", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  const query = requests[1];
  await report.getByRole("button", { name: /Fish/ }).click();
  await expect(
    report.getByRole("heading", { name: "Fish", exact: true }),
  ).toBeVisible();
  expect(requests[1]).toBe(query);
  await report.getByRole("button", { name: "Back to overview" }).click();
  for (const label of [
    "Payments & unpaid bills",
    "Discounts & returns",
    "Busy hours",
  ]) {
    await report.getByRole("button", { name: label, exact: true }).click();
    await expect(
      report.getByRole("button", { name: "Back to overview" }),
    ).toBeVisible();
    await report.getByRole("button", { name: "Back to overview" }).click();
  }
  await page.getByRole("tab", { name: "Inbox", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approvals", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Account & server", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Language", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/implemented-insights-more.png" });
});
