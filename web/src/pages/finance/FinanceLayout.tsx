import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { financeApi, type FinanceMeta } from "../../lib/finance";

interface FinanceCtx {
  meta: FinanceMeta;
  reloadMeta: () => Promise<void>;
}

const Ctx = createContext<FinanceCtx | null>(null);

export function useFinance(): FinanceCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useFinance must be used inside FinanceLayout");
  return ctx;
}

const TABS = [
  { to: "/finance", key: "finance.tabs.transactions", end: true },
  { to: "/finance/stats", key: "finance.tabs.stats" },
  { to: "/finance/budgets", key: "finance.tabs.budgets" },
  { to: "/finance/settings", key: "finance.tabs.settings" },
];

export default function FinanceLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const [meta, setMeta] = useState<FinanceMeta | null>(null);
  const [error, setError] = useState(false);

  const reloadMeta = useCallback(async () => {
    setError(false);
    try {
      setMeta(await financeApi.meta());
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void reloadMeta();
  }, [reloadMeta]);

  const onAddPage = location.pathname === "/finance/add";

  return (
    <div className="page">
      <header className="page-head page-head-row">
        <div>
          <h1 className="page-title">{t("finance.title")}</h1>
          <p className="page-lead">{t("finance.lead")}</p>
        </div>
        {!onAddPage && (
          <Link to="/finance/add" className="btn btn-primary">
            {"+ " + t("finance.add")}
          </Link>
        )}
      </header>

      <nav className="fin-tabs" aria-label={t("finance.title")}>
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `fin-tab ${isActive ? "is-active" : ""}`}>
            {t(tab.key)}
          </NavLink>
        ))}
      </nav>

      {error ? (
        <div className="center">
          <p className="muted">{t("common.error")}</p>
          <button className="btn btn-ghost" onClick={() => void reloadMeta()}>{t("common.retry")}</button>
        </div>
      ) : !meta ? (
        <p className="muted">{t("common.loading")}</p>
      ) : (
        <Ctx.Provider value={{ meta, reloadMeta }}>
          <Outlet />
        </Ctx.Provider>
      )}
    </div>
  );
}
