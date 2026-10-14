import { test, expect } from "@playwright/test";

test("desktop images display through the root upload fallback and survive an offline restart", async ({
  page,
}) => {
  let offline = false;
  const imageRequests: string[] = [];
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  await page.route("**/api/**", (route) => {
    if (route.request().url().includes("/uploads/")) imageRequests.push("api");
    return offline ? route.abort() : route.fulfill({ status: 404, json: {} });
  });
  await page.route("**/uploads/desktop-product.png", (route) => {
    const isApi = new URL(route.request().url()).pathname.startsWith("/api/");
    imageRequests.push(isApi ? "api" : "root");
    expect(route.request().headers().authorization).toBeUndefined();
    return offline
      ? route.abort()
      : isApi
        ? route.fulfill({ status: 404, json: {} })
        : route.fulfill({ contentType: "image/png", body: png });
  });
  await page.goto("/");
  await page.getByTestId("start-training").click();
  await expect(page.getByTestId("item-coffee")).toBeVisible();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("posnic-preview");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("records", "readwrite");
      const store = tx.objectStore("records");
      const shop = store.get("shop");
      shop.onsuccess = () =>
        store.put(
          { ...shop.result, mode: "live", baseUrl: location.origin + "/api" },
          "shop",
        );
      const item = store.get("item:coffee");
      item.onsuccess = () =>
        store.put(
          { ...item.result, image: "/uploads/desktop-product.png" },
          "item:coffee",
        );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  const image = page.getByTestId("item-coffee").locator("img");
  await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBe(1);
  expect(imageRequests).toEqual(["api", "root"]);
  offline = true;
  await page.reload();
  await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBe(1);
  expect(imageRequests).toEqual(["api", "root"]);
});
