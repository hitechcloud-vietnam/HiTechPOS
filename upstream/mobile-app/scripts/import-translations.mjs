import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = process.argv[2];
if (!source) throw new Error("Pass the POS languages directory explicitly.");
const en = JSON.parse(
  fs.readFileSync(path.join(root, "src/i18n/en.json"), "utf8"),
);
const desktop = JSON.parse(
  fs.readFileSync(path.join(source, "_english.json"), "utf8"),
);
const normalize = (s) => String(s).trim().toLowerCase().replace(/\s+/g, " ");
const index = new Map(
  Object.entries(desktop).map(([k, v]) => [normalize(v), k]),
);
const codes = [
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
];
const result = {},
  coverage = {};
const mobile = JSON.parse(
  fs.readFileSync(path.join(root, "src/i18n/mobile.json"), "utf8"),
);
for (const code of codes) {
  const pack = JSON.parse(
    fs.readFileSync(path.join(source, code + ".json"), "utf8"),
  );
  result[code] = {};
  for (const [k, text] of Object.entries(en)) {
    const sourceKey = index.get(normalize(text));
    if (
      sourceKey &&
      typeof pack[sourceKey] === "string" &&
      pack[sourceKey].trim()
    )
      result[code][k] = pack[sourceKey];
  }
  coverage[code] = {
    translated: Object.keys(en).filter(
      (key) => mobile[code]?.[key]?.trim() || result[code][key]?.trim(),
    ).length,
    total: Object.keys(en).length,
  };
}
fs.writeFileSync(
  path.join(root, "src/i18n/imported.json"),
  JSON.stringify(result, null, 2) + "\n",
);
fs.writeFileSync(
  path.join(root, "src/i18n/coverage.json"),
  JSON.stringify(coverage, null, 2) + "\n",
);
console.log(coverage);
