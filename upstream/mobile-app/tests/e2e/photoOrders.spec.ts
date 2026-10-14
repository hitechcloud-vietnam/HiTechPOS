import { test, expect } from "@playwright/test";
test("photo tools are separate and a recovered draft requires review before atomic import", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("start-training").click();
  await expect(page.getByTestId("item-coffee")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Photo tools", exact: true }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("posnic-preview");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("records", "readwrite"),
        store = tx.objectStore("records");
      const r = store.get("shop");
      r.onsuccess = () => {
        const shop = r.result,
          scope = JSON.stringify([
            shop.mode,
            shop.id,
            shop.branchId,
            shop.staffId,
          ]);
        store.put(
          {
            id: "photo-test",
            scope,
            revision: 0,
            mode: "order",
            image: "",
            createdAt: new Date().toISOString(),
            lines: [
              {
                id: "row",
                text: "2 Filter coffee",
                query: "Filter coffee",
                quantity: 2,
                reviewed: false,
                excluded: false,
              },
            ],
          },
          "photo:" + scope,
        );
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.getByRole("button", { name: "Photo tools", exact: true }).click();
  const add = page.getByRole("button", {
    name: "Add reviewed items to current order",
    exact: true,
  });
  await expect(add).toBeDisabled();
  await page
    .getByRole("button", { name: "Choose product and quantity", exact: true })
    .click();
  await expect(
    page.getByText("☕ Filter coffee", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Confirm this product and quantity",
      exact: true,
    })
    .click();
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.getByRole("button", { name: /^Charge ·/ })).toBeVisible();
  await expect(page.getByText("Filter coffee", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Photo tools", exact: true }).click();
  await expect(
    page.getByText(
      "These reviewed items were already added. Retrying will not add another copy.",
    ),
  ).toBeVisible();
});
