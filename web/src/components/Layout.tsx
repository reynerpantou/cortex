import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import LanguageSwitcher from "./LanguageSwitcher";

export default function Layout() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">{t("app.name")}</span>
          <span className="brand-tag">{t("app.tagline")}</span>
        </div>
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "is-active" : "")}>
            {t("nav.home")}
          </NavLink>
          <NavLink to="/radar" className={({ isActive }) => (isActive ? "is-active" : "")}>
            {t("nav.radar")}
          </NavLink>
        </nav>
        <div className="topbar-right">
          <LanguageSwitcher />
          {user && <span className="who">{user.username}</span>}
          <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
            {t("nav.logout")}
          </button>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
