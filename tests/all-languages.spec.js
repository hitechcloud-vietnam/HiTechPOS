import { test, expect } from "@playwright/test";
import fs from "node:fs";
const manifest = JSON.parse(
  fs.readFileSync("assets/common/locales/manifest.json", "utf8"),
);

test("all 30 languages are available before sign-in and retained offline", async ({
  page,
}) => {
  await page.goto("/index.html");
  await expect(page.locator("#setup-language option")).toHaveCount(
    manifest.length,
  );
  for (const language of manifest) {
    await page.locator("#setup-language").selectOption(language.code);
    await expect(page.locator("html")).toHaveAttribute("lang", language.code);
    await expect(page.locator("html")).toHaveAttribute("dir", language.dir);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (language.code !== "en") {
      const words = JSON.parse(
        fs.readFileSync(`assets/common/locales/${language.code}.json`, "utf8"),
      );
      await expect(page.locator("#captain-connect")).toHaveText(
        words["Continue"],
      );
    }
  }
  await page.context().setOffline(true);
  await page.locator("#setup-language").selectOption("ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.context().setOffline(false);
  await page.reload();
  await expect(page.locator("#setup-language")).toHaveValue("ar");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-artifacts/captain-arabic-setup.png",
    fullPage: true,
  });
});

test("changing dynamic messages and attributes stay current across languages", async ({
  page,
}) => {
  await page.goto("/index.html");
  await page.evaluate(() => {
    const node = document.createElement("p");
    node.id = "language-message";
    node.textContent = "Waiting to send";
    document.body.append(node);
    const name = document.createElement("p");
    name.id = "shop-item";
    name.textContent = "Total";
    name.setAttribute("translate", "no");
    document.body.append(name);
    I18N.use("ta");
  });
  const ta = JSON.parse(
    fs.readFileSync("assets/common/locales/ta.json", "utf8"),
  );
  await expect(page.locator("#language-message")).toHaveText(
    ta["Waiting to send"],
  );
  await page.evaluate(
    () =>
      (document.querySelector("#language-message").firstChild.nodeValue =
        "Sent to the kitchen"),
  );
  await expect(page.locator("#language-message")).toHaveText(
    ta["Sent to the kitchen"],
  );
  await page.locator("#setup-language").selectOption("ar");
  const ar = JSON.parse(
    fs.readFileSync("assets/common/locales/ar.json", "utf8"),
  );
  await expect(page.locator("#language-message")).toHaveText(
    ar["Sent to the kitchen"],
  );
  await expect(page.locator("#shop-item")).toHaveText("Total");
  await page.evaluate(
    () =>
      (document.querySelector("#captain-server").placeholder =
        "Search the menu"),
  );
  await expect(page.locator("#captain-server")).toHaveAttribute(
    "placeholder",
    ar["Search the menu"],
  );
  await page.locator("#setup-language").selectOption("en");
  await expect(page.locator("#language-message")).toHaveText(
    "Sent to the kitchen",
  );
  await expect(page.locator("#captain-server")).toHaveAttribute(
    "placeholder",
    "Search the menu",
  );
});

for (const code of ["ar", "ur"]) {
  test(`${code} setup fits a narrow phone and keeps addresses left-to-right`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto("/index.html");
    await page.locator("#setup-language").selectOption(code);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const words = JSON.parse(
      fs.readFileSync(`assets/common/locales/${code}.json`, "utf8"),
    );
    await expect(page.locator("#captain-connect")).toHaveText(
      words["Continue"],
    );
    await expect(page.locator("#captain-server")).toHaveCSS("direction", "ltr");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-artifacts/captain-${code}-setup.png`,
      fullPage: true,
    });
  });
}

for (const code of ["ta", "hi", "ar", "ur", "ja", "zh-CN"]) {
  test(`ordering in ${code} preserves shop content and saves offline`, async ({
    page,
  }) => {
    const { onTheMenu, item, SHOP_ORIGIN } = await import("./support/shop.js");
    await page.addInitScript(
      (code) => localStorage.setItem("posnic.language", code),
      code,
    );
    await onTheMenu(page, "nothing", {
      menu: [
        { category_name: "Orders", items: [item("p-total", "Total", 100)] },
      ],
    });
    await expect(page.locator(".dish-name")).toHaveText(/Total/);
    await expect(page.locator(".menu-chip").first()).toHaveText("Orders");
    await page.locator('.btn-add[data-id="p-total"]').click();
    await page.locator("#next-btn").click();
    await expect(page).toHaveURL(/cart\.html$/);
    await expect(page.locator(".bill-name")).toHaveText("Total");
    const words = JSON.parse(
      fs.readFileSync(`assets/common/locales/${code}.json`, "utf8"),
    );
    await expect(page.locator("#next-btn")).toContainText(
      words["Send to kitchen"],
    );
    await page.route(`${SHOP_ORIGIN}/**`, (route) => route.abort());
    await page.locator("#next-btn").click();
    await expect(page).toHaveURL(/kot-management\.html$/);
    await expect
      .poll(() => page.evaluate(() => window.OrderQueue?.count()))
      .toBe(1);
    const order = await page.evaluate(() => OrderQueue.all()[0]);
    expect(order.body.items[0].item_name).toBe("Total");
    expect(order.body.kiosk_table_no).toBe("T1");
    await expect(page.locator(".floor-new")).toBeVisible();
    await expect(page.locator("#posnic-unsent-text")).toHaveText(
      words["{0} order waiting to sync"].replace("{0}", "1"),
    );
    await page.locator('#posnic-unsent a[href="pending.html"]').click();
    await expect(page.locator("#posnic-unsent-rows strong")).toContainText(
      words["Waiting to send"],
    );
    await page.locator("#pending-back").click();
    await expect(page).toHaveURL(/kot-management\.html$/);
    await expect(page.locator("html")).toHaveAttribute("lang", code);
    await expect(page.locator(".floor-new")).toBeVisible();
    await expect(page.locator("#posnic-unsent-text")).toHaveText(
      words["{0} order waiting to sync"].replace("{0}", "1"),
    );
    await page.screenshot({
      path: `test-artifacts/captain-${code}-pending.png`,
      fullPage: true,
    });
    await page.reload();
    expect(await page.evaluate(() => OrderQueue.all()[0].key)).toBe(order.key);
    await expect(page.locator("html")).toHaveAttribute("lang", code);
  });
}
