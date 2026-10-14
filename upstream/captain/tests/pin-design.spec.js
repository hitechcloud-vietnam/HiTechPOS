import { test, expect } from "@playwright/test";
for (const width of [320, 900])
  test(`PIN setup, retry, unlock and Back fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    await page.route("**/pin-fixture", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/assets/common/app-design.css"></head><body><button id="underlying">Settings</button><script src="/assets/common/lock.js"></script></body></html>',
      }),
    );
    await page.goto("/pin-fixture");
    await page.evaluate(() => {
      document.querySelector("#underlying").focus();
      void POSNIC.lock.choose().then((value) => (window.chosen = value));
    });
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await page.locator("#underlying").evaluate((el) => el.inert)).toBe(
      true,
    );
    await page.keyboard.type("1234");
    await expect(page.locator("#posnic-lock-why")).toHaveText("Enter it again");
    await page.keyboard.type("1235");
    await expect(page.locator("#posnic-lock-warn")).toContainText(
      "did not match",
    );
    await page.keyboard.type("2468");
    await page.keyboard.type("2468");
    await expect.poll(() => page.evaluate(() => window.chosen)).toBe(true);
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(await page.locator("#underlying").evaluate((el) => el.inert)).toBe(
      false,
    );
    await expect(page.locator("#underlying")).toBeFocused();
    await page.evaluate(() => {
      void POSNIC.lock
        .unlock("Staff")
        .then((value) => (window.unlocked = value));
    });
    await page.keyboard.type("1111");
    await expect(page.locator("#posnic-lock-warn")).toContainText("Wrong PIN");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: `test-artifacts/pin-unlock-${width}.png`,
      fullPage: true,
    });
    expect(
      await page
        .locator("#posnic-lock")
        .evaluate((el) => el.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.keyboard.type("2468");
    await expect.poll(() => page.evaluate(() => window.unlocked)).toBe(true);
    await page.evaluate(() => {
      void POSNIC.lock.choose().then((value) => (window.cancelled = value));
    });
    await page.evaluate(() =>
      window.dispatchEvent(new Event("captain:back", { cancelable: true })),
    );
    await expect.poll(() => page.evaluate(() => window.cancelled)).toBe(false);
    await expect(page.getByRole("dialog")).toBeHidden();
  });
test("failed PIN storage retains the keypad and allows a fresh confirmation", async ({
  page,
}) => {
  await page.route("**/pin-fixture", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<!doctype html><body><script src="/assets/common/lock.js"></script></body>',
    }),
  );
  await page.goto("/pin-fixture");
  await page.evaluate(() => {
    window.CaptainAccess = {
      setPin: async () => {
        throw new Error("Storage unavailable");
      },
    };
    void POSNIC.lock.choose().then((value) => (window.result = value));
  });
  await page.keyboard.type("1234");
  await page.keyboard.type("1234");
  await expect(page.locator("#posnic-lock-warn")).toHaveText(
    "Could not save. Please try again.",
  );
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => window.result)).toBeUndefined();
  await page.evaluate(() => (CaptainAccess.setPin = async () => true));
  await page.keyboard.type("5678");
  await page.keyboard.type("5678");
  await expect.poll(() => page.evaluate(() => window.result)).toBe(true);
});
