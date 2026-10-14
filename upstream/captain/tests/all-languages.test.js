const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const manifest = require("../assets/common/locales/manifest.json");
const english = require("../assets/common/locales/en.json");
const { bundle } = require("../scripts/build-languages");
const root = path.join(__dirname, "..");

test("Captain ships 30 interface languages", () => {
  assert.deepEqual(
    manifest.map((l) => l.code).sort(),
    [
      "en",
      "ta",
      "hi",
      "ml",
      "kn",
      "te",
      "si",
      "ne",
      "ar",
      "fr",
      "es",
      "pt",
      "id",
      "th",
      "de",
      "sw",
      "nl",
      "it",
      "bn",
      "mr",
      "gu",
      "ur",
      "zh-CN",
      "zh-TW",
      "ja",
      "ko",
      "ru",
      "tr",
      "vi",
      "ms",
    ].sort(),
  );
  for (const code of ["ar", "ur"])
    assert.equal(manifest.find((l) => l.code === code).dir, "rtl");
});
test("every language contains all messages and preserves substitutions", () => {
  const fields = (value) => (value.match(/\{\d+\}/g) || []).sort();
  for (const { code } of manifest) {
    const words = JSON.parse(
      fs.readFileSync(
        path.join(root, "assets/common/locales", code + ".json"),
        "utf8",
      ),
    );
    assert.deepEqual(
      Object.keys(words).sort(),
      Object.keys(english).sort(),
      `${code} coverage`,
    );
    if (code !== "en") {
      for (const key of ["ADD", "Add", "Send to kitchen", "Connect to shop"]) {
        assert.notEqual(
          words[key],
          key,
          `${code}: untranslated primary action ${key}`,
        );
      }
    }
    for (const [key, value] of Object.entries(words)) {
      assert.equal(typeof value, "string", `${code}: ${key}`);
      assert.ok(value.trim(), `${code}: ${key}`);
      assert.deepEqual(fields(value), fields(key), `${code}: ${key}`);
      assert.ok(!value.includes("\uFFFD"), `${code}: damaged UTF-8`);
    }
  }
});
test("the offline bundle matches the editable catalogs and every page loads it", () => {
  assert.equal(
    fs.readFileSync(path.join(root, "assets/common/languages.js"), "utf8"),
    bundle(),
  );
  for (const name of fs
    .readdirSync(root)
    .filter((name) => name.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(root, name), "utf8");
    assert.match(html, /assets\/common\/languages\.js/, name);
    assert.ok(
      html.indexOf("assets/common/i18n.js") <
        html.indexOf("assets/common/languages.js"),
      name,
    );
  }
});
test("all local markup messages are covered except brands and address examples", () => {
  const { fromMarkup } = require("../scripts/tamil-gaps");
  const unchanged = new Set([
    "English",
    "Captain",
    "Posnic",
    "Posnic Cloud",
    "http://192.168.0.12:5555/api",
    "https://azure.posnic.io/api",
    "azure.posnic.io",
  ]);
  const missing = [...fromMarkup().keys()].filter(
    (key) => !english[key] && !unchanged.has(key),
  );
  assert.deepEqual(missing, []);
});
test("dynamic substitutions preserve numbers and never interpret translation markup", () => {
  const context = vm.createContext({});
  vm.runInContext(
    fs.readFileSync(path.join(root, "assets/common/i18n.js"), "utf8"),
    context,
  );
  const i18n = context.I18N;
  i18n.register("xx", {
    "{0} orders saved · Not sent to kitchen": "Gespeichert: {0}",
    "Waiting to send": "Warten",
    "{0} hr {1} min": "{0} Std. {1} Min.",
    "Table {0}": "Tisch {0}",
    "Table {0} · {1} {2}": "Tisch {0} · {1} {2}",
  });
  i18n.use("xx");
  assert.equal(
    i18n.t("3 orders saved · Not sent to kitchen"),
    "Gespeichert: 3",
  );
  assert.equal(i18n.t("2 hr 15 min"), "2 Std. 15 Min.");
  assert.equal(
    i18n.t("Table T1 · 10:30 · Waiting to send"),
    "Tisch T1 · 10:30 · Warten",
  );
  assert.equal(i18n.t("  Waiting   to send "), "Warten");
  assert.equal(
    i18n.format("{0} orders saved · Not sent to kitchen", ["<name>"]),
    "Gespeichert: <name>",
  );
  i18n.use("en");
  assert.equal(i18n.t("Waiting to send"), "Waiting to send");
});

test("HTML entities in voice and price controls match browser text", () => {
  const { decoded } = require("../scripts/tamil-gaps");
  assert.equal(
    decoded("&#128228; Send it to the kitchen"),
    "📤 Send it to the kitchen",
  );
  assert.equal(
    decoded("Add &ldquo;Fish&rdquo; with a price"),
    "Add “Fish” with a price",
  );
  assert.equal(decoded("Change today&#39;s price"), "Change today's price");
});

test("dynamic prices, stock and voice actions translate without changing shop content", () => {
  const context = vm.createContext({});
  vm.runInContext(
    fs.readFileSync(path.join(root, "assets/common/i18n.js"), "utf8"),
    context,
  );
  context.window = context;
  vm.runInContext(bundle(), context);
  for (const { code } of manifest) {
    context.I18N.use(code);
    const words = require("../assets/common/locales/" + code + ".json");
    for (const [key, value] of [
      ["Add “{1}” with a price", "Fish"],
      ["₹{0} each", "220.00"],
      ["Only {0} left", "3"],
      ["Number {0}", "7"],
      ["Token {0}", "42"],
    ]) {
      const source = key.replace(/\{\d+\}/, value);
      assert.equal(
        context.I18N.t(source),
        words[key].replace(/\{\d+\}/, value),
        code + ": " + key,
      );
    }
    for (const key of [
      "🎤 Say again",
      "👁 Read the order back",
      "📤 Send it to the kitchen",
      "🗑 Clear the order first",
      "Stop & check the order",
    ])
      assert.equal(context.I18N.t(key), words[key], code + ": " + key);
  }
});
