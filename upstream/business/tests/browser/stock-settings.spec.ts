import { test, expect } from "@playwright/test";
import en from "../../src/i18n/en.json";
import ar from "../../src/i18n/ar.json";
for (const [locale, messages] of [
  ["en", en],
  ["ar", ar],
] as const) {
  test(`stock alert settings preserve scope, drafts and conflicting saves in ${locale}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 320, height: 780 });
    await page.addInitScript(
      (locale) => localStorage.setItem("posnic.business.language", locale),
      locale,
    );
    const origin = "https://stock-settings.example.com",
      token = "pb1_" + "s".repeat(43),
      request = "r".repeat(43),
      branchId = "a".repeat(24);
    const branch = {
      id: branchId,
      name: "Central",
      currency: "INR",
      currencyDigits: 2,
      timezone: "Asia/Kolkata",
    };
    const account = {
      accountId: "c".repeat(24),
      businessId: "b".repeat(24),
      businessName: "Stock Settings Test",
      capabilities: ["stock.read", "notifications.self.manage"],
      branches:
        locale === "ar"
          ? [branch, { ...branch, id: "d".repeat(24), name: "North" }]
          : [branch],
    };
    let saved = {
      branchId,
      timezone: branch.timezone,
      revision: 0,
      enabled: false,
      minimumIntervalMinutes: 60,
      quiet: { enabled: false, start: "22:00", end: "07:00" },
    };
    let posts = 0,
      supported = true;
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
          ...(supported && url.searchParams.get("stockAlertPreferences") === "1"
            ? { stockAlertPreferences: "stock-alert-preferences-v1" }
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
      else if (path.endsWith("/inbox")) result = { entries: [], next: null };
      else if (path.endsWith("/notifications/stock/" + branchId)) {
        expect(route.request().headers().authorization).toBe("Bearer " + token);
        if (route.request().method() === "POST") {
          posts++;
          const body = route.request().postDataJSON();
          expect(Object.keys(body).sort()).toEqual([
            "enabled",
            "expectedRevision",
            "minimumIntervalMinutes",
            "quiet",
          ]);
          if (posts === 1) {
            await route.fulfill({
              status: 409,
              contentType: "application/json",
              body: JSON.stringify({ error: { code: "preference_changed" } }),
            });
            return;
          }
          expect(body.expectedRevision).toBe(saved.revision);
          saved = { ...saved, ...body, revision: saved.revision + 1 };
          delete (saved as Record<string, unknown>).expectedRevision;
        }
        result = saved;
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
    await page.getByRole("tab", { name: messages.more, exact: true }).click();
    await page
      .getByRole("button", { name: messages.stockAlerts, exact: true })
      .click();
    if (locale === "ar")
      await page.getByRole("button", { name: "Central", exact: true }).click();
    else
      await expect(
        page.getByRole("button", { name: "Central", exact: true }),
      ).toHaveCount(0);
    const frequency = page.getByRole("radiogroup", {
      name: messages.stockAlertFrequency,
    });
    await expect(frequency).toBeVisible();
    await expect(frequency.getByRole("radio")).toHaveCount(4);
    await page
      .getByRole("switch", { name: messages.stockAlerts, exact: true })
      .click();
    await frequency.getByRole("radio").nth(1).click();
    await page
      .getByRole("switch", { name: messages.quietHours, exact: true })
      .click();
    await page
      .getByRole("textbox", { name: messages.quietStart })
      .fill(locale === "ar" ? "٢١:٣٠" : "21:30");
    await page.getByRole("textbox", { name: messages.quietEnd }).fill("06:30");
    await page
      .getByRole("button", {
        name: messages.closeNotificationSettings,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: messages.discardChanges, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: messages.keepEditing, exact: true })
      .click();
    await page
      .getByRole("button", {
        name: messages.saveNotificationSettings,
        exact: true,
      })
      .click();
    await expect(
      page.getByText(messages.notificationSettingsUnavailable, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: messages.saveNotificationSettings,
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      page.getByRole("textbox", { name: messages.quietStart }),
    ).toHaveValue("21:30");
    await page
      .getByRole("button", { name: messages.refresh, exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: messages.saveNotificationSettings,
        exact: true,
      }),
    ).toBeEnabled();
    await page
      .getByRole("switch", { name: messages.stockAlerts, exact: true })
      .click();
    await frequency.getByRole("radio").nth(1).click();
    await page
      .getByRole("button", {
        name: messages.saveNotificationSettings,
        exact: true,
      })
      .click();
    await expect(
      page.getByText(messages.notificationSaved, { exact: true }),
    ).toBeVisible();
    expect(saved.minimumIntervalMinutes).toBe(30);
    expect(saved.enabled).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/stock-settings-${locale}.png`,
    });
    await page
      .getByRole("button", {
        name: messages.closeNotificationSettings,
        exact: true,
      })
      .click();
    if (locale === "en") {
      supported = false;
      await page
        .getByRole("button", { name: messages.stockAlerts, exact: true })
        .click();
      await expect(
        page.getByText(messages.stockAlertsUnsupported, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: messages.saveNotificationSettings,
          exact: true,
        }),
      ).toHaveCount(0);
      expect(posts).toBe(2);
    }
  });
}
