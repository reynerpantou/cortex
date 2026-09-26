import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  categoryIcon,
  currentMonth,
  financeApi,
  formatMoney,
  isValidMonth,
  localeFor,
  monthRange,
  type CategoryTotal,
  type FinanceStats,
  type Kind,
  type TrendPoint,
} from "../../lib/finance";
import MonthSwitcher from "../../components/finance/MonthSwitcher";
import { Donut, OTHER_COLOR, SERIES, TrendChart, type Slice } from "../../components/finance/Charts";
import { useFinance } from "./FinanceLayout";

type Period = "month" | "year";

const MAX_SLICES = SERIES.length;

export default function Stats() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "en";
  const { meta } = useFinance();
  const base = meta.base_currency;
  const [params, setParams] = useSearchParams();

  const month = isValidMonth(params.get("m")) ? params.get("m")! : currentMonth();
  const period: Period = params.get("period") === "year" ? "year" : "month";
  const kind: Kind = params.get("kind") === "income" ? "income" : "expense";
  const drill = params.get("drill");

  const setParam = (key: string, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true }
    );

  const range = useMemo(() => {
    if (period === "year") {
      const y = month.slice(0, 4);
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    return monthRange(month);
  }, [month, period]);

  const [stats, setStats] = useState<FinanceStats | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [error, setError] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    const trendEnd = period === "year" ? `${month.slice(0, 4)}-12` : month;
    const trendMonths = period === "year" ? 12 : 6;
    Promise.all([financeApi.stats(range.from, range.to), financeApi.trend(trendEnd, trendMonths)])
      .then(([s, tr]) => {
        if (cancelled) return;
        setStats(s);
        setTrend(tr);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [range, month, period]);

  const money = (v: number) => formatMoney(v, base, lang);
  const compact = (v: number) => new Intl.NumberFormat(localeFor(lang), { notation: "compact", maximumFractionDigits: 1 }).format(v);

  const nameOf = (id: number | null) => {
    if (id == null) return t("finance.uncategorized");
    const c = meta.categories.find((x) => x.id === id);
    return c ? `${categoryIcon(meta, c)} ${c.name}` : "?";
  };

  const tops = (stats?.categories ?? []).filter((c) => c.kind === kind);
  const drillTop = drill != null ? tops.find((c) => String(c.id ?? "none") === drill) ?? null : null;

  // Rows for the current level: top-level categories, or one category's
  // subcategory split ("<category> (general)" = booked without a subcategory).
  const rows: { key: string; id: number | null; label: string; value: number }[] = drillTop
    ? (drillTop.children ?? []).map((c: CategoryTotal) => ({
        key: String(c.id ?? "general"),
        id: c.id,
        label: c.id == null ? t("finance.stats.general", { name: nameOf(drillTop.id) }) : nameOf(c.id),
        value: c.total,
      }))
    : tops.map((c) => ({ key: String(c.id ?? "none"), id: c.id, label: nameOf(c.id), value: c.total }));

  const levelTotal = rows.reduce((s, r) => s + r.value, 0);

  // Top slots get a hue in rank order; the rest fold into one hatched "Other".
  const colorFor = new Map<string, string>();
  rows.slice(0, rows.length > MAX_SLICES ? MAX_SLICES - 1 : MAX_SLICES).forEach((r, i) => colorFor.set(r.key, SERIES[i]));
  const slices: Slice[] = rows.filter((r) => colorFor.has(r.key)).map((r) => ({ key: r.key, label: r.label, value: r.value, color: colorFor.get(r.key)! }));
  const folded = rows.filter((r) => !colorFor.has(r.key));
  if (folded.length > 0) {
    slices.push({ key: "__other", label: t("finance.stats.other"), value: folded.reduce((s, r) => s + r.value, 0), color: OTHER_COLOR, hatched: true });
  }

  const txLink = (id: number | null) => {
    const p = new URLSearchParams();
    if (month !== currentMonth()) p.set("m", month);
    if (id != null) p.set("category", String(id));
    return `/finance${p.toString() ? `?${p}` : ""}`;
  };

  const trendPoints = trend.map((p) => {
    const [y, m] = p.month.split("-").map(Number);
    return { label: new Date(y, m - 1, 1).toLocaleDateString(localeFor(lang), { month: "short" }), income: p.income, expense: p.expense };
  });

  return (
    <>
      <div className="fin-toolbar">
        <MonthSwitcher month={month} mode={period} onChange={(m) => setParam("m", m === currentMonth() ? "" : m)} />
        <div className="seg" role="tablist">
          {(["month", "year"] as Period[]).map((p) => (
            <button key={p} type="button" role="tab" aria-selected={period === p} className={`seg-opt ${period === p ? "is-on" : ""}`} onClick={() => setParam("period", p === "month" ? "" : p)}>
              {t(`finance.period.${p}`)}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="muted">{t("common.error")}</p>
      ) : !stats ? (
        <p className="muted">{t("common.loading")}</p>
      ) : (
        <>
          <div className="fin-summary">
            {(["expense", "income"] as Kind[]).map((k) => (
              <button
                key={k}
                type="button"
                className={`fin-summary-item fin-summary-toggle ${kind === k ? "is-on" : ""}`}
                aria-pressed={kind === k}
                onClick={() => {
                  setParams((prev) => {
                    const next = new URLSearchParams(prev);
                    if (k === "income") next.set("kind", "income");
                    else next.delete("kind");
                    next.delete("drill");
                    return next;
                  }, { replace: true });
                }}
              >
                <span className="fin-summary-label">{t(`finance.kind.${k}`)}</span>
                <span className={`fin-summary-value ${k === "income" ? "amt-income" : "amt-expense"}`}>{money(k === "income" ? stats.income : stats.expense)}</span>
              </button>
            ))}
            <div className="fin-summary-item">
              <span className="fin-summary-label">{t("finance.net")}</span>
              <span className="fin-summary-value">{money(stats.income - stats.expense)}</span>
            </div>
          </div>

          <section className="stats-card">
            <header className="stats-card-head">
              {drillTop ? (
                <nav className="crumbs">
                  <button type="button" className="link-btn" onClick={() => setParam("drill", "")}>{t(`finance.stats.all.${kind}`)}</button>
                  <span className="muted">{" › "}</span>
                  <span>{nameOf(drillTop.id)}</span>
                </nav>
              ) : (
                <h2 className="section-title">{t(`finance.stats.byCategory.${kind}`)}</h2>
              )}
            </header>

            {rows.length === 0 ? (
              <p className="empty">{t("finance.stats.empty")}</p>
            ) : (
              <div className="stats-breakdown">
                <Donut
                  slices={slices}
                  total={levelTotal}
                  centerLabel={drillTop ? nameOf(drillTop.id) : t(`finance.kind.${kind}`)}
                  format={money}
                  active={hovered}
                  onHover={setHovered}
                  onSelect={drillTop ? undefined : (key) => key !== "__other" && setParam("drill", key)}
                />
                <ul className="breakdown-list">
                  {rows.map((r) => {
                    const color = colorFor.get(r.key);
                    const pct = levelTotal > 0 ? (r.value / levelTotal) * 100 : 0;
                    const sliceKey = color ? r.key : "__other";
                    const top = drillTop ? null : tops.find((c) => String(c.id ?? "none") === r.key);
                    const canDrill = !drillTop && (top?.children?.some((c) => c.id != null) ?? false);
                    return (
                      <li
                        key={r.key}
                        className={`breakdown-row ${hovered === sliceKey ? "is-hovered" : ""}`}
                        onMouseEnter={() => setHovered(sliceKey)}
                        onMouseLeave={() => setHovered(null)}
                      >
                        <span
                          className={`legend-swatch ${color ? "" : "is-hatched"}`}
                          style={color ? { background: color } : undefined}
                          aria-hidden="true"
                        />
                        <span className="breakdown-name">
                          {canDrill ? (
                            <button type="button" className="link-btn breakdown-drill" onClick={() => setParam("drill", r.key)}>
                              {r.label} <span aria-hidden="true">›</span>
                            </button>
                          ) : (
                            r.label
                          )}
                        </span>
                        <span className="breakdown-pct">{pct.toFixed(pct < 10 ? 1 : 0)}%</span>
                        <Link to={txLink(r.id ?? (drillTop ? drillTop.id : null))} className="breakdown-amt" title={t("finance.stats.viewTransactions")}>
                          {money(r.value)}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>

          <section className="stats-card">
            <header className="stats-card-head">
              <h2 className="section-title">{t(period === "year" ? "finance.stats.trendYear" : "finance.stats.trend")}</h2>
            </header>
            <TrendChart
              points={trendPoints}
              incomeLabel={t("finance.kind.income")}
              expenseLabel={t("finance.kind.expense")}
              netLabel={t("finance.net")}
              format={money}
              compact={compact}
            />
          </section>
        </>
      )}
    </>
  );
}
