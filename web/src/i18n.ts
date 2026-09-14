import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import zh from "./locales/zh.json";
import id from "./locales/id.json";

// English is the default and the fallback. The detector remembers the user's
// choice in localStorage across sessions.
export const languages = [
  { code: "en", label: "English" },
  { code: "zh", label: "中文" },
  { code: "id", label: "Indonesia" },
];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
      id: { translation: id },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "zh", "id"],
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "cortex_lang",
    },
    interpolation: { escapeValue: false },
  });

export default i18n;
