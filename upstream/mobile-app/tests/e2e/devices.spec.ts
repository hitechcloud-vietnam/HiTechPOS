import { test, expect } from "@playwright/test";

test("rapid HID submissions save every item and incomplete input clears on blur", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("start-training").click();
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Devices", exact: true }).click();
  await page.getByTestId("device-hid").click();
  const input = page.getByTestId("scanner-input");
  for (let index = 0; index < 10; index++) {
    await input.fill("POSNIC-DEMO-11");
    await input.press("Enter");
  }
  await expect(page.getByText("₹350", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Current sale", exact: true }),
  ).toBeEnabled();
  await input.fill("INCOMPLETE");
  await input.blur();
  await expect(input).toHaveValue("");
  await expect(
    page.getByText("Scanning paused", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resume scanning" }).click();
  await expect(input).toBeFocused();
});

test("deliberate scanner mode adds repeated products offline and stops on exit", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByTestId("start-training").click();
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Devices", exact: true }).click();
  await expect(page.getByTestId("device-till-print")).toBeDisabled();
  await page.screenshot({ path: "test-results/devices.png", fullPage: true });
  await page.getByTestId("device-hid").click();
  await context.setOffline(true);
  const input = page.getByTestId("scanner-input");
  for (let count = 0; count < 2; count++) {
    await input.fill("POSNIC-DEMO-11");
    await input.press("Enter");
    await expect(input).toHaveValue("");
    await expect(page.getByTestId("scan-result")).toHaveText("Filter coffee");
  }
  await input.fill("upi://pay?pa=test@bank");
  await input.press("Enter");
  await expect(
    page.getByText(/Payment, sign-in and card data are not accepted here/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Current sale", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Charge · ₹70", exact: true }),
  ).toBeVisible();
  await expect(input).toHaveCount(0);
});

test("weighed product scan asks for quantity before saving and prints the unit", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("start-training").click();
  await expect(page.getByTestId("item-coffee")).toBeVisible();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const q = indexedDB.open("posnic-preview");
      q.onsuccess = () => resolve(q.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("records", "readwrite"),
        store = tx.objectStore("records"),
        q = store.get("item:coffee");
      q.onsuccess = () =>
        store.put(
          {
            ...q.result,
            id: "rice",
            name: "Weighed rice",
            barcode: "RICE-001",
            quantityScale: 1000,
            unit: "kg",
            price: 3500,
            taxBps: 0,
          },
          "item:rice",
        );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Devices", exact: true }).click();
  await page.getByTestId("device-hid").click();
  await page.getByTestId("scanner-input").fill("RICE-001");
  await page.getByTestId("scanner-input").press("Enter");
  await expect(
    page.getByRole("heading", { name: "Quantity", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Quantity", exact: true })
    .fill("0.125");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("0.125 kg", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Charge · ₹4.38", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Quantity Weighed rice", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Quantity", exact: true })
    .fill("0.25");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Charge · ₹8.75", exact: true }),
  ).toBeVisible();
});
