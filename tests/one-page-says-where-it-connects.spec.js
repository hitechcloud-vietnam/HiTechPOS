import { test, expect } from "@playwright/test";
const LAN = "http://192.168.1.8:5555/api",
  CLOUD = "https://azure.posnic.io/api";
async function settings(
  page,
  { lan = LAN, cloud = CLOUD, pinned = null } = {},
) {
  await page.goto("/index.html");
  await page.evaluate(
    ({ lan, cloud, pinned }) => {
      POSNIC.server.remember({ lan, cloud });
      if (pinned) POSNIC.server.pin(pinned);
      else POSNIC.server.unpin();
      openServerModal();
    },
    { lan, cloud, pinned },
  );
  await expect(page.locator("#captain-onboarding")).toBeVisible();
}
test("connection settings reuse setup without claiming that a saved address is connected", async ({
  page,
}) => {
  await settings(page);
  await expect(page.locator("#captain-onboarding .setup-title")).toHaveText(
    "Change server",
  );
  await expect(page.locator("#connection-lan")).toBeHidden();
  await expect(page.locator("#serverModal")).toHaveCount(0);
});
test("the screen explains the fastest method and the internet alternative", async ({
  page,
}) => {
  await settings(page);
  await expect(page.locator("#setup-wifi-hint")).toContainText(
    "Shop Wi-Fi is fastest",
  );
  await expect(page.locator("#setup-wifi-hint")).toContainText("internet");
});
test("both server addresses have a dedicated view with Back to setup", async ({
  page,
}) => {
  await settings(page);
  await page.locator("#connection-settings").click();
  await expect(page.locator("#connection-lan")).toHaveValue(LAN);
  await expect(page.locator("#connection-cloud")).toHaveValue(CLOUD);
  await page.locator("#connection-back").click();
  await expect(page.locator("#connection-lan")).toBeHidden();
});
test("saving both addresses enables automatic selection instead of preserving an old pin", async ({
  page,
}) => {
  await settings(page, { pinned: CLOUD });
  await page.locator("#connection-settings").click();
  await page.locator("#connection-save").click();
  await expect(page.locator("#captain-note")).toContainText("Saved");
  expect(await page.evaluate(() => POSNIC.server.pinned)).toBeNull();
  expect(await page.evaluate(() => POSNIC.server.cloud)).toBe(CLOUD);
  expect(await page.evaluate(() => POSNIC.server.lan)).toBe(LAN);
});
test("empty connection settings cannot replace the saved shop", async ({
  page,
}) => {
  await settings(page, { pinned: CLOUD });
  await page.locator("#connection-settings").click();
  await page.locator("#connection-lan").fill("");
  await page.locator("#connection-cloud").fill("");
  await page.locator("#connection-save").click();
  await expect(page.locator("#captain-note")).toContainText("Check");
  expect(await page.evaluate(() => POSNIC.server.baseUrl)).toBe(CLOUD);
});
test("a new phone offers every connection method without an account or network check", async ({
  page,
}) => {
  await page.goto("/index.html");
  await page.evaluate(() => openServerModal());
  for (const id of [
    "captain-cloud-login",
    "captain-address-toggle",
    "captain-search",
    "captain-scan",
    "captain-code-toggle",
  ])
    await expect(page.locator("#" + id)).toBeVisible();
  await page.locator("#captain-address-toggle").click();
  await expect(page.locator("#captain-server")).toBeVisible();
  await expect(page.locator("#captain-cancel")).toBeHidden();
});
test("an outage cannot cover the connection editor or start a competing search", async ({
  page,
}) => {
  await settings(page);
  await page.locator("#captain-address-toggle").click();
  await page.evaluate(() => POSNIC.net.setOffline());
  await expect(page.locator("#captain-server")).toBeVisible();
  await expect(page.locator("#posnic-offline")).toBeHidden();
  await expect(page.locator("#captain-cancel")).toBeHidden();
});
