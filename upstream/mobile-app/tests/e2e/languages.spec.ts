import { test, expect } from "@playwright/test";
import { languages } from "../../src/i18n/registry";
import { translator } from "../../src/i18n";

for (const language of languages) {
  test(`${language.code}: localized setup, offline checkout and saved language on a small phone`, async ({
    page,
    context,
  }) => {
    const t = translator(language.code);
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto("/");
    await page.getByRole("button", { name: "Language", exact: true }).click();
    const choice = page.getByRole("radio").filter({ hasText: language.name });
    await choice.click();
    // The checked state is shown after the settings transaction completes.
    await expect(choice).toBeChecked();
    await page.reload();
    await expect(
      page.getByRole("button", { name: t("signIn"), exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(t("selfHostedHelp"), { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.getByTestId("start-training").click();
    await page.getByTestId("item-coffee").click();
    await context.setOffline(true);
    await page.getByTestId("view-cart").click();
    await page.getByTestId("take-payment").click();
    await page
      .getByRole("button", { name: new RegExp(`^${t("cash")} ·`) })
      .click();
    await page.getByTestId("cash-received").fill("100");
    await page.getByTestId("finish-cash").click();
    await expect(
      page.getByRole("heading", { name: t("saved"), exact: true }),
    ).toBeVisible();
    for (const tab of await page.getByRole("tab").all()) {
      expect(
        await tab.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
          );
          let text;
          while ((text = walker.nextNode())) {
            const range = document.createRange();
            range.selectNodeContents(text);
            for (const rect of range.getClientRects()) {
              if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
                return false;
            }
          }
          return true;
        }),
      ).toBeTruthy();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `test-results/language-${language.code}.png`,
    });
    await context.setOffline(false);
    await page.reload();
    await page.getByRole("tab", { name: t("receipts"), exact: true }).click();
    await expect(
      page.getByRole("heading", { name: t("receipts"), exact: true }),
    ).toBeVisible();
    await expect(page.getByText(t("noReceipts"), { exact: true })).toHaveCount(
      0,
    );
  });
}
