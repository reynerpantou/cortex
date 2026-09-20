import { useState } from "react";
import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Sidebar from "./Sidebar";

const MOBILE_QUERY = "(max-width: 720px)";

export default function Layout() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("cortex_sidebar_collapsed") === "1");
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("cortex_sidebar_collapsed", next ? "1" : "0");
      return next;
    });
  };

  // On desktop this toggles the icon-only rail; on mobile the sidebar is an
  // off-canvas drawer by default, so the same button opens/closes it instead.
  const toggleSidebar = () => {
    if (window.matchMedia(MOBILE_QUERY).matches) {
      setMobileOpen((v) => !v);
    } else {
      toggleCollapsed();
    }
  };

  return (
    <div className="app">
      <Sidebar collapsed={collapsed} mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} />
      {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />}
      <div className="main-pane">
        <div className="main-topline">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggleSidebar}
            aria-label={t(collapsed ? "nav.expandSidebar" : "nav.collapseSidebar")}
          >
            {"▤"}
          </button>
        </div>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
