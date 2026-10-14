import { test, expect, type Page } from "@playwright/test";
import ar from "../../src/i18n/ar.json";

async function swipe(page: Page, from: [number, number], to: [number, number]) {
  const touch = await page.context().newCDPSession(page);
  try {
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: from[0], y: from[1] }],
    });
    for (let step = 1; step <= 7; step++)
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: from[0] + ((to[0] - from[0]) * step) / 7,
            y: from[1] + ((to[1] - from[1]) * step) / 7,
          },
        ],
      });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await touch.detach();
  }
}

test("language choice persists and changing it preserves the sample screen and branch access", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Language", exact: true }).click();
  await page.getByRole("radio", { name: "Français", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Votre activité à portée de main." }),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Français", exact: true }),
  ).toBeChecked();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("posnic.business.language")),
    )
    .toBe("fr");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Votre activité à portée de main." }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await page
    .getByRole("button", { name: "Explorer l’entreprise de démonstration" })
    .click();
  await page.getByRole("tab", { name: "Plus", exact: true }).click();
  await page.getByRole("radio", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "More", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("button", { name: "Leave sample business" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Explore sample business" }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole("radio", { name: "Français", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("an unavailable or malformed saved language falls back without blocking startup", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("posnic.business.language", "constructor"),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your business. Within reach." }),
  ).toBeVisible();
});

test("Arabic uses RTL layout, localized amounts and mirrored interior record paging", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("posnic.business.language", "ar"),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: ar.welcome })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("button", { name: ar.sample, exact: true }).click();
  const money = new Intl.NumberFormat("ar", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(42850);
  await expect(page.getByText(money, { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: ar.insights, exact: true }).click();
  await page.getByRole("button", { name: "Masala dosa", exact: true }).click();
  await swipe(page, [150, 330], [240, 333]);
  await expect(
    page.getByRole("heading", { name: "Paneer wrap" }),
  ).toBeVisible();
  await page.getByRole("button", { name: ar.previous, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Masala dosa" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  for (const name of [ar.today, ar.insights, ar.inbox, ar.more]) {
    await page.getByRole("tab", { name, exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("radio", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(
    page.getByRole("tab", { name: "More", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("a normal LTR swipe pages once while a system-edge gesture leaves the record alone", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Explore sample business", exact: true })
    .click();
  await page.getByRole("tab", { name: "Insights", exact: true }).click();
  await page.getByRole("button", { name: "Masala dosa", exact: true }).click();
  await swipe(page, [250, 330], [160, 333]);
  await expect(
    page.getByRole("heading", { name: "Paneer wrap" }),
  ).toBeVisible();
  await swipe(page, [12, 330], [150, 333]);
  await expect(
    page.getByRole("heading", { name: "Paneer wrap" }),
  ).toBeVisible();
  await swipe(page, [160, 330], [250, 333]);
  await expect(
    page.getByRole("heading", { name: "Masala dosa" }),
  ).toBeVisible();
});
