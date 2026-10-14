import { test, expect } from "@playwright/test";
import ta from "../../src/i18n/ta.json";
import { sampleContext } from "../../src/data/sample";

test("Tamil account tabs wrap and changing language preserves the authenticated account", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.addInitScript(() =>
    localStorage.setItem("posnic.business.language", "ta"),
  );
  const origin = "https://localized.example.com",
    request = "r".repeat(43),
    token = "pb1_" + "t".repeat(43);
  const account = {
    ...sampleContext("manager"),
    businessName: "Connected language fixture",
  };
  let issued = 0,
    exchanged = 0;
  await context.route(origin + "/api/business/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let result: unknown;
    if (path.endsWith("/discovery"))
      result = {
        product: "posnic-business",
        apiVersion: 1,
        issuer: origin,
        authorization: "business-pkce-v1",
        audience: "posnic-business",
        reporting: "unavailable",
      };
    else if (path.endsWith("/requests")) {
      issued++;
      result = {
        request,
        authorizationUrl:
          origin + "/api/business/v1/authorize?request=" + request,
        expiresIn: 600,
        interval: 5,
      };
    } else if (path.endsWith("/authorize")) {
      await route.fulfill({
        contentType: "text/html",
        body: "<h1>Synthetic consent</h1>",
      });
      return;
    } else if (path.endsWith("/token")) {
      exchanged++;
      result = {
        token,
        expiresAt: "2099-01-01T00:00:00.000Z",
        context: account,
      };
    } else if (path.endsWith("/inbox")) {
      expect(route.request().headers().authorization).toBe("Bearer " + token);
      result = { entries: [], next: null };
    } else throw new Error("Unexpected endpoint: " + path);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: ta.community, exact: true }).click();
  await page.getByRole("textbox", { name: ta.serverAddress }).fill(origin);
  const popupPromise = context.waitForEvent("page");
  await page
    .getByRole("button", { name: ta.secureSignIn, exact: true })
    .click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await page.bringToFront();
  await expect(
    page.getByRole("heading", { name: account.businessName }),
  ).toBeVisible({ timeout: 12000 });
  for (const name of [ta.today, ta.inbox, ta.more]) {
    await page.getByRole("tab", { name, exact: true }).click();
    const fit = await page
      .getByRole("tab", { name, exact: true })
      .evaluate((tab) =>
        [...tab.querySelectorAll<HTMLElement>('[dir="auto"]')].every(
          (label) => label.scrollWidth <= label.clientWidth + 1,
        ),
      );
    expect(fit).toBe(true);
  }
  const bar = page.getByRole("tablist");
  const originalHeight = (await bar.boundingBox())!.height;
  const inboxTab = page.getByRole("tab", { name: ta.inbox, exact: true });
  const inboxLabel = inboxTab.getByText(ta.inbox, { exact: true });
  await inboxLabel.evaluate((label) => {
    label.style.fontSize = "24px";
    label.style.lineHeight = "36px";
  });
  await expect
    .poll(async () => (await bar.boundingBox())!.height)
    .toBeGreaterThan(originalHeight);
  const labelBox = (await inboxLabel.boundingBox())!,
    tabBox = (await inboxTab.boundingBox())!;
  expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(
    tabBox.y + tabBox.height + 1,
  );
  await page.getByRole("button", { name: ta.language, exact: true }).click();
  await page.getByRole("radio", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Language", exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("link", { name: "Go back", exact: true }).click();
  await page.getByRole("tab", { name: "Today", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: account.businessName }),
  ).toBeVisible();
  expect(issued).toBe(1);
  expect(exchanged).toBe(1);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    token,
  );
  await popup.close();
});
