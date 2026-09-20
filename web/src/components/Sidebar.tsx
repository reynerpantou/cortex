import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { modules } from "../lib/modules";
import UserMenu from "./UserMenu";

export default function Sidebar({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  return (
    <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <div className="sidebar-brand">
        <span className="brand-mark" aria-hidden="true" />
        {!collapsed && <span className="brand-name">{t("app.name")}</span>}
      </div>

      <nav className="sidebar-nav">
        {!collapsed && <div className="sidebar-group-label">{t("nav.overview")}</div>}
        <NavLink to="/" end className={({ isActive }) => `sidebar-link ${isActive ? "is-active" : ""}`}>
          <span className="sidebar-link-icon" aria-hidden="true">{"\u{1F3E0}"}</span>
          {!collapsed && <span>{t("nav.home")}</span>}
        </NavLink>
        {modules.map((m) => (
          <NavLink
            key={m.key}
            to={m.path}
            className={({ isActive }) => `sidebar-link ${isActive ? "is-active" : ""}`}
          >
            <span className="sidebar-link-icon" aria-hidden="true">{m.icon}</span>
            {!collapsed && <span>{t(m.navKey)}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <UserMenu collapsed={collapsed} />
      </div>
    </aside>
  );
}
