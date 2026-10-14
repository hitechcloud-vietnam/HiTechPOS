import type { Locale } from "../domain/types";
export const languages: {
  code: Locale;
  name: string;
  beta: boolean;
  rtl?: boolean;
}[] = [
  { code: "en", name: "English", beta: false },
  { code: "ta", name: "தமிழ்", beta: true },
  { code: "hi", name: "हिन्दी", beta: true },
  { code: "ml", name: "മലയാളം", beta: true },
  { code: "kn", name: "ಕನ್ನಡ", beta: true },
  { code: "te", name: "తెలుగు", beta: true },
  { code: "si", name: "සිංහල", beta: true },
  { code: "ne", name: "नेपाली", beta: true },
  { code: "ar", name: "العربية", beta: true, rtl: true },
  { code: "fr", name: "Français", beta: true },
  { code: "es", name: "Español", beta: true },
  { code: "pt", name: "Português", beta: true },
  { code: "id", name: "Bahasa Indonesia", beta: true },
  { code: "th", name: "ไทย", beta: true },
  { code: "de", name: "Deutsch", beta: true },
  { code: "sw", name: "Kiswahili", beta: true },
  { code: "nl", name: "Nederlands", beta: true },
  { code: "it", name: "Italiano", beta: true },
];
