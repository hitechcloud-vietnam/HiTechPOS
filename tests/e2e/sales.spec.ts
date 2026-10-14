import { test, expect } from "@playwright/test";
test("local setup chooses a verified server before showing its credentials", async ({
  page,
}) => {
  await page.route("http://192.168.50.4:5555/api/runtime-info", (route) =>
    route.fulfill({
      json: {
        edition: "community",
        apiSchema: 1,
        features: { mobilePosV1: true },
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Create account · Free trial",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Connect a local or Community shop",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("server-input")).toHaveCount(0);
  await page.getByTestId("manual-server").click();
  await expect(
    page.getByRole("textbox", { name: "Username", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Password", exact: true }),
  ).toHaveCount(0);
  await page.getByTestId("server-input").fill("192.168.50.4:5555");
  await page.getByTestId("choose-server-next").click();
  await expect(page.getByTestId("selected-server")).toContainText(
    "http://192.168.50.4:5555/api",
  );
  await expect(page.getByTestId("server-input")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Username", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("not-submitted");
  await page.getByRole("button", { name: "Pairing code", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Pairing code", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Username", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Password", exact: true }),
  ).toHaveValue("");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page
    .getByRole("button", { name: "Change server", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Username", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId("manual-server")).toBeVisible();
});
test("unreachable or incompatible servers never reveal sign-in fields", async ({
  page,
}) => {
  await page.route("http://192.168.50.4:5555/api/runtime-info", (route) =>
    route.fulfill({
      json: {
        edition: "community",
        apiSchema: 1,
        features: { mobilePosV1: false },
      },
    }),
  );
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Connect a local or Community shop",
      exact: true,
    })
    .click();
  await page.getByTestId("manual-server").click();
  await page.getByTestId("server-input").fill("192.168.50.4:5555");
  await page.getByTestId("choose-server-next").click();
  await expect(
    page.getByRole("textbox", { name: "Username", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId("server-input")).toBeVisible();
});
test("PIN locks the till without losing its cart and rejects a wrong PIN", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("start-training").click();
  await page.getByTestId("item-coffee").click();
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await page.getByText("Set unlock PIN", { exact: true }).click();
  await page.getByRole("textbox", { name: "PIN", exact: true }).fill("4829");
  await page
    .getByRole("textbox", { name: "Confirm PIN", exact: true })
    .fill("4829");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("view-cart")).toContainText("35");
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Lock now", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Sell", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("textbox", { name: "PIN", exact: true }).fill("9871");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(
    page.getByText("Incorrect PIN. Try again.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "PIN", exact: true }).fill("4829");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Sell", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Sell", exact: true }).click();
  await expect(page.getByTestId("view-cart")).toContainText("35");
});
test("startup failure shows a diagnostic and can retry without clearing data", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    let first = true;
    indexedDB.open = (...args: Parameters<IDBFactory["open"]>) => {
      if (first) {
        first = false;
        throw new Error("simulated storage failure");
      }
      return open(...args);
    };
  });
  await page.goto("/");
  await expect(page.getByText("STARTUP-DB", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByTestId("start-training")).toBeVisible();
});
test("offline cash sale survives reload, quick codes remain internal, and languages preserve cart", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByTestId("start-training").click();
  await page.getByTestId("item-coffee").click();
  await page.getByTestId("item-sandwich").click();
  await expect(page.getByTestId("view-cart")).toContainText("115");
  await page.reload();
  await expect(page.getByTestId("view-cart")).toContainText("115");
  await expect(page.getByTestId("item-coffee")).not.toContainText("11");
  await context.setOffline(true);
  await page.getByTestId("view-cart").click();
  await page.getByTestId("take-payment").click();
  await page.getByRole("button", { name: "Cash · ₹115", exact: true }).click();
  await page.getByTestId("cash-received").fill("200");
  await expect(page.getByText("₹85", { exact: true })).toBeVisible();
  await page.getByTestId("finish-cash").click();
  await expect(page.getByRole("heading", { name: "Sale saved" })).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await page.getByRole("tab", { name: "Receipts", exact: true }).click();
  await expect(page.getByText("₹115", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Sell", exact: true }).click();
  await page.getByRole("button", { name: "Enter item quick code" }).click();
  await page
    .getByRole("textbox", { name: "Quick code", exact: true })
    .fill("12");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(page.getByTestId("view-cart")).toContainText("25");
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await page.getByText("Language", { exact: true }).click();
  await expect(page.getByRole("radio")).toHaveCount(18);
  await page.getByRole("radio").filter({ hasText: "தமிழ்" }).click();
  await expect(
    page.getByRole("radio").filter({ hasText: "தமிழ்" }),
  ).toBeChecked();
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "விற்பனை", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("view-cart")).toContainText("25");
  expect(errors).toEqual([]);
});

test("Arabic direction and labels persist on a narrow phone", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("start-training").click();
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await page.getByText("Language", { exact: true }).click();
  const arabic = page.getByRole("radio").filter({ hasText: "العربية" });
  await arabic.click();
  await expect(arabic).toBeChecked();
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "البيع", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page
      .getByTestId("view-cart")
      .evaluate((el) => getComputedStyle(el).direction),
  ).toBe("rtl");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "test-results/sell-arabic.png" });
});
test("quick amount, hold and resume keep correct amount", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-training").click();
  await page.getByRole("tab", { name: "Quick amount", exact: true }).click();
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "5", exact: true }).click();
  await page.getByRole("button", { name: "0", exact: true }).click();
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.getByRole("button", { name: "Hold sale", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Held sales", exact: true }),
  ).toBeVisible();
  await page.getByText("₹150", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Charge · ₹150", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("locked till can sign out without a PIN when no sales or carts are pending", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("Posnic Cloud account", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Your own server", { exact: true }),
  ).toBeVisible();
  await page.getByTestId("start-training").click();
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await page.getByText("Set unlock PIN", { exact: true }).click();
  await page.getByRole("textbox", { name: "PIN", exact: true }).fill("4829");
  await page
    .getByRole("textbox", { name: "Confirm PIN", exact: true })
    .fill("4829");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Lock now", exact: true }).click();
  await page
    .getByRole("button", { name: "Sign out / switch user", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Unlock", exact: true }),
  ).toHaveCount(0);
});
