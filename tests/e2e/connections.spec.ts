import { test, expect, type Page } from "@playwright/test";
const shop = {
  id: "optional-pin-shop",
  branchId: "main",
  name: "PIN test shop",
  branchName: "Main",
  currency: "INR",
  staffId: "cashier",
  staffName: "Cashier",
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
  },
  upiAccounts: [],
  capabilities: {
    saleSync: true,
    devicePairing: true,
    tillPrint: false,
    terminal: false,
  },
};
const local = "http://192.168.50.4:5555/api";
const cloud = "https://same-shop.posnic.io/api";
async function mock(page: Page) {
  const logins: string[] = [];
  for (const base of [local, cloud])
    await page.route(base + "/**", async (route) => {
      const path = route.request().url().slice(base.length);
      const token = base === local ? "local-token" : "cloud-token";
      if (path.includes("bootstrap"))
        expect(route.request().headers().authorization).toBe("Bearer " + token);
      if (path.includes("Login") || path.includes("/pair")) logins.push(base);
      await route.fulfill({
        json: path.includes("runtime-info")
          ? {
              edition: "community",
              apiSchema: 1,
              features: { mobilePosV1: true },
            }
          : path.includes("bootstrap")
            ? { shop, items: [] }
            : { token },
      });
    });
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Connect a local or Community shop",
      exact: true,
    })
    .click();
  await page.getByTestId("manual-server").click();
  await page.getByTestId("server-input").fill(local);
  await page.getByTestId("choose-server-next").click();
  await page
    .getByRole("textbox", { name: "Username", exact: true })
    .fill("cashier");
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Search items", exact: true }),
  ).toBeVisible();
  return logins;
}
async function openConnections(page: Page) {
  await page
    .getByRole("button", { name: "Connection & sync", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Connection & sync" }),
  ).toBeVisible();
}
test("connect once to each endpoint and switch using remembered endpoint-specific tokens", async ({
  page,
}, info) => {
  const logins = await mock(page);
  await openConnections(page);
  await expect(
    page.getByRole("textbox", { name: "Password", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Internet", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: info.outputPath("connections.png") });
  await page
    .getByRole("button", { name: "Server address", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Server address", exact: true })
    .fill(cloud);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Username", exact: true })
    .fill("cashier");
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Search items", exact: true }),
  ).toBeVisible();
  await openConnections(page);
  await page
    .getByRole("button", { name: "Shop Wi-Fi · " + local, exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Search items", exact: true }),
  ).toBeVisible();
  await openConnections(page);
  await page
    .getByRole("button", { name: "Internet · " + cloud, exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Search items", exact: true }),
  ).toBeVisible();
  expect(logins).toEqual([local, cloud]);
});
test("cloud approval returns directly to selling and stays on the internet endpoint", async ({
  page,
}) => {
  await page.route("https://www.posnic.com/api/mobile/**", async (route) => {
    const path = route.request().url();
    await route.fulfill({
      json: path.endsWith("/requests")
        ? {
            request: "a".repeat(43),
            expiresIn: 120,
            authorizationUrl: "https://www.posnic.com/api/mobile/authorize",
          }
        : { baseUrl: cloud, code: "ABCDEF123456" },
    });
  });
  await mock(page);
  await openConnections(page);
  await page.getByRole("button", { name: "Internet", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Search items", exact: true }),
  ).toBeVisible();
  await openConnections(page);
  await expect(page.getByText(cloud, { exact: true })).toBeVisible();
});

test("cancelling an unreachable endpoint releases the screen and ignores late replies", async ({
  page,
}) => {
  await mock(page);
  await openConnections(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("http://192.168.50.99:5555/api/**", async (route) => {
    await pending;
    await route.fulfill({
      json: {
        edition: "community",
        apiSchema: 1,
        features: { mobilePosV1: true },
      },
    });
  });
  await page
    .getByRole("button", { name: "Server address", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Server address", exact: true })
    .fill("192.168.50.99");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Server address", exact: true }),
  ).toBeEditable();
  release();
  await expect(
    page.getByRole("textbox", { name: "Password", exact: true }),
  ).toHaveCount(0);
});

test("switch waits for the current sync and resumes without another tap", async ({
  page,
}) => {
  await mock(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  await page.route(local + "/mobile/v1/bootstrap**", async (route) => {
    started = true;
    await pending;
    await route.abort();
  });
  await page
    .getByRole("button", { name: "Connection & sync", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await openConnections(page);
  await page
    .getByRole("button", { name: "Server address", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Server address", exact: true })
    .fill(cloud);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Username", exact: true })
    .fill("cashier");
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("textbox", { name: "Search items", exact: true }),
  ).toBeVisible();
});
