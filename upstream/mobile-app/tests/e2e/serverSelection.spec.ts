import { test, expect } from "@playwright/test";

test("Wi-Fi results require an explicit server choice before sign-in", async ({
  page,
}, testInfo) => {
  // Replace only the browser's unavailable Wi-Fi adapter with a fixed device IP.
  // The production discovery scanner and setup UI run unchanged; no test hook ships.
  await page.route("**/_expo/static/js/web/*.js", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const adapter = 'throw new Error("wifiNativeOnly")';
    expect(source.split(adapter)).toHaveLength(2);
    await route.fulfill({
      response,
      body: source.replace(adapter, 'return "192.168.50.9"'),
    });
  });
  let credentialRequests = 0;
  await page.route(/^http:\/\/192\.168\.50\./, async (route) => {
    const req = route.request();
    if (!req.url().endsWith("/runtime-info")) credentialRequests++;
    expect(req.headers().authorization).toBeUndefined();
    const host = new URL(req.url()).host;
    const found = [
      "192.168.50.4:5555",
      "192.168.50.5:5555",
      "192.168.50.6:5555",
    ].includes(host);
    await route.fulfill({
      status: found ? 200 : 404,
      json: found
        ? {
            edition: "community",
            apiSchema: 1,
            syncProtocol: 1,
            version: "1.9.0",
            features: { mobilePosV1: host !== "192.168.50.6:5555" },
          }
        : {},
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Connect a local or Community shop",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Find server on Wi-Fi", exact: true })
    .click();
  await expect(page.getByTestId("found-server")).toHaveCount(3);
  await expect(
    page.getByRole("textbox", { name: "Username", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Password", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Use this server · 192.168.50.6:5555",
      exact: true,
    }),
  ).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("choose-server.png") });
  await page
    .getByRole("button", {
      name: "Use this server · 192.168.50.5:5555",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("selected-server")).toContainText(
    "192.168.50.5:5555",
  );
  await expect(
    page.getByRole("textbox", { name: "Username", exact: true }),
  ).toBeVisible();
  expect(credentialRequests).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("server-sign-in.png") });
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("not-submitted");
  await page
    .getByRole("button", { name: "Change server", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Password", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Use this server · 192.168.50.4:5555",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("selected-server")).toContainText(
    "192.168.50.4:5555",
  );
  await expect(
    page.getByRole("textbox", { name: "Password", exact: true }),
  ).toHaveValue("");
});
