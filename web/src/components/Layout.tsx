import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { modules } from "../lib/modules";
import UserMenu from "./UserMenu";

export default function Layout() {
  const { t } = useTranslation();
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-name">{t("app.name")}</span>
          </div>
          <nav className="nav">
            <NavLink to="/" end className={({ isActive }) => (isActive ? "is-active" : "")}>
              {t("nav.home")}
            </NavLink>
            {modules.map((m) => (
              <NavLink key={m.key} to={m.path} className={({ isActive }) => (isActive ? "is-active" : "")}>
                {t(m.navKey)}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-right">
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
