import { test, expect, type Page } from "@playwright/test";
const product = {
  id: "a".repeat(24),
  name: "Warehouse beans",
  price: 1000,
  code: "",
  barcode: "00123",
  category: "Food",
  visual: "■",
  taxBps: 0,
  taxInclusive: true,
  active: true,
  tracked: true,
  quantity: 10000,
  revision: "b".repeat(64),
  supplierId: "supplier",
  supplierName: "Market",
  categoryId: "food",
  sku: "BEAN",
  unit: "piece",
};
const shop = {
  id: "inventory-shop",
  branchId: "main",
  name: "Inventory test shop",
  branchName: "Main",
  currency: "INR",
  staffId: "owner",
  staffName: "Owner",
  snapshotVersion: "1",
  offlineUntil: new Date(Date.now() + 86400000).toISOString(),
  quickTaxBps: 0,
  quickTaxInclusive: true,
  permissions: {
    sell: true,
    quickSale: true,
    customerWrite: false,
    itemWrite: false,
    priceOverride: false,
    manualUpi: false,
    inventoryWrite: true,
  },
  upiAccounts: [],
  capabilities: {
    saleSync: true,
    devicePairing: true,
    tillPrint: false,
    terminal: false,
    inventory: true,
  },
};
async function login(page: Page) {
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
  await page
    .getByRole("textbox", { name: "Username", exact: true })
    .fill("owner");
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
}
test("receive stock saves a draft, requires review, then confirms exactly one operation", async ({
  page,
}) => {
  let writes = 0,
    prepared: any;
  await page.route("http://192.168.50.4:5555/api/**", async (route) => {
    const url = route.request().url();
    let json: any = { token: "test-token" };
    if (url.includes("runtime-info"))
      json = {
        edition: "community",
        apiSchema: 1,
        features: { mobilePosV1: true },
      };
    else if (url.includes("bootstrap")) json = { shop, items: [product] };
    else if (url.includes("inventory/catalogue"))
      json = {
        shopId: shop.id,
        branchId: shop.branchId,
        staffId: shop.staffId,
        asOf: new Date().toISOString(),
        permissions: { read: true, write: true, approvalActions: [] },
        rows: [product],
        next: null,
      };
    else if (url.endsWith("/confirm")) {
      writes++;
      json = { ...prepared, state: "complete", applied: [product.id] };
    } else if (url.endsWith("inventory/operations")) {
      const body = route.request().postDataJSON();
      prepared = {
        ...body,
        operationId: "c".repeat(64),
        state: "prepared",
        approvalRequired: false,
        conflicts: [],
        applied: [],
        lines: body.lines.map((l: any) => ({
          ...l,
          name: product.name,
          expected: 10000,
        })),
      };
      json = prepared;
    }
    await route.fulfill({ json });
  });
  await login(page);
  await page
    .getByRole("button", { name: "Receive stock", exact: true })
    .click();
  await page.getByRole("button").filter({ hasText: "Warehouse beans" }).click();
  await page.getByRole("textbox", { name: "Quantity", exact: true }).fill("2");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Review · 1", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Reason / reference", exact: true })
    .fill("Delivery 123");
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm stock changes", exact: true }),
  ).toBeVisible();
  expect(writes).toBe(0);
  expect(prepared.lines[0].quantity).toBe(2000);
  await page
    .getByRole("button", { name: "Confirm stock changes", exact: true })
    .click();
  await expect(
    page.getByText("Complete", { exact: true }).first(),
  ).toBeVisible();
  expect(writes).toBe(1);
  await page.screenshot({
    path: "test-results/inventory-confirmed.png",
    fullPage: true,
  });
});
test("count requires explicit quantity and a saved zero survives app restart", async ({
  page,
}) => {
  await page.route("http://192.168.50.4:5555/api/**", async (route) => {
    const url = route.request().url();
    await route.fulfill({
      json: url.includes("runtime-info")
        ? {
            edition: "community",
            apiSchema: 1,
            features: { mobilePosV1: true },
          }
        : url.includes("bootstrap")
          ? { shop, items: [product] }
          : url.includes("inventory/catalogue")
            ? {
                shopId: shop.id,
                branchId: shop.branchId,
                staffId: shop.staffId,
                asOf: new Date().toISOString(),
                permissions: { read: true, write: true, approvalActions: [] },
                rows: [product],
                next: null,
              }
            : { token: "test-token" },
    });
  });
  await login(page);
  await page.getByRole("button", { name: "Count stock", exact: true }).click();
  await page.getByRole("button").filter({ hasText: "Warehouse beans" }).click();
  await expect(
    page.getByRole("textbox", { name: "Quantity", exact: true }),
  ).toHaveValue("");
  await page.getByRole("textbox", { name: "Quantity", exact: true }).fill("0");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review · 1", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await page.getByRole("button", { name: /Count stock · 1/ }).click();
  await expect(
    page.getByText("Warehouse beans · 0 piece", { exact: true }),
  ).toBeVisible();
});
