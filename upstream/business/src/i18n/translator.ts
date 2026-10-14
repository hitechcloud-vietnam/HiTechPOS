export type Interpolation = Readonly<Record<string, string | number>>;
export type PluralMessage = {
  argument: string;
  forms: Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
};
export type LanguageDefinition = {
  code: string;
  name: string;
  formatLocale: string;
  rtl: boolean;
};

function placeholders(message: string) {
  return [...message.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join("|");
}

/** Reject incomplete packs before they can be selected, including lost values. */
export function validateCatalog<K extends string>(
  reference: Record<K, string>,
  candidate: unknown,
): asserts candidate is Record<K, string> {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    throw new Error("Invalid language catalog");
  const entries = candidate as Record<string, unknown>;
  const keys = Object.keys(reference);
  if (Object.keys(entries).length !== keys.length)
    throw new Error("Language catalog has missing or extra messages");
  for (const key of keys as K[]) {
    const message = Object.hasOwn(entries, key) ? entries[key] : null;
    if (
      typeof message !== "string" ||
      !message.trim() ||
      placeholders(message) !== placeholders(reference[key])
    )
      throw new Error(`Invalid translated message: ${key}`);
  }
}

export function createTranslator<K extends string>(
  reference: Record<K, string>,
  languages: readonly LanguageDefinition[],
  catalogs: Readonly<Record<string, Record<K, string>>>,
  fallback = "en",
  plurals: Readonly<Record<string, Partial<Record<K, PluralMessage>>>> = {},
) {
  const definitions = new Map(
    languages.map((language) => [language.code, language]),
  );
  const available = new Map<string, Readonly<Record<K, string>>>();
  for (const [code, catalog] of Object.entries(catalogs)) {
    if (!definitions.has(code)) throw new Error("Unknown catalog language");
    validateCatalog(reference, catalog);
    // Do not let later mutations silently change validated financial wording.
    available.set(code, Object.freeze({ ...catalog }));
  }
  if (!available.has(fallback)) throw new Error("Missing fallback language");
  const pluralMessages = new Map<string, Map<K, PluralMessage>>();
  const categories = new Set(["zero", "one", "two", "few", "many", "other"]);
  for (const [code, messages] of Object.entries(plurals)) {
    if (!available.has(code))
      throw new Error("Unknown plural catalog language");
    const entries = new Map<K, PluralMessage>();
    for (const key of Object.keys(messages) as K[]) {
      const message = messages[key]!;
      if (
        !Object.hasOwn(reference, key) ||
        !message ||
        !/^\w+$/.test(message.argument) ||
        !placeholders(reference[key]).split("|").includes(message.argument) ||
        !message.forms ||
        !Object.hasOwn(message.forms, "other")
      )
        throw new Error(`Invalid plural message: ${key}`);
      for (const [category, form] of Object.entries(message.forms)) {
        if (
          !categories.has(category) ||
          typeof form !== "string" ||
          !form.trim() ||
          placeholders(form) !== placeholders(reference[key])
        )
          throw new Error(`Invalid plural form: ${key}`);
      }
      entries.set(
        key,
        Object.freeze({
          argument: message.argument,
          forms: Object.freeze({ ...message.forms }),
        }),
      );
    }
    pluralMessages.set(code, entries);
  }
  const numberFormats = new Map<string, Intl.NumberFormat>();
  const pluralRules = new Map<string, Intl.PluralRules>();
  let current = fallback;
  const listeners = new Set<() => void>();
  const getLanguage = () => definitions.get(current)!;
  return {
    getLocale: () => current,
    getLanguage,
    available: (code: string) => available.has(code),
    resolveLocale(preferences: readonly string[]) {
      for (const preference of preferences) {
        const code = preference
          .trim()
          .replace(/_/g, "-")
          .toLowerCase()
          .split("-")[0]!;
        if (available.has(code)) return code;
      }
      return fallback;
    },
    setLocale(code: string) {
      if (!available.has(code)) return false;
      if (current === code) return true;
      current = code;
      for (const listener of [...listeners]) listener();
      return true;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    translate(key: K, values: Interpolation = {}) {
      const catalog = available.get(current)!;
      if (!Object.hasOwn(catalog, key)) throw new Error("Unknown message key");
      const locale = getLanguage().formatLocale;
      let message = catalog[key];
      const plural = pluralMessages.get(current)?.get(key);
      if (plural) {
        const count = Object.hasOwn(values, plural.argument)
          ? values[plural.argument]
          : undefined;
        if (typeof count !== "number" || !Number.isFinite(count))
          throw new Error(`Plural message requires numeric ${plural.argument}`);
        if (!pluralRules.has(locale))
          pluralRules.set(locale, new Intl.PluralRules(locale));
        message =
          plural.forms[pluralRules.get(locale)!.select(count)] ??
          plural.forms.other;
      }
      return message.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
        if (!Object.hasOwn(values, name)) return placeholder;
        const raw = values[name];
        if (!numberFormats.has(locale))
          numberFormats.set(
            locale,
            new Intl.NumberFormat(locale, { maximumFractionDigits: 20 }),
          );
        const value =
          typeof raw === "number"
            ? numberFormats.get(locale)!.format(raw)
            : String(raw);
        // Keep account names, ISO dates and currency amounts in their own bidi run.
        return getLanguage().rtl ? `\u2068${value}\u2069` : value;
      });
    },
  };
}
