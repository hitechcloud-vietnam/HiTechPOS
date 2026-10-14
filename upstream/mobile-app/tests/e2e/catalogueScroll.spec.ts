import { test, expect } from "@playwright/test";

for (const favouritesOnly of [false, true])
  test(`adding products near the bottom keeps scroll position (favourites: ${favouritesOnly})`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("start-training").click();
    await expect(page.getByTestId("item-coffee")).toBeVisible();
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("posnic-preview");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("records", "readwrite");
        const store = tx.objectStore("records");
        const shopRequest = store.get("shop");
        shopRequest.onsuccess = () => {
          const shop = shopRequest.result;
          store.put(
            Array.from(
              { length: 40 },
              (_, n) => "scroll" + String(n).padStart(2, "0"),
            ),
            "favourites:" +
              JSON.stringify([shop.mode, shop.id, shop.branchId, shop.staffId]),
          );
        };
        const coffee = store.get("item:coffee");
        coffee.onsuccess = () => {
          for (let n = 0; n < 40; n++) {
            const id = "scroll" + String(n).padStart(2, "0");
            store.put(
              {
                ...coffee.result,
                id,
                name: "Product " + id,
                category: "Scroll test",
              },
              "item:" + id,
            );
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    await page.reload();
    if (favouritesOnly) await page.getByTestId("favourites-filter").click();
    const item = page.getByTestId("item-scroll39");
    await item.scrollIntoViewIfNeeded();
    const scroller = page.getByTestId("screen-scroll");
    const before = await scroller.evaluate((el) => el.scrollTop);
    expect(before).toBeGreaterThan(1500);
    for (const total of ["35", "70"]) {
      await item.click();
      await expect(page.getByTestId("view-cart")).toContainText(total);
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
          ),
      );
      expect(await scroller.evaluate((el) => el.scrollTop)).toBeCloseTo(
        before,
        0,
      );
      await expect(item).toBeInViewport();
    }
  });
