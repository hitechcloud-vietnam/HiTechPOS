import { test, expect } from "@playwright/test";
import en from "../../src/i18n/en.json";
import ar from "../../src/i18n/ar.json";
for (const [locale, messages] of [
  ["en", en],
  ["ar", ar],
] as const) {
  test(`stock-only Inbox shows historical details and refreshes safely in ${locale}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 320, height: 780 });
    await page.addInitScript(
      (language) => localStorage.setItem("posnic.business.language", language),
      locale,
    );
    const origin = "https://stock-inbox.example.com",
      token = "pb1_" + "s".repeat(43),
      request = "r".repeat(43),
      branchId = "a".repeat(24),
      cursor = "f".repeat(24);
    const account = {
      accountId: "c".repeat(24),
      businessId: "b".repeat(24),
      businessName: "Stock Inbox Test",
      capabilities: ["stock.read", "notifications.self.manage"],
      branches: [
        {
          id: branchId,
          name: "Central",
          currency: "INR",
          currencyDigits: 2,
          timezone: "Asia/Kolkata",
        },
      ],
    };
    const at = new Date(Date.now() - 3600000).toISOString();
    const entry = {
      id: "e".repeat(24),
      branchId,
      kind: "stock_low",
      businessDate: at.slice(0, 10),
      createdAt: at,
      read: false,
      summary: null,
      stock: {
        schemaVersion: 1,
        snapshotId: "a".repeat(64),
        observedFrom: at,
        preparedAt: at,
        sourceComplete: false,
        coverage: {
          scannedItems: 6,
          verifiedItems: 4,
          unavailableItems: 1,
          excludedItems: 1,
          reasons: { stock_threshold_unconfigured: 1 },
        },
        totalLowItemCount: 4,
        newLowItemCount: 4,
        listTruncated: false,
        items: Array.from({ length: 4 }, (_, index) => ({
          itemId: (index + 1).toString(16).padStart(24, "0"),
          name: ["Rice", "Flour", "Milk", "Olive oil"][index],
          unit: "kg",
          availableMilli: index ? 1000 : -1000,
          thresholdMilli: 2000,
          thresholdSource: "item",
          low: true,
        })),
      },
    };
    let reads = 0,
      corrupt = false,
      failMark = true;
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
          ...(url.searchParams.get("stockAlerts") === "1"
            ? { stockAlerts: "inbox-stock-v1" }
            : {}),
        };
      else if (path.endsWith("/requests"))
        result = {
          request,
          authorizationUrl:
            origin + "/api/business/v1/authorize?request=" + request,
          expiresIn: 600,
          interval: 5,
        };
      else if (path.endsWith("/authorize")) {
        await route.fulfill({
          contentType: "text/html",
          body: "<h1>Synthetic consent</h1>",
        });
        return;
      } else if (path.endsWith("/token"))
        result = {
          token,
          expiresAt: "2099-01-01T00:00:00.000Z",
          context: account,
        };
      else if (path.endsWith("/context")) result = account;
      else if (path.endsWith("/inbox")) {
        expect(route.request().headers().authorization).toBe("Bearer " + token);
        expect(url.searchParams.get("stockAlerts")).toBe("1");
        reads++;
        result =
          reads === 1
            ? { entries: [], next: cursor }
            : {
                entries: [
                  {
                    ...entry,
                    stock: { ...entry.stock, sourceComplete: corrupt },
                  },
                ],
                next: null,
              };
        if (reads === 2) expect(url.searchParams.get("before")).toBe(cursor);
      } else if (path.endsWith("/" + entry.id + "/read")) {
        expect(route.request().method()).toBe("POST");
        expect(route.request().headers().authorization).toBe("Bearer " + token);
        if (failMark) {
          failMark = false;
          await route.fulfill({
            status: 404,
            contentType: "application/json",
            body: JSON.stringify({ error: { code: "entry_unavailable" } }),
          });
          return;
        }
        entry.read = true;
        result = { read: true };
      } else throw new Error("Unexpected endpoint " + path);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(result),
      });
    });
    await page.goto("/");
    await page
      .getByRole("button", { name: messages.community, exact: true })
      .click();
    await page
      .getByRole("textbox", { name: messages.serverAddress })
      .fill(origin);
    const popupReady = context.waitForEvent("page");
    await page
      .getByRole("button", { name: messages.secureSignIn, exact: true })
      .click();
    await (await popupReady).waitForLoadState();
    await page.bringToFront();
    await expect(
      page.getByRole("heading", { name: account.businessName }),
    ).toBeVisible({ timeout: 12000 });
    await expect(
      page.getByRole("tab", { name: messages.insights, exact: true }),
    ).toHaveCount(0);
    await page.getByRole("tab", { name: messages.inbox, exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Central", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: messages.loadOlder, exact: true })
      .click();
    await expect(page.getByText("Rice", { exact: true })).toBeVisible();
    await expect(
      page.getByText(messages.stockObservationHelp, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(messages.stockNegative, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Olive oil", { exact: true })).toHaveCount(0);
    await page.screenshot({
      path: `test-results/stock-inbox-${locale}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: messages.loadMore, exact: true })
      .click();
    await expect(page.getByText("Olive oil", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: messages.markRead, exact: true })
      .click();
    await expect(
      page.getByText(messages.inboxUnavailable, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Rice", { exact: true })).toHaveCount(0);
    await page
      .getByRole("button", { name: messages.refresh, exact: true })
      .click();
    await expect(page.getByText("Rice", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: messages.markRead, exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: messages.markRead, exact: true }),
    ).toHaveCount(0);
    corrupt = true;
    await page
      .getByRole("button", { name: messages.refresh, exact: true })
      .click();
    await expect(
      page.getByText(messages.inboxUnavailable, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Rice", { exact: true })).toHaveCount(0);
    corrupt = false;
    await page
      .getByRole("button", { name: messages.refresh, exact: true })
      .click();
    await expect(page.getByText("Rice", { exact: true })).toBeVisible();
  });
}
