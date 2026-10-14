import { test, expect } from "@playwright/test";
for (const colorScheme of ["light", "dark"] as const) {
  test(`branded ${colorScheme} checkout fits a small phone`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await expect(
      page.getByRole("img", { name: "Posnic", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Create account · Free trial",
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/ux-connect-${colorScheme}.png`,
      fullPage: true,
    });
    await page.getByTestId("start-training").click();
    await page.getByTestId("item-coffee").click();
    await expect(page.getByTestId("view-cart")).toContainText("35");
    await page.screenshot({ path: `test-results/ux-sell-${colorScheme}.png` });
    await page.setViewportSize({ width: 320, height: 740 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await expect(page.getByTestId("view-cart")).toBeInViewport();
    await page.getByTestId("view-cart").click();
    await page.getByTestId("take-payment").click();
    await page.getByRole("button", { name: /^Cash ·/ }).click();
    await page.screenshot({
      path: `test-results/ux-cash-${colorScheme}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  });
}

test("favourites survive reload and starring does not add a sale line", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("start-training").click();
  await page.getByTestId("favourites-filter").click();
  await expect(page.getByTestId("item-coffee")).toHaveCount(0);
  await page.getByTestId("favourites-filter").click();
  await page.getByTestId("favourite-coffee").click();
  await expect(page.getByTestId("view-cart")).toBeDisabled();
  await page.getByTestId("favourites-filter").click();
  await expect(page.getByTestId("item-coffee")).toBeVisible();
  await expect(page.getByTestId("item-tea")).toHaveCount(0);
  await page.reload();
  await page.getByTestId("favourites-filter").click();
  await expect(page.getByTestId("item-coffee")).toBeVisible();
  await page.getByTestId("item-coffee").click();
  await expect(page.getByTestId("view-cart")).toContainText("35");
  await page.getByTestId("favourite-coffee").click();
  await expect(page.getByTestId("item-coffee")).toHaveCount(0);
  await expect(page.getByTestId("view-cart")).toContainText("35");
});
