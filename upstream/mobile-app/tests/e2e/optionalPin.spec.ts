import { test, expect } from "@playwright/test";

for (const pairing of [false, true]) {
  test(`${pairing ? "pairing" : "password login"} opens Sell without requiring a PIN`, async ({
    page,
  }) => {
    await page.route("http://192.168.50.4:5555/api/**", async (route) => {
      const url = route.request().url();
      const json = url.includes("runtime-info")
        ? {
            edition: "community",
            apiSchema: 1,
            features: { mobilePosV1: true },
          }
        : url.includes("bootstrap")
          ? {
              shop: {
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
              },
              items: [],
            }
          : { token: "test-session-token" };
      await route.fulfill({ json });
    });
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
    if (pairing) {
      await page
        .getByRole("button", { name: "Pairing code", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Pairing code", exact: true })
        .fill("ABCDEF123456");
    } else {
      await page
        .getByRole("textbox", { name: "Username", exact: true })
        .fill("cashier");
      await page
        .getByRole("textbox", { name: "Password", exact: true })
        .fill("test-password");
    }
    await page
      .getByRole("button", {
        name: pairing ? "Pair device" : "Sign in",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Search items", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "PIN", exact: true }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Search items", exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "More", exact: true }).click();
    await page.getByText("Set unlock PIN", { exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "PIN", exact: true }),
    ).toBeVisible();
  });
}
