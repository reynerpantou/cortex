import { useTranslation } from "react-i18next";
import { languages } from "../i18n";

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? "en";
  return (
    <div className="lang" role="group" aria-label="Language">
      {languages.map((l) => (
        <button
          key={l.code}
          type="button"
          className={`lang-opt ${current === l.code ? "is-active" : ""}`}
          aria-pressed={current === l.code}
          onClick={() => i18n.changeLanguage(l.code)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
