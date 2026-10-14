/** Bundle locale data when the host lacks any release language. No network fetch. */
// Hermes can omit entire Intl APIs, not just individual language data.
// Load locale-matching prerequisites before any dependent formatter polyfill.
if (typeof Intl.getCanonicalLocales !== "function")
  require("@formatjs/intl-getcanonicallocales/polyfill-force.js");
if (typeof Intl.Locale !== "function")
  require("@formatjs/intl-locale/polyfill-force.js");
const NativeDateTimeFormat = Intl.DateTimeFormat;
export const deviceFormatting = new NativeDateTimeFormat().resolvedOptions();
/** Re-read the OS timezone after travel or a settings change while backgrounded. */
export function refreshFormattingTimeZone() {
  const formatter = Intl.DateTimeFormat as typeof Intl.DateTimeFormat & {
    __setDefaultTimeZone?: (zone: string) => void;
  };
  formatter.__setDefaultTimeZone?.(
    new NativeDateTimeFormat().resolvedOptions().timeZone,
  );
}
const locales = [
  "en",
  "en-IN",
  "en-CA",
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
  "pt-PT",
  "id",
  "th",
  "de",
  "sw",
  "nl",
  "it",
];
/** Some Hermes versions expose NumberFormat but reject or round BigInt values. */
function supportsExactIntegers() {
  try {
    return (
      new Intl.NumberFormat("en", { useGrouping: false })
        .formatToParts(9007199254740993n)
        .filter((part) => part.type === "integer")
        .map((part) => part.value)
        .join("") === "9007199254740993"
    );
  } catch {
    return false;
  }
}
if (
  typeof Intl.PluralRules !== "function" ||
  locales.some(
    (locale) => Intl.PluralRules.supportedLocalesOf(locale).length === 0,
  )
) {
  require("@formatjs/intl-pluralrules/polyfill-force.js");
  require("@formatjs/intl-pluralrules/locale-data/en.js");
  require("@formatjs/intl-pluralrules/locale-data/ta.js");
  require("@formatjs/intl-pluralrules/locale-data/hi.js");
  require("@formatjs/intl-pluralrules/locale-data/ml.js");
  require("@formatjs/intl-pluralrules/locale-data/kn.js");
  require("@formatjs/intl-pluralrules/locale-data/te.js");
  require("@formatjs/intl-pluralrules/locale-data/si.js");
  require("@formatjs/intl-pluralrules/locale-data/ne.js");
  require("@formatjs/intl-pluralrules/locale-data/ar.js");
  require("@formatjs/intl-pluralrules/locale-data/fr.js");
  require("@formatjs/intl-pluralrules/locale-data/es.js");
  require("@formatjs/intl-pluralrules/locale-data/pt.js");
  require("@formatjs/intl-pluralrules/locale-data/pt-PT.js");
  require("@formatjs/intl-pluralrules/locale-data/id.js");
  require("@formatjs/intl-pluralrules/locale-data/th.js");
  require("@formatjs/intl-pluralrules/locale-data/de.js");
  require("@formatjs/intl-pluralrules/locale-data/sw.js");
  require("@formatjs/intl-pluralrules/locale-data/nl.js");
  require("@formatjs/intl-pluralrules/locale-data/it.js");
}
if (
  typeof Intl.NumberFormat !== "function" ||
  !supportsExactIntegers() ||
  locales.some(
    (locale) => Intl.NumberFormat.supportedLocalesOf(locale).length === 0,
  )
) {
  require("@formatjs/intl-numberformat/polyfill-force.js");
  require("@formatjs/intl-numberformat/locale-data/en.js");
  require("@formatjs/intl-numberformat/locale-data/en-IN.js");
  require("@formatjs/intl-numberformat/locale-data/en-CA.js");
  require("@formatjs/intl-numberformat/locale-data/ta.js");
  require("@formatjs/intl-numberformat/locale-data/hi.js");
  require("@formatjs/intl-numberformat/locale-data/ml.js");
  require("@formatjs/intl-numberformat/locale-data/kn.js");
  require("@formatjs/intl-numberformat/locale-data/te.js");
  require("@formatjs/intl-numberformat/locale-data/si.js");
  require("@formatjs/intl-numberformat/locale-data/ne.js");
  require("@formatjs/intl-numberformat/locale-data/ar.js");
  require("@formatjs/intl-numberformat/locale-data/fr.js");
  require("@formatjs/intl-numberformat/locale-data/es.js");
  require("@formatjs/intl-numberformat/locale-data/pt.js");
  require("@formatjs/intl-numberformat/locale-data/pt-PT.js");
  require("@formatjs/intl-numberformat/locale-data/id.js");
  require("@formatjs/intl-numberformat/locale-data/th.js");
  require("@formatjs/intl-numberformat/locale-data/de.js");
  require("@formatjs/intl-numberformat/locale-data/sw.js");
  require("@formatjs/intl-numberformat/locale-data/nl.js");
  require("@formatjs/intl-numberformat/locale-data/it.js");
}
if (
  locales.some(
    (locale) => Intl.DateTimeFormat.supportedLocalesOf(locale).length === 0,
  )
) {
  require("@formatjs/intl-datetimeformat/polyfill-force.js");
  require("@formatjs/intl-datetimeformat/locale-data/en.js");
  require("@formatjs/intl-datetimeformat/locale-data/en-IN.js");
  require("@formatjs/intl-datetimeformat/locale-data/en-CA.js");
  require("@formatjs/intl-datetimeformat/locale-data/ta.js");
  require("@formatjs/intl-datetimeformat/locale-data/hi.js");
  require("@formatjs/intl-datetimeformat/locale-data/ml.js");
  require("@formatjs/intl-datetimeformat/locale-data/kn.js");
  require("@formatjs/intl-datetimeformat/locale-data/te.js");
  require("@formatjs/intl-datetimeformat/locale-data/si.js");
  require("@formatjs/intl-datetimeformat/locale-data/ne.js");
  require("@formatjs/intl-datetimeformat/locale-data/ar.js");
  require("@formatjs/intl-datetimeformat/locale-data/fr.js");
  require("@formatjs/intl-datetimeformat/locale-data/es.js");
  require("@formatjs/intl-datetimeformat/locale-data/pt.js");
  require("@formatjs/intl-datetimeformat/locale-data/pt-PT.js");
  require("@formatjs/intl-datetimeformat/locale-data/id.js");
  require("@formatjs/intl-datetimeformat/locale-data/th.js");
  require("@formatjs/intl-datetimeformat/locale-data/de.js");
  require("@formatjs/intl-datetimeformat/locale-data/sw.js");
  require("@formatjs/intl-datetimeformat/locale-data/nl.js");
  require("@formatjs/intl-datetimeformat/locale-data/it.js");
  require("@formatjs/intl-datetimeformat-calendar-buddhist");
  require("@formatjs/intl-datetimeformat-calendar-buddhist/locale-data/th.js");
  require("@formatjs/intl-datetimeformat/add-all-tz.js");
  refreshFormattingTimeZone();
}
