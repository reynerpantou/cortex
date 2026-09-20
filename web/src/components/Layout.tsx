import { useState } from "react";
import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Sidebar from "./Sidebar";

export default function Layout() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("cortex_sidebar_collapsed") === "1");

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("cortex_sidebar_collapsed", next ? "1" : "0");
      return next;
    });
  };

  return (
    <div className="app">
      <Sidebar collapsed={collapsed} />
      <div className="main-pane">
        <div className="main-topline">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggleCollapsed}
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
