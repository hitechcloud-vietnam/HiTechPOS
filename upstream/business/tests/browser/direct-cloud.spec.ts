import { test, expect } from "@playwright/test";

for (const cloud of [true, false])
  test(`one ${cloud ? "Cloud" : "Community"} sign-in tap opens approval and cancel permits a fresh request`, async ({
    page,
    context,
  }) => {
    const origin = cloud
      ? "https://www.posnic.com"
      : "https://shop.example.com";
    const signIn = cloud ? "Continue with Posnic Cloud" : "Sign in securely";
    let requests = 0;
    await context.route(origin + "/api/business/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/authorize")) {
        await route.fulfill({
          contentType: "text/html",
          body: "<h1>Approve Business device</h1>",
        });
        return;
      }
      let body: unknown;
      if (path.endsWith("/discovery"))
        body = {
          product: "posnic-business",
          apiVersion: 1,
          issuer: origin,
          authorization: cloud ? "business-cloud-pkce-v1" : "business-pkce-v1",
          audience: "posnic-business",
          reporting: "unavailable",
        };
      else if (path.endsWith("/requests")) {
        requests++;
        expect(route.request().postDataJSON().codeChallenge).toMatch(
          /^[\w-]{43}$/,
        );
        const request = String(requests).repeat(43);
        body = {
          request,
          authorizationUrl:
            origin + "/api/business/v1/authorize?request=" + request,
          expiresIn: 600,
          interval: 5,
        };
      } else body = { error: { code: "authorization_pending" } };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    await page.goto("/");
    if (!cloud) {
      await page
        .getByRole("button", { name: "Connect your own server" })
        .click();
      await page
        .getByRole("textbox", { name: "HTTPS server address" })
        .fill(origin);
    }
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: signIn, exact: true }).click();
    const popup = await popupPromise;
    await expect(
      popup.getByRole("heading", { name: "Approve Business device" }),
    ).toBeVisible();
    expect(requests).toBe(1);
    await expect(
      page.getByText("Match this code on the sign-in page"),
    ).toHaveCount(0);
    await expect(page.getByText(origin, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Today" })).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: signIn,
        exact: true,
      }),
    ).toBeDisabled();
    await popup.close();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: signIn,
        exact: true,
      }),
    ).toBeEnabled();
    const secondPopup = page.waitForEvent("popup");
    await page.getByRole("button", { name: signIn, exact: true }).click();
    const second = await secondPopup;
    await expect(
      second.getByRole("heading", { name: "Approve Business device" }),
    ).toBeVisible();
    expect(requests).toBe(2);
    await second.close();
  });
