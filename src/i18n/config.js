export const LOCALES = ["vi", "en", "zh-CN", "zh-TW"];
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "locale";
export const LOCALE_NAMES = {
  vi: "Tiếng Việt",
  en: "English (US)",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文（台灣）",
};
export function normalizeLocale(locale) {
  if (locale === "zh") return "zh-CN";
  return LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
}
export function isSupportedLocale(locale) {
  return LOCALES.includes(locale);
}
