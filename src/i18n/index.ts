import en from "./en.json";
import imported from "./imported.json";
import mobile from "./mobile.json";
import type { Locale } from "../domain/types";
export type TextKey = keyof typeof en;
export function translator(locale: Locale) {
  const pack =
    locale === "en"
      ? {}
      : {
          ...(imported as Record<string, Record<string, string>>)[locale],
          ...(mobile as Record<string, Record<string, string>>)[locale],
        };
  return (key: TextKey | string): string =>
    pack[key] ?? (en as Record<string, string>)[key] ?? en.unknownError;
}
export function translationCoverage(locale: Locale) {
  return locale === "en"
    ? { translated: Object.keys(en).length, total: Object.keys(en).length }
    : {
        translated: Object.keys({
          ...imported[locale],
          ...mobile[locale],
        }).filter((key) => Object.prototype.hasOwnProperty.call(en, key))
          .length,
        total: Object.keys(en).length,
      };
}
export function detectLocale(tag: string): Locale {
  const key = tag.trim().split(/[-_]/)[0]?.toLowerCase();
  return key && Object.prototype.hasOwnProperty.call(imported, key)
    ? (key as Locale)
    : "en";
}
