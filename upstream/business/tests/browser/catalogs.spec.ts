import { test, expect } from "@playwright/test";
import { bundledCatalogs, releaseLanguages } from "../../src/i18n";

test.use({ viewport: { width: 320, height: 780 } });
for (const [code, messages] of Object.entries(bundledCatalogs)) {
  test(`${code}: bundled language renders all sample tabs at narrow and enlarged text sizes`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      (locale) => localStorage.setItem("posnic.business.language", locale),
      code,
    );
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: messages.welcome }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", code);
    await page
      .getByRole("button", { name: messages.language, exact: true })
      .click();
    await expect(
      page.getByRole("radio", {
        name: releaseLanguages.find((language) => language.code === code)!.name,
        exact: true,
      }),
    ).toBeChecked();
    await page
      .getByRole("button", { name: messages.back, exact: true })
      .click();
    await page
      .getByRole("button", { name: messages.sample, exact: true })
      .click();
    for (const name of [
      messages.today,
      messages.insights,
      messages.inbox,
      messages.more,
    ]) {
      const tab = page.getByRole("tab", { name, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    // Browser preview approximation of text scaling, not native Dynamic Type evidence.
    await page.evaluate(() => {
      for (const element of document.querySelectorAll<HTMLElement>(
        '[dir="auto"]',
      )) {
        const style = getComputedStyle(element);
        const size = parseFloat(style.fontSize),
          height = parseFloat(style.lineHeight);
        element.style.fontSize = `${size * 2}px`;
        if (Number.isFinite(height))
          element.style.lineHeight = `${height * 2}px`;
      }
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const tabsFit = await page
      .getByRole("tab")
      .evaluateAll((tabs) =>
        tabs.every((tab) => tab.scrollWidth <= tab.clientWidth + 1),
      );
    expect(tabsFit).toBe(true);
    const leave = page.getByRole("button", {
      name: messages.leaveSample,
      exact: true,
    });
    await leave.scrollIntoViewIfNeeded();
    await expect(leave).toBeVisible();
    expect(errors).toEqual([]);
  });
}
