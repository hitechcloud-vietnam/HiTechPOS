import { test, expect, type Page } from "@playwright/test";
test.use({ hasTouch: true });

async function sale(page: Page) {
  await page.getByTestId("item-coffee").click();
  await page.getByTestId("view-cart").click();
  await page.getByTestId("take-payment").click();
  await page.getByRole("button", { name: /^Cash ·/ }).click();
  await page.getByTestId("cash-received").fill("100");
  await page.getByTestId("finish-cash").click();
  await expect(page.getByTestId("receipt-number")).toBeVisible();
}

test("receipt history has bounded navigation and refresh keeps the active basket", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("start-training").click();
  await sale(page);
  const first = await page.getByTestId("receipt-number").innerText();
  await expect(page.getByTestId("next-receipt")).toHaveCount(0);
  await page.getByTestId("new-sale").click();
  await sale(page);
  const second = await page.getByTestId("receipt-number").innerText();
  await page.getByRole("tab", { name: "Receipts", exact: true }).click();
  await page.getByText(second, { exact: true }).click();
  await expect(page.getByTestId("previous-receipt")).toBeDisabled();
  await page.getByTestId("next-receipt").click();
  await expect(page.getByTestId("receipt-number")).toHaveText(first);
  await expect(page.getByTestId("next-receipt")).toBeDisabled();
  await page.getByTestId("previous-receipt").click();
  await expect(page.getByTestId("receipt-number")).toHaveText(second);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "test-results/receipt-gesture-controls.png" });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Receipts" })).toBeVisible();
  await page.getByRole("tab", { name: "Sell", exact: true }).click();
  await page.getByTestId("item-coffee").click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByTestId("view-cart")).toContainText("35");
  await page.setViewportSize({ width: 320, height: 420 });
  await page.getByTestId("screen-scroll").evaluate((el) => {
    el.scrollTop = 150;
  });
  await expect
    .poll(() =>
      page.getByTestId("screen-scroll").evaluate((el) => el.scrollTop),
    )
    .toBeGreaterThan(0);
  await page.getByRole("tab", { name: "Sell", exact: true }).click();
  await expect
    .poll(() =>
      page.getByTestId("screen-scroll").evaluate((el) => el.scrollTop),
    )
    .toBe(0);
});

test("touch swipes change only receipt details and leave edge swipes alone", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByTestId("start-training").click();
  await sale(page);
  const first = await page.getByTestId("receipt-number").innerText();
  await page.getByTestId("new-sale").click();
  await sale(page);
  const second = await page.getByTestId("receipt-number").innerText();
  await page.getByRole("tab", { name: "Receipts", exact: true }).click();
  await page.getByText(second, { exact: true }).click();
  const client = await context.newCDPSession(page);
  async function swipe(from: number, to: number) {
    const bounds = await page.getByTestId("receipt-number").boundingBox();
    const y = bounds!.y + bounds!.height / 2;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: from, y }],
    });
    for (let i = 1; i <= 6; i++) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: from + ((to - from) * i) / 6, y }],
      });
    }
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  await swipe(300, 90);
  await expect(page.getByTestId("receipt-number")).toHaveText(first);
  await swipe(90, 300);
  await expect(page.getByTestId("receipt-number")).toHaveText(second);
  await swipe(380, 90);
  await expect(page.getByTestId("receipt-number")).toHaveText(second);
});
