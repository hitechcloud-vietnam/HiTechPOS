import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import en from "../src/i18n/en.json";
import imported from "../src/i18n/imported.json";
import mobile from "../src/i18n/mobile.json";
import { translator, translationCoverage, detectLocale } from "../src/i18n";
import { languages } from "../src/i18n/registry";

test("startup language detection works without Object.hasOwn", () => {
  const original = Object.getOwnPropertyDescriptor(Object, "hasOwn")!;
  try {
    Object.defineProperty(Object, "hasOwn", { ...original, value: undefined });
    assert.equal(detectLocale("ta-IN"), "ta");
    assert.equal(detectLocale("en-IN"), "en");
    assert.equal(detectLocale("unknown"), "en");
    assert.equal(
      translationCoverage("ta").translated,
      translationCoverage("ta").total,
    );
  } finally {
    Object.defineProperty(Object, "hasOwn", original);
  }
});

test("every supported POS language supplies every mobile message without English fallback", () => {
  assert.equal(new Set(languages.map((l) => l.code)).size, 18);
  assert.deepEqual(
    languages
      .filter((l) => l.code !== "en")
      .map((l) => l.code)
      .sort(),
    Object.keys(imported).sort(),
  );
  for (const language of languages) {
    const pack: Record<string, string> =
      language.code === "en"
        ? en
        : {
            ...imported[language.code],
            ...mobile[language.code],
          };
    for (const key of Object.keys(en)) {
      assert.ok(pack[key]?.trim(), `${language.code}.${key} is missing`);
      assert.doesNotMatch(
        pack[key]!,
        /\uFFFD|<script|\[object Object\]/,
        `${language.code}.${key}`,
      );
      assert.equal(translator(language.code)(key), pack[key]);
    }
    assert.deepEqual(translationCoverage(language.code), {
      translated: Object.keys(en).length,
      total: Object.keys(en).length,
    });
  }
});

test("message references cannot silently fall back to the generic error", () => {
  const source = fs.readFileSync(
    new URL("../src/App.tsx", import.meta.url),
    "utf8",
  );
  const connections = fs.readFileSync(
    new URL("../src/components/Connections.tsx", import.meta.url),
    "utf8",
  );
  for (const match of (source + connections).matchAll(
    /\bt\("([A-Za-z]+)"\)/g,
  )) {
    assert.ok(Object.hasOwn(en, match[1]!), `Missing message: ${match[1]}`);
  }
});

test("regional device locales resolve to the bundled language, including underscore tags", () => {
  for (const language of languages) {
    assert.equal(
      detectLocale(`${language.code.toUpperCase()}-IN`),
      language.code,
    );
    assert.equal(detectLocale(`${language.code}_LK`), language.code);
  }
  assert.equal(detectLocale("xx-YY"), "en");
  assert.equal(detectLocale(""), "en");
  assert.deepEqual(
    languages.filter((l) => l.rtl).map((l) => l.code),
    ["ar"],
  );
});
