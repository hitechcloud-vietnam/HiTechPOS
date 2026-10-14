import { test, expect } from "@playwright/test";
import { onTheMenu, item } from "./support/shop.js";
import fs from "node:fs";
const manifest = JSON.parse(
  fs.readFileSync("assets/common/locales/manifest.json", "utf8"),
);
test("menu actions remain translated before and after quantity updates in every language", async ({
  page,
}) => {
  await onTheMenu(page, "nothing", {
    menu: [{ category_name: "Orders", items: [item("p-total", "Total", 100)] }],
  });
  for (const language of manifest) {
    const words = JSON.parse(
      fs.readFileSync(`assets/common/locales/${language.code}.json`, "utf8"),
    );
    await page.evaluate((code) => I18N.use(code), language.code);
    const row = page.locator('.dish[data-id="p-total"]');
    await expect(row.locator(".btn-add")).toHaveText(words["ADD"]);
    await expect(row.locator(".dish-name")).toHaveText("Total");
    await row.locator(".btn-add").click();
    await expect(row.locator(".btn-increase")).toHaveAttribute(
      "aria-label",
      words["One more"],
    );
    await row.locator(".btn-decrease").click();
    await expect(row.locator(".btn-add")).toHaveText(words["ADD"]);
  }
  await page.evaluate(() => I18N.use("ta"));
  await page.screenshot({
    path: "test-builds/tamil-menu-audit.png",
    fullPage: true,
  });
});

test("main Tamil journeys have no untranslated interface labels", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("posnic.language", "ta"));
  await onTheMenu(page, "nothing");
  const report = {};
  async function collect(name) {
    await page.locator("body").waitFor();
    // I18N is registered in the head; the saved language is applied at DOM ready.
    await page.waitForFunction(() => window.I18N?.language() === "ta");
    report[name] = await page.evaluate(() => {
      const values = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      let node;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement,
          text = node.nodeValue.trim();
        if (
          !parent ||
          parent.closest('script,style,[translate="no"],[data-i18n-ignore]') ||
          !parent.getClientRects().length
        )
          continue;
        if (/[A-Za-z]{2}/.test(text) && I18N.t(text) === text)
          values.push(text);
      }
      return [...new Set(values)];
    });
  }
  await collect("menu");
  await page.locator(".btn-add").first().click();
  await page.locator("#next-btn").click();
  await expect(page).toHaveURL(/cart.html/);
  await collect("cart");
  for (const name of [
    "kot-management.html",
    "order-history.html",
    "me.html",
    "my-sales.html",
  ]) {
    await page.goto("/" + name);
    await page.waitForFunction(() => document.body && window.I18N);
    await collect(name);
  }
  for (const [screen, labels] of Object.entries(report)) {
    const unexpected = labels.filter(
      (label) =>
        !/^https?:\/\//.test(label) && !/^Captain [^A-Za-z]+$/.test(label),
    );
    expect(unexpected, screen).toEqual([]);
  }
});

test("Tamil search translates the whole custom-price action", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("posnic.language", "ta"));
  await onTheMenu(page, "nothing");
  await page.locator("#product-search-input").fill("Fish");
  const words = JSON.parse(
    fs.readFileSync("assets/common/locales/ta.json", "utf8"),
  );
  await expect(page.locator(".menu-quick-sale-btn")).toHaveText(
    words["Add “{1}” with a price"].replace("{1}", "Fish"),
  );
});
