import { test, expect } from "@playwright/test";

for (const destination of ["local", "cloud"] as const) {
  test(`${destination} reconnection remains available during an unreachable server retry`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("start-training").click();
    await expect(page.getByTestId("item-coffee")).toBeVisible();
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open("posnic-preview");
        r.onsuccess = () => resolve(r.result);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("records", "readwrite");
        const store = tx.objectStore("records");
        const r = store.get("shop");
        r.onsuccess = () =>
          store.put(
            {
              ...r.result,
              mode: "live",
              capabilities: { ...r.result.capabilities, saleSync: true },
              baseUrl: "http://127.0.0.1:5999/api",
            },
            "shop",
          );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    let requests = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("http://127.0.0.1:5999/api/**", async (route) => {
      requests++;
      await held;
      await route.abort();
    });
    await page.clock.install();
    await page.reload();
    await expect.poll(() => requests).toBe(1);
    await page.getByRole("tab", { name: "More", exact: true }).click();
    await page.getByText("Connection & sync", { exact: true }).last().click();
    await page
      .getByRole("button", { name: "Server settings", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Password", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Internet", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Find server on Wi-Fi", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Server address", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Server address", exact: true }),
    ).toBeEditable();
    release();
  });
}

test("offline data and sync screens preserve the basket and explain server acknowledgments", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByTestId("start-training").click();
  await page.getByTestId("item-coffee").click();
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await page.getByText("Offline data", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Offline data", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Unsynced sales and unresolved printing/),
  ).toBeVisible();
  await expect(page.getByText("App storage", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Available storage", { exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/offline-data-screen.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByText(/Synced means accepted by your shop server/),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/sync-centre-screen.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Sell", exact: true }).click();
  await expect(page.getByTestId("view-cart")).toContainText("35");
});

test("large offline catalogue pages and exact code lookup include the final product", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto("/");
  await page.getByTestId("start-training").click();
  await expect(page.getByTestId("item-coffee")).toBeVisible();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const q = indexedDB.open("posnic-preview");
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("records", "readwrite"),
        store = tx.objectStore("records");
      const q = store.get("item:coffee");
      q.onsuccess = () => {
        for (let n = 0; n < 10017; n++) {
          const id = "large" + String(n).padStart(5, "0");
          store.put(
            {
              ...q.result,
              id,
              code: String(n),
              barcode: "000" + n,
              name: n === 10016 ? "Final warehouse item" : "Warehouse " + id,
              category: "Warehouse",
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
  await expect(page.getByTestId("item-coffee")).toBeVisible();
  expect(
    await page.locator('[data-testid^="item-"]').count(),
  ).toBeLessThanOrEqual(48);
  await page
    .getByRole("textbox", { name: "Search items" })
    .fill("Final warehouse");
  await expect(page.getByTestId("item-large10016")).toBeVisible();
  await page.getByTestId("item-large10016").click();
  // Wait for the first durable add before submitting a separate quick-code action.
  await expect(page.getByTestId("view-cart")).toContainText("35");
  await expect(page.getByTestId("view-cart")).toBeEnabled();
  await page.getByRole("textbox", { name: "Search items" }).fill("10016");
  await page.getByRole("textbox", { name: "Search items" }).press("Enter");
  await expect(page.getByTestId("view-cart")).toContainText("70");
  await page.getByTestId("view-cart").click();
  await expect(
    page.getByText("Final warehouse item", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("2", { exact: true })).toBeVisible();
});

test("offline image readiness counts the whole catalogue, not the visible item page", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("start-training").click();
  await page.route("**/mobile/**", (route) => route.abort());
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const q = indexedDB.open("posnic-preview");
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
    const read = (key: string) =>
      new Promise<any>((resolve, reject) => {
        const q = db.transaction("records").objectStore("records").get(key);
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
    const shop = {
      ...(await read("shop")),
      mode: "live",
      baseUrl: location.origin,
    };
    const item = await read("item:coffee");
    const url = location.origin + "/product-image.png";
    const scope = JSON.stringify([shop.baseUrl, shop.id, shop.branchId]);
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify([scope, url, ""])),
    );
    const key = Array.from(new Uint8Array(hash), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("records", "readwrite"),
        store = tx.objectStore("records");
      store.put(shop, "shop");
      store.put(
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "image:" + key,
      );
      for (let n = 0; n < 60; n++)
        store.put({ ...item, id: "image" + n, image: url }, "item:image" + n);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await page.getByText("Offline data", { exact: true }).click();
  await expect(page.getByText("60 / 60", { exact: true })).toBeVisible();
});

test("server settings refuse to disconnect an unfinished basket", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("start-training").click();
  await page.route("**/api/**", (route) => route.abort());
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("posnic-preview");
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("records", "readwrite"),
        s = tx.objectStore("records"),
        r = s.get("shop");
      r.onsuccess = () =>
        s.put(
          {
            ...r.result,
            mode: "live",
            capabilities: { ...r.result.capabilities, saleSync: true },
            baseUrl: "http://127.0.0.1:5999/api",
          },
          "shop",
        );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await page.getByTestId("item-coffee").click();
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await page.getByText("Connection & sync", { exact: true }).last().click();
  await page
    .getByRole("button", { name: "Server settings", exact: true })
    .click();
  await expect(
    page.getByText("http://127.0.0.1:5999/api", { exact: true }),
  ).toBeVisible();
  const connectedShop = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("posnic-preview");
      r.onsuccess = () => resolve(r.result);
    });
    const shop = await new Promise<any>((resolve) => {
      const r = db.transaction("records").objectStore("records").get("shop");
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return shop;
  });
  await page.route("https://same-shop.posnic.io/api/**", (route) =>
    route.fulfill({
      json: route.request().url().includes("runtime-info")
        ? { edition: "cloud", apiSchema: 1, features: { mobilePosV1: true } }
        : route.request().url().includes("bootstrap")
          ? { shop: connectedShop, items: [] }
          : { token: "target-token" },
    }),
  );
  await page
    .getByRole("button", { name: "Server address", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Server address", exact: true })
    .fill("same-shop.posnic.io");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Username", exact: true })
    .fill("cashier");
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Finish or clear the current and parked carts",
  );
  await page.getByRole("tab", { name: "Sell", exact: true }).click();
  await expect(page.getByTestId("view-cart")).toContainText("35");
  await page.getByTestId("view-cart").click();
  await page
    .getByRole("button", { name: "Remove one Filter coffee", exact: true })
    .click();
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await page
    .getByRole("button", { name: "Connection & sync", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("http://127.0.0.1:5999/api", { exact: true }),
  ).toBeVisible();
});
