import { createHash } from "node:crypto";
import { branchDay } from "../../src/domain/preparedOverview";
import { test, expect } from "@playwright/test";
import { sampleContext } from "../../src/data/sample";

test("approved Business connection shows only real scope and revokes on sign-out", async ({
  page,
  context,
}) => {
  const origin = "https://shop.example.com",
    requestId = "r".repeat(43),
    token = "pb1_" + "t".repeat(43);
  let revoked = false,
    removedDevice = false;
  let summaryUnavailable = false;
  let summaryOffline = false;
  let summaryCorrupt = false;
  let overviewReads = 0;
  let publisherChanged = false;
  let inboxRead = false;
  let notificationRevision = 0;
  let scheduleMode = "daily";
  let trendMode = false;
  let itemHistoryIncomplete = false;
  const trendDays: string[] = [];
  const liveContext = {
    ...sampleContext("manager"),
    businessName: "Connected test business",
    branches: sampleContext("manager").branches.map((branch) => ({
      ...branch,
      id: "a".repeat(24),
    })),
    capabilities: [
      ...sampleContext("manager").capabilities,
      "reporting.manage",
    ],
  };
  await page.clock.install();
  await context.route(origin + "/api/business/v1/**", async (route) => {
    const url = new URL(route.request().url());
    let result: unknown;
    if (url.pathname.endsWith("/discovery"))
      result = {
        product: "posnic-business",
        apiVersion: 1,
        issuer: origin,
        authorization: "business-pkce-v1",
        audience: "posnic-business",
        reporting: "bounded-summary-v2",
        ...(url.searchParams.get("registerSessions") === "1"
          ? {
              registerReporting: "bounded-register-session-v1",
              registerInbox: "inbox-register-v1",
              registerSchedules: "register-close-v1",
            }
          : {}),
        ...(url.searchParams.get("items") === "1"
          ? { itemReporting: "bounded-items-v1" }
          : {}),
      };
    else if (url.pathname.endsWith("/requests")) {
      expect(route.request().postDataJSON().codeChallenge).toMatch(
        /^[\w-]{43}$/,
      );
      result = {
        request: requestId,
        authorizationUrl:
          origin + "/api/business/v1/authorize?request=" + requestId,
        expiresIn: 600,
        interval: 5,
      };
    } else if (url.pathname.endsWith("/authorize")) {
      await route.fulfill({
        contentType: "text/html",
        body: "<h1>Test consent completed</h1>",
      });
      return;
    } else if (url.pathname.endsWith("/token"))
      result = {
        token,
        expiresAt: "2099-01-01T00:00:00.000Z",
        context: liveContext,
      };
    else if (
      url.pathname.endsWith("/overview") ||
      url.pathname.endsWith("/items")
    ) {
      if (url.pathname.endsWith("/overview")) overviewReads++;
      if (trendMode) {
        const day = url.searchParams.get("businessDate")!;
        trendDays.push(day);
        if (day === trendDays[0]) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "summary_unavailable" }),
          });
          return;
        }
      }
      if (summaryOffline) {
        await route.abort("internetdisconnected");
        return;
      }
      if (summaryCorrupt) {
        await route.fulfill({ contentType: "application/json", body: "{}" });
        return;
      }
      expect(route.request().headers().authorization).toBe("Bearer " + token);
      const scope = liveContext;
      expect(url.searchParams.getAll("branchId")).toEqual(
        scope.branches.map((b) => b.id),
      );
      if (summaryUnavailable) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "summary_unavailable" }),
        });
        return;
      }
      result = {
        schemaVersion: 2,
        metricDefinitionVersion: 2,
        businessId: scope.businessId,
        branchIds: scope.branches.map((b) => b.id),
        businessDate: url.searchParams.get("businessDate"),
        currency: "INR",
        currencyDigits: 2,
        billedSalesMinor: 10000,
        refundsMinor: 2500,
        salesAfterReturnsMinor: 7500,
        completedSales: 2,
        ...(url.pathname.endsWith("/items")
          ? {
              itemInsights: {
                schemaVersion: 1,
                state: itemHistoryIncomplete ? "incomplete" : "available",
                reason: itemHistoryIncomplete
                  ? "original_items_unavailable"
                  : null,
                sourceSales: 2,
                unavailableSales: itemHistoryIncomplete ? 1 : 0,
                totalItems: itemHistoryIncomplete ? null : 2,
                truncated: false,
                items: itemHistoryIncomplete
                  ? []
                  : [
                      {
                        itemId: "b".repeat(24),
                        name: "Verified tea",
                        billedSalesMinor: 10000,
                        refundsMinor: 2500,
                        salesAfterReturnsMinor: 7500,
                        quantities: [
                          { unit: "cup", soldMilli: 2000, returnedMilli: 1000 },
                        ],
                      },
                      {
                        itemId: "c".repeat(24),
                        name: "Free bread",
                        billedSalesMinor: 0,
                        refundsMinor: 0,
                        salesAfterReturnsMinor: 0,
                        quantities: [
                          { unit: "piece", soldMilli: 1250, returnedMilli: 0 },
                        ],
                      },
                    ],
              },
            }
          : {}),
        preparedAt: new Date().toISOString(),
        freshness: {
          state: "partial",
          sourceUpdatedAt: null,
          checkedAt: new Date().toISOString(),
          complete: false,
        },
      };
    } else if (url.pathname.includes("/notifications/preferences/")) {
      if (route.request().method() === "POST") {
        expect(route.request().postDataJSON().expectedRevision).toBe(
          notificationRevision,
        );
        scheduleMode = route.request().postDataJSON().mode;
        expect(route.request().postDataJSON().scheduleVersion).toBe(2);
        expect(route.request().postDataJSON().time).toBe("21:30");
        notificationRevision++;
      }
      result = {
        branchId: liveContext.branches[0]!.id,
        timezone: "Asia/Kolkata",
        revision: notificationRevision,
        scheduleVersion: 2,
        mode: scheduleMode,
        enabled: notificationRevision > 0,
        time: notificationRevision ? "21:30" : "23:00",
        quiet: { enabled: false, start: "22:00", end: "07:00" },
        locale: "en",
        channel: "inApp",
        nextSendAt: null,
      };
    } else if (url.pathname.endsWith("/inbox")) {
      const close = {
        schemaVersion: 1,
        branchId: liveContext.branches[0]!.id,
        sessionId: "b".repeat(24),
        registerId: "c".repeat(24),
        registerName: "Main counter",
        openedAt: new Date(Date.now() - 7200000).toISOString(),
        closedAt: new Date(Date.now() - 3600000).toISOString(),
        eligibleAt: "",
        businessDate: "",
        timezone: "Asia/Kolkata",
        closeRevision: "",
      };
      close.eligibleAt = new Date(
        Date.parse(close.closedAt) + 600000,
      ).toISOString();
      close.businessDate = branchDay(close.timezone, new Date(close.closedAt));
      close.closeRevision = createHash("sha256")
        .update(
          JSON.stringify([
            liveContext.businessId,
            close.branchId,
            close.sessionId,
            close.registerId,
            close.openedAt,
            close.closedAt,
          ]),
        )
        .digest("hex");
      result = {
        entries: [
          {
            id: "e".repeat(24),
            branchId: liveContext.branches[0]!.id,
            kind: "daily_unavailable",
            businessDate: "2026-09-28",
            createdAt: new Date().toISOString(),
            read: inboxRead,
            summary: null,
            ...(scheduleMode === "register-close"
              ? {
                  kind: "register_unavailable",
                  sessionId: close.sessionId,
                  close,
                  businessDate: close.businessDate,
                }
              : {}),
          },
        ],
        next: null,
      };
    } else if (url.pathname.endsWith("/inbox/" + "e".repeat(24) + "/read")) {
      expect(route.request().method()).toBe("POST");
      inboxRead = true;
      result = { read: true };
    } else if (url.pathname.includes("/reporting/publishers/")) {
      if (route.request().method() === "POST") {
        expect(route.request().postDataJSON()).toEqual({
          deviceId: "till-b",
          expectedEpoch: 1,
        });
        publisherChanged = true;
        summaryUnavailable = true;
        result = { changed: true, epoch: 2 };
      } else
        result = {
          branchId: liveContext.branches[0]!.id,
          publisher: {
            deviceId: publisherChanged ? "till-b" : "till-a",
            name: publisherChanged ? "Front desk" : "Old desk",
            epoch: publisherChanged ? 2 : 1,
            online: true,
            lastPublishedAt: null,
          },
          candidates: [
            {
              deviceId: "till-b",
              name: "Front desk",
              lastSeenAt: new Date().toISOString(),
            },
          ],
        };
    } else if (url.pathname.endsWith("/sessions")) {
      result = [
        {
          id: "c".repeat(43),
          name: "Current phone",
          current: true,
          issuedAt: "2026-09-28T01:00:00.000Z",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
        ...(removedDevice
          ? []
          : [
              {
                id: "d".repeat(43),
                name: "Old phone",
                current: false,
                issuedAt: "2026-09-27T01:00:00.000Z",
                expiresAt: "2099-01-01T00:00:00.000Z",
              },
            ]),
      ];
    } else if (url.pathname.endsWith("/sessions/" + "d".repeat(43))) {
      expect(route.request().method()).toBe("DELETE");
      removedDevice = true;
      result = { revoked: true };
    } else if (url.pathname.endsWith("/session")) {
      expect(route.request().method()).toBe("DELETE");
      expect(route.request().headers().authorization).toBe("Bearer " + token);
      revoked = true;
      result = { revoked: true };
    } else throw new Error("Unexpected endpoint: " + url.pathname);
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
  const popupPromise = context.waitForEvent("page");
  await page
    .getByRole("button", { name: "Sign in securely", exact: true })
    .click();
  await expect(page.getByText("RRRRRR", { exact: true })).toHaveCount(0);
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await page.bringToFront();
  await expect(
    page.getByRole("heading", { name: "Connected test business" }),
  ).toBeVisible({ timeout: 12000 });
  await expect(page.getByText("Central branch", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "All branches", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("₹42,850.00", { exact: true })).toHaveCount(0);
  await expect(page.getByText("₹75.00", { exact: true })).toBeVisible();
  await expect(page.getByText(/checked at .* in the branch/)).toBeVisible();
  const beforeAutomaticRefresh = overviewReads;
  await page.clock.fastForward(31_000);
  await expect
    .poll(() => overviewReads)
    .toBeGreaterThan(beforeAutomaticRefresh);
  await page.clock.resume();
  summaryOffline = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText(/These are the last received figures/),
  ).toBeVisible();
  await expect(page.getByText("₹75.00", { exact: true })).toBeVisible();
  summaryOffline = false;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText(/These are the last received figures/),
  ).toHaveCount(0);
  await expect(
    page.getByText("Some sales may still be syncing", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/business-live-today.png",
    fullPage: true,
  });
  trendMode = true;
  const trends = page.getByTestId("business-trends");
  await page.getByRole("tab", { name: "Insights", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Previous 7 days" }),
  ).toBeVisible();
  await expect(trends.getByText("₹75.00", { exact: true })).toHaveCount(6);
  expect(trendDays).toHaveLength(7);
  expect(new Set(trendDays).size).toBe(7);
  const explanation = trends.getByRole("button", {
    name: "Behind the total",
    exact: true,
  });
  await expect(explanation).toHaveAttribute("aria-expanded", "false");
  await explanation.click();
  await expect(explanation).toHaveAttribute("aria-expanded", "true");
  await expect(
    trends.getByText(/This is sales, not cash collected or profit/),
  ).toBeVisible();
  await explanation.click();
  await expect(
    trends.getByText(/Sales are not available yet/).filter({ visible: true }),
  ).toHaveCount(1);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/business-live-insights.png",
    fullPage: true,
  });
  trendMode = false;
  summaryOffline = true;
  await trends.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(trends.getByText(/Could not refresh/)).toBeVisible();
  await expect(trends.getByText("₹75.00", { exact: true })).toHaveCount(6);
  summaryOffline = false;
  summaryCorrupt = true;
  await trends.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(trends.getByText(/Could not verify this summary/)).toBeVisible();
  await expect(trends.getByText("₹75.00", { exact: true })).toHaveCount(0);
  summaryCorrupt = false;
  await page
    .getByRole("button", { name: "Best-selling items", exact: true })
    .click();
  const items = page.getByTestId("business-items");
  await expect(
    items.getByRole("button", { name: "Verified tea" }),
  ).toBeVisible();
  await expect(items.getByText("₹75.00", { exact: true })).toBeVisible();
  await expect(trends).toHaveCount(0);
  await items.getByRole("button", { name: "Behind the total" }).click();
  await expect(
    items.getByText(/ranked by allocated sales after returns/),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await items.getByRole("button", { name: "Behind the total" }).click();
  await page.screenshot({
    path: "test-results/business-live-items.png",
    fullPage: true,
  });
  await items
    .getByRole("button", { name: "Verified tea", exact: true })
    .click();
  const detail = page.getByTestId("business-item-detail");
  await expect(
    detail.getByRole("heading", { name: "Verified tea" }),
  ).toBeVisible();
  await expect(
    detail.getByText("Quantity sold: 2 cup", { exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "Previous", exact: true }),
  ).toBeDisabled();
  await detail.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    detail.getByRole("heading", { name: "Free bread" }),
  ).toBeVisible();
  await expect(
    detail.getByText("Quantity sold: 1.25 piece", { exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "Next", exact: true }),
  ).toBeDisabled();
  const touch = await context.newCDPSession(page);
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 80, y: 260 }],
  });
  for (let x = 95; x <= 245; x += 15)
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: 260 }],
    });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await touch.detach();
  await expect(
    detail.getByRole("heading", { name: "Verified tea" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/business-live-item-detail.png",
    fullPage: true,
  });
  await detail.getByRole("button", { name: "Back", exact: true }).click();
  await expect(detail).toHaveCount(0);
  itemHistoryIncomplete = true;
  await items.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(items.getByText(/Item history is incomplete/)).toBeVisible();
  await expect(items.getByText("Verified tea", { exact: true })).toHaveCount(0);
  itemHistoryIncomplete = false;
  await items.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(items.getByText("Verified tea", { exact: true })).toBeVisible();
  summaryOffline = true;
  await items.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(items.getByText(/Could not refresh/)).toBeVisible();
  await expect(items.getByText("Verified tea", { exact: true })).toBeVisible();
  summaryOffline = false;
  summaryCorrupt = true;
  await items.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(items.getByText(/Could not verify this summary/)).toBeVisible();
  await expect(items.getByText("Verified tea", { exact: true })).toHaveCount(0);
  summaryCorrupt = false;
  await items.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(items.getByText("Verified tea", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Today", exact: true }).click();
  await expect(trends).toHaveCount(0);
  await expect(items).toHaveCount(0);
  for (const name of ["Today", "Insights", "Inbox", "More"]) {
    const label = page
      .getByRole("tab", { name, exact: true })
      .getByText(name, { exact: true });
    const bounds = await label.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  }
  await page.setViewportSize({ width: 320, height: 640 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Notification settings", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await page.screenshot({
    path: "test-results/business-more.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Notification settings", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Summary time (24-hour HH:mm)" })
    .fill("21:30");
  await page
    .getByRole("button", { name: "Close notification settings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Discard changes?", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Summary time (24-hour HH:mm)" }),
  ).toHaveValue("21:30");
  await page
    .getByRole("switch", { name: "Daily summary", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save notification settings", exact: true })
    .click();
  await expect(
    page.getByText("Notification settings saved.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("radio", {
      name: "After a register session closes",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Summary time (24-hour HH:mm)" }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/This is not a whole-business closing report/),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Discard changes?", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/business-close-settings.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Save notification settings", exact: true })
    .click();
  await expect(
    page.getByText("Notification settings saved.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close notification settings", exact: true })
    .click();
  await page.getByRole("tab", { name: "Inbox", exact: true }).click();
  await expect(page.getByText("Main counter", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Register session summary/ }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText(/Session totals are unavailable/)).toBeVisible();
  await page.getByRole("button", { name: "Mark as read", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Mark as read", exact: true }),
  ).toHaveCount(0);
  expect(inboxRead).toBe(true);
  await page.screenshot({
    path: "test-results/business-inbox.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await page
    .getByRole("button", { name: "Reporting desktop", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use Front desk", exact: true })
    .click();
  expect(publisherChanged).toBe(false);
  await page
    .getByRole("button", { name: "Confirm desktop change", exact: true })
    .click();
  await expect(page.getByText(/Reporting desktop updated/)).toBeVisible();
  expect(publisherChanged).toBe(true);
  await page
    .getByRole("button", { name: "Close desktop settings", exact: true })
    .click();
  await page.getByRole("tab", { name: "Today", exact: true }).click();
  await expect(page.getByText("₹75.00", { exact: true })).toHaveCount(0);
  summaryUnavailable = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText(/Sales are not available yet/)).toBeVisible();
  await expect(page.getByText("₹75.00", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    token,
  );
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await page
    .getByRole("button", { name: "Connected devices", exact: true })
    .click();
  await expect(page.getByText("Old phone", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Remove device", exact: true })
    .click();
  expect(removedDevice).toBe(false);
  await page
    .getByRole("button", { name: "Confirm removal", exact: true })
    .click();
  await expect(page.getByText("Old phone", { exact: true })).toHaveCount(0);
  expect(removedDevice).toBe(true);
  await page
    .getByRole("button", { name: "Close devices", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Continue with Posnic Cloud" }),
  ).toBeVisible();
  expect(revoked).toBe(true);
  await popup.close().catch(() => {});
});
test("sample scope, item paging, offline refresh and restricted access", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore sample business" }).click();
  await expect(
    page.getByRole("button", { name: "All branches", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("₹42,850.00", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/business-today.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Insights" }).click();
  await page.getByRole("button", { name: "Masala dosa", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Paneer wrap" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "More" }).click();
  await page
    .getByRole("button", {
      name: "Reporting manager · one branch",
      exact: true,
    })
    .click();
  await expect(page.getByText("Central branch", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "All branches", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "More" }).click();
  await page.getByRole("button", { name: "Offline", exact: true }).click();
  await page.getByRole("tab", { name: "Today" }).click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("Offline. Saved figures remain visible.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "More" }).click();
  await page
    .getByRole("button", { name: "Stock supervisor · one branch", exact: true })
    .click();
  await expect(page.getByText("Net sales", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Stock watch", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "More" }).click();
  await page
    .getByRole("button", { name: "No branch access", exact: true })
    .click();
  await expect(
    page.getByText(
      "Ask your administrator for access. No business data is loaded.",
      { exact: true },
    ),
  ).toBeVisible();
});
test("Cloud and Community do not impersonate completed authorization", async ({
  page,
}) => {
  await page.route(
    "https://www.posnic.com/api/business/v1/discovery",
    (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: "{}",
      }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue with Posnic Cloud" })
    .click();
  await expect(
    page.getByText(/This server does not yet support Posnic Business/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Connect your own server" }).click();
  await page
    .getByRole("textbox", { name: "HTTPS server address" })
    .fill("http://shop.example.com");
  await page
    .getByRole("button", { name: "Sign in securely", exact: true })
    .click();
  await expect(
    page.getByText(/Use a secure HTTPS server origin/),
  ).toBeVisible();
});
test("obsolete Community checks cannot open approval after navigating back", async ({
  page,
}) => {
  const origin = "https://shop.example.com";
  const body = JSON.stringify({
    product: "posnic-business",
    apiVersion: 1,
    issuer: origin,
    authorization: "business-pkce-v1",
    audience: "posnic-business",
    reporting: "bounded-summary-v1",
  });
  await page.route(origin + "/api/business/v1/discovery", (route) =>
    route.fulfill({ contentType: "application/json", body }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Connect your own server" }).click();
  await page
    .getByRole("textbox", { name: "HTTPS server address" })
    .fill(origin);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.unroute(origin + "/api/business/v1/discovery");
  await page.route(origin + "/api/business/v1/discovery", async (route) => {
    await gate;
    await route
      .fulfill({ contentType: "application/json", body })
      .catch(() => {});
  });
  await page
    .getByRole("button", { name: "Sign in securely", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Checking server…", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  release();
  await expect(
    page.getByRole("button", { name: "Continue with Posnic Cloud" }),
  ).toBeEnabled();
  await expect(
    page.getByText(/This server supports the Business connection protocol/),
  ).toHaveCount(0);
});
test("small screen has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore sample business" }).click();
  for (const tab of ["Today", "Insights", "Inbox", "More"]) {
    await page.getByRole("tab", { name: tab }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
