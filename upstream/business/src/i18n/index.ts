import "./intl";
import en from "./en.json";
import fr from "./fr.json";
import ar from "./ar.json";
import ta from "./ta.json";
import hi from "./hi.json";
import es from "./es.json";
import pt from "./pt.json";
import id from "./id.json";
import de from "./de.json";
import it from "./it.json";
import nl from "./nl.json";
import sw from "./sw.json";
import ne from "./ne.json";
import th from "./th.json";
import ml from "./ml.json";
import kn from "./kn.json";
import te from "./te.json";
import si from "./si.json";
import { createTranslator, type Interpolation } from "./translator";
export type MessageKey = keyof typeof en;
/** Target registry, not a claim of completed Business translations. */
const definitions = [
  ["en", "English"],
  ["ta", "தமிழ்"],
  ["hi", "हिन्दी"],
  ["ml", "മലയാളം"],
  ["kn", "ಕನ್ನಡ"],
  ["te", "తెలుగు"],
  ["si", "සිංහල"],
  ["ne", "नेपाली"],
  ["ar", "العربية"],
  ["fr", "Français"],
  ["es", "Español"],
  ["pt", "Português"],
  ["id", "Bahasa Indonesia"],
  ["th", "ไทย"],
  ["de", "Deutsch"],
  ["sw", "Kiswahili"],
  ["nl", "Nederlands"],
  ["it", "Italiano"],
].map(([code, name]) => ({
  code: code!,
  name: name!,
  formatLocale:
    code === "en"
      ? "en-IN"
      : code === "pt"
        ? "pt-PT"
        : code === "th"
          ? "th-u-ca-buddhist"
          : code!,
  rtl: code === "ar",
}));
export const bundledCatalogs = {
  en,
  fr,
  ar,
  ta,
  hi,
  es,
  pt,
  id,
  de,
  it,
  nl,
  sw,
  ne,
  th,
  ml,
  kn,
  te,
  si,
};
export const translator = createTranslator<MessageKey>(
  en,
  definitions,
  bundledCatalogs,
  "en",
  Object.fromEntries(
    Object.entries({
      en: "{count} item on this bill",
      fr: "Article sur cette facture : {count}",
      es: "Artículo en esta cuenta: {count}",
      pt: "Artigo nesta conta: {count}",
      it: "Articolo in questo conto: {count}",
      nl: "Artikel op deze rekening: {count}",
    }).map(([code, one]) => [
      code,
      {
        decisionItems: {
          argument: "count",
          forms: {
            one,
            other:
              bundledCatalogs[code as keyof typeof bundledCatalogs]
                .decisionItems,
          },
        },
      },
    ]),
  ),
);
export const releaseLanguages = definitions.map((language) => ({
  ...language,
  status: translator.available(language.code) ? "preview" : "planned",
}));
export const getLocale = translator.getLocale;
export const getFormatLocale = () => translator.getLanguage().formatLocale;
export const isRTL = () => translator.getLanguage().rtl;
export const getTextAlign = (): "left" | "right" =>
  isRTL() ? "right" : "left";
export function t(key: MessageKey, values: Interpolation = {}) {
  return translator.translate(key, values);
}
