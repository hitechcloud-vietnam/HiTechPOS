import { test, expect } from "@playwright/test";
import en from "../../src/i18n/en.json";
import ar from "../../src/i18n/ar.json";
import { type BusinessContext } from "../../src/domain/contracts";
for (const [locale, messages] of [
  ["en", en],
  ["ar", ar],
] as const) {
  test(`connected stock has explicit coverage, bounded rows and refresh safety in ${locale}`, async ({
    page,
    context,
  }) => {
    await page.clock.install();
    await page.setViewportSize({ width: 320, height: 780 });
    await page.addInitScript(
      (locale) => localStorage.setItem("posnic.business.language", locale),
      locale,
    );
    const origin = "https://stock.example.com",
      token = "pb1_" + "s".repeat(43),
      request = "r".repeat(43);
    const branchId = "a".repeat(24);
    const account: BusinessContext = {
      accountId: "c".repeat(24),
      businessId: "b".repeat(24),
      businessName: "Stock Test Shop",
      capabilities:
        locale === "ar" ? ["stock.read", "overview.read"] : ["stock.read"],
      branches: [
        {
          id: branchId,
          name: "Main branch",
          currency: "INR",
          currencyDigits: 2,
          timezone: "Asia/Kolkata",
        },
      ],
    };
    let reads = 0;
    let finishRefresh: (() => void) | undefined;
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
          ...(url.searchParams.get("stock") === "1"
            ? { stockReporting: "bounded-stock-v1" }
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
      else if (path.endsWith("/overview")) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: "{}",
        });
        return;
      } else if (path.endsWith("/stock")) {
        expect(route.request().headers().authorization).toBe("Bearer " + token);
        expect(url.searchParams.get("branchId")).toBe(branchId);
        reads++;
        if (reads === 2) {
          await new Promise<void>((resolve) => {
            finishRefresh = resolve;
          });
          await route.abort("failed");
          return;
        }
        if (reads === 3) {
          await route.abort("failed");
          return;
        }
        if (reads === 4 || reads === 6) {
          await route.fulfill({
            status: reads === 6 ? 403 : 200,
            contentType: "application/json",
            body: "{}",
          });
          return;
        }
        const at = await page.evaluate(() => new Date().toISOString());
        result = {
          schemaVersion: 1,
          metricDefinitionVersion: "stored-stock-v1",
          businessId: account.businessId,
          branchId,
          observedFrom: at,
          preparedAt: at,
          coverage: {
            scannedItems: 25,
            verifiedItems: 23,
            unavailableItems: 1,
            excludedItems: 1,
            reasons: { ambiguous_branch_stock: 1 },
          },
          lowItemCount: 23,
          listTruncated: false,
          lowItems: Array.from({ length: 23 }, (_, i) => ({
            itemId: (i + 1).toString(16).padStart(24, "0"),
            name: `Rice ${i + 1}`,
            unit: "kg",
            availableMilli: i === 0 ? -125 : 1250,
            thresholdMilli: 5000,
            thresholdSource: "item",
            low: true,
          })),
          freshness: {
            state: "partial",
            complete: false,
            sourceUpdatedAt: null,
            checkedAt: at,
          },
        };
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
    await page.getByRole("tab", { name: messages.stock, exact: true }).click();
    const stock = page.getByTestId("business-stock");
    await expect(
      stock.getByText(messages.stockObservationHelp, { exact: true }),
    ).toBeVisible();
    await expect(
      stock.getByRole("heading", { name: "Rice 1", exact: true }),
    ).toBeVisible();
    await expect(
      stock.getByText(messages.stockNegative, { exact: true }),
    ).toBeAttached();
    await expect(
      stock.getByRole("heading", { name: "Rice 21", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: `test-results/business-stock-${locale}.png`,
    });
    await stock
      .getByRole("button", { name: messages.loadMore, exact: true })
      .click();
    await expect(
      stock.getByRole("heading", { name: "Rice 23", exact: true }),
    ).toBeAttached();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (locale === "en")
      await expect(
        page.getByRole("tab", { name: messages.insights, exact: true }),
      ).toHaveCount(0);
    await stock
      .getByRole("button", { name: messages.refresh, exact: true })
      .click();
    await expect.poll(() => !!finishRefresh).toBe(true);
    await expect(
      stock.getByRole("heading", { name: "Rice 23", exact: true }),
    ).toBeAttached();
    await expect(
      stock.getByRole("button", { name: messages.refresh, exact: true }),
    ).toBeDisabled();
    finishRefresh!();
    await expect(
      stock.getByText(messages.summaryConnectionLost, { exact: true }),
    ).toBeVisible();
    await expect(
      stock.getByRole("heading", { name: "Rice 23", exact: true }),
    ).toBeAttached();
    expect(reads).toBe(2);
    await page.clock.fastForward(10 * 60_000);
    await stock
      .getByRole("button", { name: messages.refresh, exact: true })
      .click();
    await expect(
      stock.getByText(messages.summaryConnectionLost, { exact: true }),
    ).toBeVisible();
    await expect(
      stock.getByRole("heading", { name: "Rice 23", exact: true }),
    ).toBeAttached();
    expect(reads).toBe(3);
    await page.clock.fastForward(6 * 60_000);
    await expect(
      stock.getByRole("heading", { name: "Rice 1", exact: true }),
    ).toHaveCount(0);
    expect(reads).toBe(3);
    await stock
      .getByRole("button", { name: messages.refresh, exact: true })
      .click();
    await expect(
      stock.getByText(messages.summaryUnavailable, { exact: true }),
    ).toBeVisible();
    await expect(
      stock.getByRole("heading", { name: "Rice 1", exact: true }),
    ).toHaveCount(0);
    await stock
      .getByRole("button", { name: messages.refresh, exact: true })
      .click();
    await expect(
      stock.getByRole("heading", { name: "Rice 1", exact: true }),
    ).toBeVisible();
    await expect(
      stock.getByText(messages.summaryConnectionLost, { exact: true }),
    ).toHaveCount(0);
    await stock
      .getByRole("button", { name: messages.refresh, exact: true })
      .click();
    await expect(stock).toHaveCount(0);
    expect(reads).toBe(6);
  });
}
