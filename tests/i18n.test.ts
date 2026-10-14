import test from "node:test";
import assert from "node:assert/strict";
import { createTranslator, validateCatalog } from "../src/i18n/translator";
import { releaseLanguages, t, bundledCatalogs, translator } from "../src/i18n";
import { normalizeDigits, pinInput } from "../src/i18n/digits";

const messages = { amount: "Pay {value}", state: "Approved" };

test("native decimal keyboards preserve PIN digits and schedule punctuation", () => {
  for (const pin of [
    "٣١٤١٥٩",
    "۳۱۴۱۵۹",
    "३१४१५९",
    "௩௧௪௧௫௯",
    "౩౧౪౧౫౯",
    "೩೧೪೧೫೯",
    "൩൧൪൧൫൯",
    "๓๑๔๑๕๙",
    "３１４１５９",
  ]) {
    assert.equal(pinInput(pin), "314159");
  }
  assert.equal(pinInput("12345678"), "123456");
  assert.equal(pinInput("12a٣-٤"), "1234");
  assert.equal(normalizeDigits("٢٣:٠٥"), "23:05");
  assert.equal(normalizeDigits("10:ab"), "10:ab");
});
const languages = [
  { code: "en", name: "English", formatLocale: "en-IN", rtl: false },
  { code: "fr", name: "Français", formatLocale: "fr", rtl: false },
  { code: "ar", name: "العربية", formatLocale: "ar", rtl: true },
];
const catalogs = {
  en: messages,
  fr: { amount: "Payer {value}", state: "Approuvé" },
  ar: { amount: "ادفع {value}", state: "تمت الموافقة" },
};

test("plural selection uses raw counts, all six categories, and immutable validated forms", () => {
  const forms = {
    zero: "zero {count}",
    one: "one {count}",
    two: "two {count}",
    few: "few {count}",
    many: "many {count}",
    other: "other {count}",
  };
  const reference = { items: "Items: {count}" };
  const engine = createTranslator(
    reference,
    languages,
    { en: reference, ar: reference },
    "en",
    {
      ar: { items: { argument: "count", forms } },
    },
  );
  forms.one = "changed {count}";
  engine.setLocale("ar");
  for (const [count, category] of [
    [0, "zero"],
    [1, "one"],
    [2, "two"],
    [3, "few"],
    [11, "many"],
    [100, "other"],
  ] as const) {
    const output = engine.translate("items", { count });
    assert.ok(output.startsWith(`${category} \u2068`), output);
    assert.ok(output.endsWith("\u2069"));
  }
  for (const count of ["1", NaN, Infinity])
    assert.throws(
      () => engine.translate("items", { count }),
      /requires numeric/,
    );
  assert.throws(
    () => engine.translate("items", Object.create({ count: 1 })),
    /requires numeric/,
  );
  for (const forms of [
    { one: "One {count}" },
    { other: "Items {amount}" },
    { other: "Items {count}", few: "" },
    { other: "Items {count}", typo: "Items {count}" },
  ])
    assert.throws(
      () =>
        createTranslator(reference, languages, { en: reference }, "en", {
          // Deliberately malformed external message packs must fail at initialization.
          en: {
            items: { argument: "count", forms: forms as { other: string } },
          },
        }),
      /Invalid plural/,
    );
});

test("approval item counts use singular wording and locale digits without altering identifiers", () => {
  try {
    for (const [locale, singular, plural] of [
      ["en", "1 item on this bill", "2 items on this bill"],
      ["fr", "Article sur cette facture : 1", "Articles sur cette facture : 2"],
      ["es", "Artículo en esta cuenta: 1", "Artículos en esta cuenta: 2"],
      ["pt", "Artigo nesta conta: 1", "Artigos nesta conta: 2"],
      ["it", "Articolo in questo conto: 1", "Articoli in questo conto: 2"],
      ["nl", "Artikel op deze rekening: 1", "Artikelen op deze rekening: 2"],
    ]) {
      translator.setLocale(locale!);
      assert.equal(t("decisionItems", { count: 1 }), singular);
      assert.equal(t("decisionItems", { count: 2 }), plural);
    }
    translator.setLocale("ne");
    assert.match(t("decisionItems", { count: 12 }), /१२/);
    assert.equal(
      t("itemPosition", { position: 2, total: 12 }),
      "१२ मध्ये वस्तु २",
    );
    assert.ok(t("decisionRequester", { name: "00123" }).includes("00123"));
    translator.setLocale("ar");
    assert.ok(
      t("decisionItems", { count: 2 }).includes(
        `\u2068${new Intl.NumberFormat("ar").format(2)}\u2069`,
      ),
    );
  } finally {
    translator.setLocale("en");
  }
});

test("language selection uses complete packs and preserves regional preference order", () => {
  const engine = createTranslator(messages, languages, catalogs);
  assert.equal(engine.resolveLocale(["zz-ZZ", "fr-CA", "ar"]), "fr");
  assert.equal(engine.resolveLocale(["AR_eg"]), "ar");
  assert.equal(engine.resolveLocale(["constructor"]), "en");
  assert.equal(engine.setLocale("fr"), true);
  assert.equal(
    engine.translate("amount", { value: "12,00 €" }),
    "Payer 12,00 €",
  );
  assert.equal(engine.setLocale("constructor"), false);
  assert.equal(engine.getLocale(), "fr");
});

test("catalog validation rejects missing messages and changed financial placeholders", () => {
  for (const invalid of [
    null,
    [],
    { amount: "Payer {value}" },
    { ...catalogs.fr, extra: "Extra" },
    { ...catalogs.fr, amount: "Payer" },
    { ...catalogs.fr, amount: "Payer {amount}" },
    { ...catalogs.fr, amount: "Payer {value} {value}" },
    { ...catalogs.fr, state: " " },
  ])
    assert.throws(() => validateCatalog(messages, invalid));
  assert.throws(() =>
    createTranslator(messages, languages, { fr: catalogs.fr }),
  );
});

test("RTL interpolation isolates amounts, never expands inherited or nested values", () => {
  const engine = createTranslator(messages, languages, catalogs);
  engine.setLocale("ar");
  assert.equal(
    engine.translate("amount", { value: "INR 12.00" }),
    "ادفع \u2068INR 12.00\u2069",
  );
  assert.equal(
    engine.translate("amount", Object.create({ value: "hidden" })),
    "ادفع {value}",
  );
  engine.setLocale("en");
  assert.equal(engine.translate("amount", { value: "{state}" }), "Pay {state}");
});

test("locale subscriptions update only on change and are removable", () => {
  const engine = createTranslator(messages, languages, catalogs);
  let changes = 0;
  const remove = engine.subscribe(() => {
    changes++;
  });
  engine.setLocale("fr");
  engine.setLocale("fr");
  engine.setLocale("missing");
  assert.equal(changes, 1);
  remove();
  engine.setLocale("en");
  assert.equal(changes, 1);
});

test("the release registry distinguishes target languages from complete selectable packs", () => {
  assert.equal(releaseLanguages.length, 18);
  assert.equal(
    new Set(releaseLanguages.map((language) => language.code)).size,
    18,
  );
  assert.equal(
    t("decisionPayable", { amount: "₹12.00" }),
    "Customer pays: ₹12.00",
  );
});

test("bundled non-English packs do not substitute English explanatory paragraphs", () => {
  for (const [locale, catalog] of Object.entries(bundledCatalogs)) {
    if (locale === "en") continue;
    validateCatalog(bundledCatalogs.en, catalog);
    for (const key of Object.keys(
      bundledCatalogs.en,
    ) as (keyof typeof bundledCatalogs.en)[]) {
      if (bundledCatalogs.en[key].length > 40)
        assert.notEqual(
          catalog[key],
          bundledCatalogs.en[key],
          `${locale}: ${key}`,
        );
    }
  }
});
