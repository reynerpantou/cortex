import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import { displayName } from "../lib/displayName";
import { modules } from "../lib/modules";

export default function Home() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title">
          {t("home.greeting")}
          {user ? `, ${displayName(user, i18n.resolvedLanguage ?? "en")}` : ""}
        </h1>
        <p className="page-lead">{t("home.lead")}</p>
      </header>

      <div className="module-grid">
        {modules.map((m) => (
          <Link key={m.key} to={m.path} className="module-card">
            <h2 className="module-card-title">{t(m.navKey)}</h2>
            <p className="module-card-desc">{t(m.descriptionKey)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
