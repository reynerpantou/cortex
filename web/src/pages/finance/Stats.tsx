import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  categoryIcon,
  currentMonth,
  financeApi,
  formatMoney,
  isValidMonth,
  localeFor,
  methodIcon,
  monthLabel,
  monthRange,
  shiftMonth,
  todayISO,
  topLevel,
  addDays,
  type CategoryTotal,
  type FinanceMeta,
  type FinanceStats,
  type Kind,
  type StatsWidgetPref,
  type Transaction,
  type TrendPoint,
} from "../../lib/finance";
import MonthSwitcher from "../../components/finance/MonthSwitcher";
import {
  ColumnChart,
  Donut,
  EXPENSE_COLOR,
  FlowChart,
  Heatmap,
  INCOME_COLOR,
  OTHER_COLOR,
  SERIES,
  TrendChart,
  type FlowNode,
  type HeatDay,
  type Slice,
} from "../../components/finance/Charts";
import { useFinance } from "./FinanceLayout";

type Period = "month" | "year";

// Every widget the Stats page can show, in default order. Adding one here
// (plus its render case below and its title string) is all it takes — a
// saved layout that predates it just gets it appended, visible.
export const STATS_WIDGETS = [
  "breakdown",
  "changes",
  "pace",
  "trend",
  "savings",
  "categoryTrend",
  "methods",
  "top",
  "rhythm",
  "flow",
] as const;
type WidgetKey = (typeof STATS_WIDGETS)[number];

function resolveLayout(saved: StatsWidgetPref[] | null): { key: WidgetKey; visible: boolean }[] {
  const known = new Set<string>(STATS_WIDGETS);
  const out: { key: WidgetKey; visible: boolean }[] = [];
  for (const w of saved ?? []) if (known.has(w.key) && !out.some((o) => o.key === w.key)) out.push({ key: w.key as WidgetKey, visible: w.visible });
  for (const k of STATS_WIDGETS) if (!out.some((o) => o.key === k)) out.push({ key: k, visible: true });
  return out;
}

const MAX_SLICES = SERIES.length;

function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

interface Row {
  key: string;
  id: number | null;
  label: string;
  value: number;
}

// Top slots get a hue in rank order; the rest fold into one hatched "Other".
function colorRows(rows: Row[]): Map<string, string> {
  const colorFor = new Map<string, string>();
  rows.slice(0, rows.length > MAX_SLICES ? MAX_SLICES - 1 : MAX_SLICES).forEach((r, i) => colorFor.set(r.key, SERIES[i]));
  return colorFor;
}

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
  const bySub = params.get("by") === "sub";

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

  const [layout, setLayout] = useState(() => resolveLayout(meta.stats_layout));
  const [customizing, setCustomizing] = useState(false);
  const visible = (k: WidgetKey) => layout.some((w) => w.key === k && w.visible);

  const saveLayout = (next: { key: WidgetKey; visible: boolean }[]) => {
    setLayout(next);
    void financeApi.updateStatsLayout(next).catch(() => undefined);
  };

  const range = useMemo(() => {
    if (period === "year") {
      const y = month.slice(0, 4);
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    return monthRange(month);
  }, [month, period]);

  const prev = useMemo(() => {
    if (period === "year") {
      const y = String(Number(month.slice(0, 4)) - 1);
      return { from: `${y}-01-01`, to: `${y}-12-31`, label: y };
    }
    const pm = shiftMonth(month, -1);
    return { ...monthRange(pm), label: monthLabel(pm, lang) };
  }, [month, period, lang]);

  const trendEnd = period === "year" ? `${month.slice(0, 4)}-12` : month;
  const trendMonths = period === "year" ? 12 : 6;

  const [stats, setStats] = useState<FinanceStats | null>(null);
  const [prevStats, setPrevStats] = useState<FinanceStats | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [txs, setTxs] = useState<Transaction[] | null>(null);
  const [error, setError] = useState(false);

  const needTxs = visible("methods") || visible("top") || visible("rhythm");

  useEffect(() => {
    let cancelled = false;
    setError(false);
    Promise.all([
      financeApi.stats(range.from, range.to),
      financeApi.stats(prev.from, prev.to),
      financeApi.trend(trendEnd, trendMonths),
    ])
      .then(([s, ps, tr]) => {
        if (cancelled) return;
        setStats(s);
        setPrevStats(ps);
        setTrend(tr);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [range, prev, trendEnd, trendMonths]);

  useEffect(() => {
    if (!needTxs) return;
    let cancelled = false;
    setTxs(null);
    financeApi
      .listTransactions(range)
      .then((list) => !cancelled && setTxs(list))
      .catch(() => !cancelled && setTxs([]));
    return () => {
      cancelled = true;
    };
  }, [range, needTxs]);

  const money = (v: number) => formatMoney(v, base, lang);
  // Averages and projections are estimates; cents on them are noise.
  const approx = (v: number) => formatMoney(Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100, base, lang);
  const compact = (v: number) => new Intl.NumberFormat(localeFor(lang), { notation: "compact", maximumFractionDigits: 1 }).format(v);
  const monthShort = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(localeFor(lang), { month: "short" });
  };

  const title = (k: WidgetKey) => t(`finance.stats.widgets.${k}`);

  const setKind = (k: Kind) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (k === "income") next.set("kind", "income");
        else next.delete("kind");
        next.delete("drill");
        next.delete("ct");
        return next;
      },
      { replace: true }
    );

  const moveWidget = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= layout.length) return;
    const next = [...layout];
    [next[i], next[j]] = [next[j], next[i]];
    saveLayout(next);
  };

  const render = (k: WidgetKey): ReactNode => {
    if (!stats || !prevStats) return null;
    const props = { meta, stats, prevStats, kind, money, approx, compact, t, lang };
    switch (k) {
      case "breakdown":
        return <Breakdown {...props} month={month} drill={drill} bySub={bySub} setParam={setParam} />;
      case "changes":
        return <Changes {...props} prevLabel={prev.label} />;
      case "pace":
        return <Pace {...props} range={range} prevLabel={prev.label} />;
      case "trend":
        return (
          <TrendChart
            points={trend.map((p) => ({ label: monthShort(p.month), income: p.income, expense: p.expense }))}
            incomeLabel={t("finance.kind.income")}
            expenseLabel={t("finance.kind.expense")}
            netLabel={t("finance.net")}
            format={money}
            compact={compact}
          />
        );
      case "savings":
        return <Savings {...props} trend={trend} monthShort={monthShort} />;
      case "categoryTrend":
        return <CategoryTrend {...props} trendEnd={trendEnd} selected={params.get("ct")} onSelect={(id) => setParam("ct", id)} monthShort={monthShort} />;
      case "methods":
        return <Methods {...props} txs={txs} />;
      case "top":
        return <TopSpending {...props} txs={txs} />;
      case "rhythm":
        return <Rhythm {...props} txs={txs} range={range} />;
      case "flow":
        return <Flow {...props} />;
    }
  };

  const kindAware: WidgetKey[] = ["breakdown", "changes", "categoryTrend", "methods", "top"];

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
        <button type="button" className={`btn btn-ghost fin-toolbar-end ${customizing ? "has-active" : ""}`} aria-expanded={customizing} onClick={() => setCustomizing((v) => !v)}>
          {t("finance.stats.customize")}
        </button>
      </div>

      {customizing && (
        <section className="stats-card customize-panel">
          <header className="stats-card-head">
            <h2 className="section-title">{t("finance.stats.customizeTitle")}</h2>
            <button type="button" className="link-btn" onClick={() => saveLayout(resolveLayout(null))}>
              {t("finance.stats.resetLayout")}
            </button>
          </header>
          <p className="muted setting-lead">{t("finance.stats.customizeLead")}</p>
          <ul className="customize-list">
            {layout.map((w, i) => (
              <li key={w.key} className="customize-row">
                <label className="customize-toggle">
                  <input
                    type="checkbox"
                    checked={w.visible}
                    onChange={(e) => saveLayout(layout.map((x) => (x.key === w.key ? { ...x, visible: e.target.checked } : x)))}
                  />
                  <span>
                    <span className="customize-name">{title(w.key)}</span>
                    <span className="customize-desc">{t(`finance.stats.desc.${w.key}`)}</span>
                  </span>
                </label>
                <span className="setting-actions">
                  <button type="button" className="icon-btn" disabled={i === 0} onClick={() => moveWidget(i, -1)} aria-label={t("finance.settings.moveUp")}>↑</button>
                  <button type="button" className="icon-btn" disabled={i === layout.length - 1} onClick={() => moveWidget(i, 1)} aria-label={t("finance.settings.moveDown")}>↓</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error ? (
        <p className="muted">{t("common.error")}</p>
      ) : !stats || !prevStats ? (
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
                onClick={() => setKind(k)}
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

          {layout.filter((w) => w.visible).length === 0 && <p className="empty">{t("finance.stats.allHidden")}</p>}

          {layout
            .filter((w) => w.visible)
            .map((w) => (
              <section key={w.key} className="stats-card" data-widget={w.key}>
                <header className="stats-card-head">
                  <h2 className="section-title">
                    {title(w.key)}
                    {kindAware.includes(w.key) && <span className="stats-kind-tag">{t(`finance.kind.${kind}`)}</span>}
                  </h2>
                  {w.key === "breakdown" && !drill && (
                    <div className="seg" role="tablist">
                      {(["cat", "sub"] as const).map((b) => (
                        <button
                          key={b}
                          type="button"
                          role="tab"
                          aria-selected={(b === "sub") === bySub}
                          className={`seg-opt ${(b === "sub") === bySub ? "is-on" : ""}`}
                          onClick={() => setParam("by", b === "sub" ? "sub" : "")}
                        >
                          {t(`finance.stats.by.${b}`)}
                        </button>
                      ))}
                    </div>
                  )}
                </header>
                {render(w.key)}
              </section>
            ))}
        </>
      )}
    </>
  );
}

// ---- widgets ----

interface WidgetProps {
  meta: FinanceMeta;
  stats: FinanceStats;
  prevStats: FinanceStats;
  kind: Kind;
  money: (v: number) => string;
  approx: (v: number) => string;
  compact: (v: number) => string;
  t: (key: string, opts?: Record<string, unknown>) => string;
  lang: string;
}

function nameOf(meta: FinanceMeta, t: WidgetProps["t"], id: number | null): string {
  if (id == null) return t("finance.uncategorized");
  const c = meta.categories.find((x) => x.id === id);
  return c ? `${categoryIcon(meta, c)} ${c.name}` : "?";
}

function Breakdown({
  meta,
  stats,
  kind,
  money,
  t,
  month,
  drill,
  bySub,
  setParam,
}: WidgetProps & { month: string; drill: string | null; bySub: boolean; setParam: (k: string, v: string) => void }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const tops = stats.categories.filter((c) => c.kind === kind);
  const drillTop = drill != null ? tops.find((c) => String(c.id ?? "none") === drill) ?? null : null;

  let rows: Row[];
  if (drillTop) {
    rows = (drillTop.children ?? []).map((c: CategoryTotal) => ({
      key: String(c.id ?? "general"),
      id: c.id,
      label: c.id == null ? t("finance.stats.general", { name: nameOf(meta, t, drillTop.id) }) : nameOf(meta, t, c.id),
      value: c.total,
    }));
  } else if (bySub) {
    // One ranked list across every category — "Food › Eating out is #2" is
    // the insight a per-category drill-down hides.
    rows = tops
      .flatMap((top) =>
        (top.children ?? []).map((c) => {
          const topCat = top.id != null ? meta.categories.find((x) => x.id === top.id) : undefined;
          const sub = c.id != null ? meta.categories.find((x) => x.id === c.id) : undefined;
          const label =
            top.id == null
              ? t("finance.uncategorized")
              : sub
                ? `${categoryIcon(meta, sub)} ${topCat?.name ?? "?"} › ${sub.name}`
                : t("finance.stats.general", { name: nameOf(meta, t, top.id) });
          return { key: `s${c.id ?? `g${top.id ?? "none"}`}`, id: c.id ?? top.id, label, value: c.total };
        })
      )
      .sort((a, b) => b.value - a.value);
  } else {
    rows = tops.map((c) => ({ key: String(c.id ?? "none"), id: c.id, label: nameOf(meta, t, c.id), value: c.total }));
  }

  const levelTotal = rows.reduce((s, r) => s + r.value, 0);
  const colorFor = colorRows(rows);
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

  return (
    <>
      {drillTop && (
        <nav className="crumbs">
          <button type="button" className="link-btn" onClick={() => setParam("drill", "")}>{t(`finance.stats.all.${kind}`)}</button>
          <span className="muted">{" › "}</span>
          <span>{nameOf(meta, t, drillTop.id)}</span>
        </nav>
      )}
      {rows.length === 0 ? (
        <p className="empty">{t("finance.stats.empty")}</p>
      ) : (
        <div className="stats-breakdown">
          <Donut
            slices={slices}
            total={levelTotal}
            centerLabel={drillTop ? nameOf(meta, t, drillTop.id) : t(`finance.kind.${kind}`)}
            format={money}
            active={hovered}
            onHover={setHovered}
            onSelect={drillTop || bySub ? undefined : (key) => key !== "__other" && setParam("drill", key)}
          />
          <ul className="breakdown-list">
            {rows.map((r) => {
              const color = colorFor.get(r.key);
              const pct = levelTotal > 0 ? (r.value / levelTotal) * 100 : 0;
              const sliceKey = color ? r.key : "__other";
              const top = drillTop || bySub ? null : tops.find((c) => String(c.id ?? "none") === r.key);
              const canDrill = !!top && (top.children?.some((c) => c.id != null) ?? false);
              return (
                <li
                  key={r.key}
                  className={`breakdown-row ${hovered === sliceKey ? "is-hovered" : ""}`}
                  onMouseEnter={() => setHovered(sliceKey)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span className={`legend-swatch ${color ? "" : "is-hatched"}`} style={color ? { background: color } : undefined} aria-hidden="true" />
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
    </>
  );
}

function deltaClass(kind: Kind, delta: number): string {
  if (delta === 0) return "muted";
  const good = kind === "income" ? delta > 0 : delta < 0;
  return good ? "amt-income" : "amt-expense";
}

function DeltaText({ kind, cur, prev, money, t }: { kind: Kind; cur: number; prev: number; money: (v: number) => string; t: WidgetProps["t"] }) {
  const delta = cur - prev;
  if (prev === 0 && cur === 0) return <span className="muted">—</span>;
  if (prev === 0) return <span className={deltaClass(kind, delta)}>{t("finance.stats.new")}</span>;
  if (delta === 0) return <span className="muted">{t("finance.stats.noChange")}</span>;
  const pct = (delta / prev) * 100;
  const arrow = delta > 0 ? "▲" : "▼";
  return (
    <span className={deltaClass(kind, delta)}>
      {`${arrow} ${money(Math.abs(delta))} (${delta >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%)`}
    </span>
  );
}

function Changes({ meta, stats, prevStats, kind, money, t, prevLabel }: WidgetProps & { prevLabel: string }) {
  const [showAll, setShowAll] = useState(false);
  const cur = new Map(stats.categories.filter((c) => c.kind === kind).map((c) => [c.id, c.total]));
  const old = new Map(prevStats.categories.filter((c) => c.kind === kind).map((c) => [c.id, c.total]));
  const ids = Array.from(new Set([...cur.keys(), ...old.keys()]));
  const rows = ids
    .map((id) => ({ id, cur: cur.get(id) ?? 0, prev: old.get(id) ?? 0 }))
    .sort((a, b) => Math.abs(b.cur - b.prev) - Math.abs(a.cur - a.prev));
  const totalCur = kind === "income" ? stats.income : stats.expense;
  const totalPrev = kind === "income" ? prevStats.income : prevStats.expense;
  const shown = showAll ? rows : rows.slice(0, 6);

  if (rows.length === 0) return <p className="empty">{t("finance.stats.empty")}</p>;
  return (
    <>
      <p className="stats-headline">
        {t(`finance.stats.changesHeadline.${kind}`, { period: prevLabel })}{" "}
        <DeltaText kind={kind} cur={totalCur} prev={totalPrev} money={money} t={t} />
      </p>
      <ul className="change-list">
        {shown.map((r) => (
          <li key={String(r.id)} className="change-row">
            <span className="breakdown-name">{nameOf(meta, t, r.id)}</span>
            <span className="change-vals">
              <span className="change-cur">{money(r.cur)}</span>
              <span className="change-prev muted">{t("finance.stats.was", { amount: money(r.prev) })}</span>
            </span>
            <span className="change-delta">
              <DeltaText kind={kind} cur={r.cur} prev={r.prev} money={money} t={t} />
            </span>
          </li>
        ))}
      </ul>
      {rows.length > 6 && (
        <button type="button" className="link-btn" onClick={() => setShowAll((v) => !v)}>
          {showAll ? t("finance.stats.showLess") : t("finance.stats.showAll", { count: rows.length })}
        </button>
      )}
    </>
  );
}

function Pace({ stats, prevStats, money, approx, t, lang, range, prevLabel }: WidgetProps & { range: { from: string; to: string }; prevLabel: string }) {
  const today = todayISO();
  if (today < range.from) return <p className="empty">{t("finance.stats.future")}</p>;
  const isCurrent = today <= range.to;
  const elapsedEnd = isCurrent ? today : range.to;
  const elapsed = dayDiff(range.from, elapsedEnd) + 1;
  const totalDays = dayDiff(range.from, range.to) + 1;
  const avg = stats.expense / elapsed;
  const forecast = avg * totalDays;
  const [ey, em, ed] = range.to.split("-").map(Number);
  const endLabel = new Date(ey, em - 1, ed).toLocaleDateString(localeFor(lang), { day: "numeric", month: "short" });
  const compare = isCurrent ? forecast : stats.expense;
  const diffPct = prevStats.expense > 0 ? ((compare - prevStats.expense) / prevStats.expense) * 100 : null;

  return (
    <div className="pace">
      <div className="pace-tiles">
        <div className="pace-tile">
          <span className="fin-summary-label">{t("finance.stats.dailyAvg")}</span>
          <span className="pace-value">{approx(avg)}</span>
          <span className="muted pace-sub">{t("finance.stats.overDays", { count: elapsed })}</span>
        </div>
        <div className="pace-tile">
          <span className="fin-summary-label">
            {isCurrent ? t("finance.stats.projected", { date: endLabel }) : t("finance.stats.periodTotal")}
          </span>
          <span className="pace-value">{isCurrent ? approx(forecast) : money(stats.expense)}</span>
          {isCurrent && <span className="muted pace-sub">{t("finance.stats.daysLeft", { count: totalDays - elapsed })}</span>}
          {diffPct !== null && (
            <span className={`pace-sub ${diffPct > 0 ? "amt-expense" : "amt-income"}`}>
              {t("finance.stats.vsPrev", { pct: `${diffPct > 0 ? "▲ +" : "▼ −"}${Math.abs(diffPct).toFixed(0)}%`, period: prevLabel })}
            </span>
          )}
        </div>
        <div className="pace-tile">
          <span className="fin-summary-label">{prevLabel}</span>
          <span className="pace-value">{money(prevStats.expense)}</span>
        </div>
      </div>
      {isCurrent && <p className="muted pace-note">{t("finance.stats.paceNote")}</p>}
    </div>
  );
}

function Savings({ stats, money, t, trend, monthShort }: WidgetProps & { trend: TrendPoint[]; monthShort: (ym: string) => string }) {
  const rate = stats.income > 0 ? ((stats.income - stats.expense) / stats.income) * 100 : null;
  const points = trend.map((p) => ({
    label: monthShort(p.month),
    value: p.income > 0 ? Math.round(((p.income - p.expense) / p.income) * 1000) / 10 : null,
    detail: `${t("finance.stats.saved")}: ${money(p.income - p.expense)}`,
  }));
  const withData = points.filter((p) => p.value != null);
  const avg = withData.length ? withData.reduce((s, p) => s + (p.value ?? 0), 0) / withData.length : null;

  return (
    <>
      <div className="pace-tiles">
        <div className="pace-tile">
          <span className="fin-summary-label">{t("finance.stats.savingsRate")}</span>
          <span className={`pace-value ${rate == null ? "" : rate >= 0 ? "amt-income" : "amt-expense"}`}>{rate == null ? "—" : `${rate.toFixed(0)}%`}</span>
          <span className="muted pace-sub">{t("finance.stats.savedAmount", { amount: money(stats.income - stats.expense) })}</span>
        </div>
        <div className="pace-tile">
          <span className="fin-summary-label">{t("finance.stats.avgRate", { count: withData.length })}</span>
          <span className="pace-value">{avg == null ? "—" : `${avg.toFixed(0)}%`}</span>
        </div>
      </div>
      {withData.length > 0 ? (
        <ColumnChart
          points={points}
          color={(v) => (v >= 0 ? INCOME_COLOR : EXPENSE_COLOR)}
          format={(v) => `${v.toFixed(1)}%`}
          tick={(v) => `${Math.round(v)}%`}
          ariaLabel={t("finance.stats.widgets.savings")}
        />
      ) : (
        <p className="muted">{t("finance.stats.noIncome")}</p>
      )}
    </>
  );
}

function CategoryTrend({
  meta,
  stats,
  kind,
  approx,
  compact,
  t,
  trendEnd,
  selected,
  onSelect,
  monthShort,
}: WidgetProps & { trendEnd: string; selected: string | null; onSelect: (id: string) => void; monthShort: (ym: string) => string }) {
  const options = topLevel(meta, kind, true);
  const biggest = stats.categories.filter((c) => c.kind === kind && c.id != null)[0]?.id ?? options[0]?.id ?? null;
  const id = selected && options.some((o) => String(o.id) === selected) ? Number(selected) : biggest;
  const [points, setPoints] = useState<TrendPoint[] | null>(null);

  useEffect(() => {
    if (id == null) return;
    let cancelled = false;
    setPoints(null);
    financeApi
      .trend(trendEnd, 12, id)
      .then((p) => !cancelled && setPoints(p))
      .catch(() => !cancelled && setPoints([]));
    return () => {
      cancelled = true;
    };
  }, [id, trendEnd]);

  if (id == null) return <p className="empty">{t("finance.stats.empty")}</p>;
  const values = (points ?? []).map((p) => (kind === "income" ? p.income : p.expense));
  const nonZero = values.filter((v) => v > 0);
  const avg = nonZero.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;

  return (
    <>
      <div className="cat-trend-head">
        <select className="input cat-trend-select" value={id} onChange={(e) => onSelect(e.target.value)} aria-label={t("finance.form.category")}>
          {options.map((c) => (
            <option key={c.id} value={c.id}>{`${categoryIcon(meta, c)} ${c.name}`}</option>
          ))}
        </select>
        {points && <span className="muted">{t("finance.stats.monthlyAvg", { amount: approx(avg) })}</span>}
      </div>
      {!points ? (
        <p className="muted">{t("common.loading")}</p>
      ) : (
        <ColumnChart
          points={points.map((p, i) => ({ label: monthShort(p.month), value: values[i] }))}
          color={() => "var(--azure)"}
          format={approx}
          tick={compact}
          ariaLabel={t("finance.stats.widgets.categoryTrend")}
        />
      )}
    </>
  );
}

function Methods({ meta, kind, money, t, txs }: WidgetProps & { txs: Transaction[] | null }) {
  if (!txs) return <p className="muted">{t("common.loading")}</p>;
  const groups = new Map<number | null, { total: number; count: number }>();
  for (const tx of txs) {
    if (tx.kind !== kind) continue;
    const g = groups.get(tx.payment_method_id) ?? { total: 0, count: 0 };
    g.total += tx.base_amount;
    g.count += 1;
    groups.set(tx.payment_method_id, g);
  }
  const rows = Array.from(groups.entries()).sort((a, b) => b[1].total - a[1].total);
  const total = rows.reduce((s, [, g]) => s + g.total, 0);
  const max = rows[0]?.[1].total ?? 0;
  if (rows.length === 0) return <p className="empty">{t("finance.stats.empty")}</p>;

  return (
    <ul className="hbar-list">
      {rows.map(([id, g]) => {
        const pm = id != null ? meta.payment_methods.find((p) => p.id === id) : undefined;
        return (
          <li key={String(id)} className="hbar-row">
            <span className="hbar-name">
              {pm ? `${methodIcon(pm)} ${pm.name}` : t("finance.stats.methodNotSet")}
              <span className="muted hbar-count">{t("finance.stats.txCount", { count: g.count })}</span>
            </span>
            <span className="hbar-track">
              <span className="hbar-fill" style={{ width: `${max > 0 ? (g.total / max) * 100 : 0}%` }} />
            </span>
            <span className="breakdown-pct">{total > 0 ? `${((g.total / total) * 100).toFixed(0)}%` : ""}</span>
            <span className="hbar-amt">{money(g.total)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function TopSpending({ meta, kind, money, approx, t, lang, txs }: WidgetProps & { txs: Transaction[] | null }) {
  if (!txs) return <p className="muted">{t("common.loading")}</p>;
  const mine = txs.filter((tx) => tx.kind === kind);
  if (mine.length === 0) return <p className="empty">{t("finance.stats.empty")}</p>;
  const biggest = [...mine].sort((a, b) => b.base_amount - a.base_amount).slice(0, 5);
  const byNote = new Map<string, { label: string; count: number; total: number }>();
  for (const tx of mine) {
    const key = tx.note.trim().toLowerCase();
    if (!key) continue;
    const g = byNote.get(key) ?? { label: tx.note.trim(), count: 0, total: 0 };
    g.count += 1;
    g.total += tx.base_amount;
    byNote.set(key, g);
  }
  const frequent = Array.from(byNote.values())
    .filter((g) => g.count > 1)
    .sort((a, b) => b.count - a.count || b.total - a.total)
    .slice(0, 5);
  const dateLabel = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(localeFor(lang), { day: "numeric", month: "short" });
  };

  return (
    <div className="top-grid">
      <div>
        <h3 className="stats-subtitle">{t("finance.stats.biggest")}</h3>
        <ul className="top-list">
          {biggest.map((tx) => {
            const c = tx.category_id != null ? meta.categories.find((x) => x.id === tx.category_id) : undefined;
            return (
              <li key={tx.id} className="top-row">
                <Link to={`/finance?m=${tx.occurred_on.slice(0, 7)}`} className="top-link">
                  <span className="tx-row-icon" aria-hidden="true">{c ? categoryIcon(meta, c) : "❔"}</span>
                  <span className="tx-row-main">
                    <span className="tx-row-cat">{tx.note || (c ? c.name : t("finance.uncategorized"))}</span>
                    <span className="tx-row-sub">{`${dateLabel(tx.occurred_on)}${c && tx.note ? ` · ${c.name}` : ""}`}</span>
                  </span>
                  <span className="hbar-amt">{money(tx.base_amount)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <h3 className="stats-subtitle">{t("finance.stats.frequent")}</h3>
        {frequent.length === 0 ? (
          <p className="muted top-hint">{t("finance.stats.frequentHint")}</p>
        ) : (
          <ul className="top-list">
            {frequent.map((g) => (
              <li key={g.label} className="top-row">
                <span className="top-link">
                  <span className="freq-count">{`×${g.count}`}</span>
                  <span className="tx-row-main">
                    <span className="tx-row-cat">{g.label}</span>
                    <span className="tx-row-sub">{t("finance.stats.avgEach", { amount: approx(g.total / g.count) })}</span>
                  </span>
                  <span className="hbar-amt">{money(g.total)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Rhythm({ money, approx, compact, t, lang, txs, range }: WidgetProps & { txs: Transaction[] | null; range: { from: string; to: string } }) {
  if (!txs) return <p className="muted">{t("common.loading")}</p>;
  const today = todayISO();
  const lastDay = range.to < today ? range.to : today;
  if (lastDay < range.from) return <p className="empty">{t("finance.stats.future")}</p>;

  const byDay = new Map<string, number>();
  for (const tx of txs) if (tx.kind === "expense") byDay.set(tx.occurred_on, (byDay.get(tx.occurred_on) ?? 0) + tx.base_amount);

  const [fy, fm, fd] = range.from.split("-").map(Number);
  const lead = (new Date(fy, fm - 1, fd).getDay() + 6) % 7;
  const start = addDays(range.from, -lead);
  const days: HeatDay[] = [];
  const weekdaySum = Array(7).fill(0);
  const weekdayCount = Array(7).fill(0);
  for (let d = start, i = 0; d <= range.to || i % 7 !== 0; d = addDays(d, 1), i++) {
    const inRange = d >= range.from && d <= lastDay;
    const value = byDay.get(d) ?? 0;
    days.push({ date: d, value, inRange });
    if (inRange) {
      weekdaySum[i % 7] += value;
      weekdayCount[i % 7] += 1;
    }
  }
  const weekdayNames = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(localeFor(lang), { weekday: "short" }));
  const dayLabel = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(localeFor(lang), { weekday: "short", day: "numeric", month: "short" });
  };
  const noSpend = days.filter((d) => d.inRange && d.value === 0).length;
  const activeDays = days.filter((d) => d.inRange).length;

  return (
    <>
      <p className="stats-headline">{t("finance.stats.noSpendDays", { count: noSpend, total: activeDays })}</p>
      <Heatmap
        days={days}
        weekdayLabels={weekdayNames}
        format={money}
        dayLabel={dayLabel}
        lessLabel={t("finance.stats.less")}
        moreLabel={t("finance.stats.more")}
      />
      <h3 className="stats-subtitle">{t("finance.stats.byWeekday")}</h3>
      <ColumnChart
        points={weekdayNames.map((n, i) => ({
          label: n,
          value: weekdayCount[i] ? weekdaySum[i] / weekdayCount[i] : null,
          detail: t("finance.stats.weekdayDetail", { count: weekdayCount[i] }),
        }))}
        color={() => "var(--azure)"}
        format={approx}
        tick={compact}
        ariaLabel={t("finance.stats.byWeekday")}
        height={160}
      />
    </>
  );
}

function Flow({ meta, stats, approx, t }: WidgetProps) {
  if (stats.income <= 0 && stats.expense <= 0) return <p className="empty">{t("finance.stats.empty")}</p>;
  const name = (id: number | null) => {
    if (id == null) return t("finance.uncategorized");
    const c = meta.categories.find((x) => x.id === id);
    return c ? `${categoryIcon(meta, c)} ${c.name}` : "?";
  };
  const incomeTops = stats.categories.filter((c) => c.kind === "income");
  const expenseTops = stats.categories.filter((c) => c.kind === "expense");

  const sources: FlowNode[] = incomeTops.slice(0, incomeTops.length > 5 ? 4 : 5).map((c) => ({ key: `i${c.id}`, label: name(c.id), value: c.total, color: INCOME_COLOR }));
  if (incomeTops.length > 5) {
    sources.push({ key: "i-other", label: t("finance.stats.otherIncome"), value: incomeTops.slice(4).reduce((s, c) => s + c.total, 0), color: INCOME_COLOR });
  }
  if (stats.expense > stats.income) {
    sources.push({ key: "deficit", label: t("finance.stats.fromSavings"), value: stats.expense - stats.income, color: OTHER_COLOR });
  }

  // Same ranking and colors as the category donut, so a category keeps its color.
  const rows: Row[] = expenseTops.map((c) => ({ key: `e${c.id}`, id: c.id, label: name(c.id), value: c.total }));
  const colorFor = colorRows(rows);
  const uses: FlowNode[] = rows.filter((r) => colorFor.has(r.key)).map((r) => ({ key: r.key, label: r.label, value: r.value, color: colorFor.get(r.key)! }));
  const folded = rows.filter((r) => !colorFor.has(r.key));
  if (folded.length) uses.push({ key: "e-other", label: t("finance.stats.other"), value: folded.reduce((s, r) => s + r.value, 0), color: OTHER_COLOR });
  if (stats.income > stats.expense) {
    uses.push({ key: "saved", label: t("finance.stats.saved"), value: stats.income - stats.expense, color: INCOME_COLOR });
  }

  return <FlowChart sources={sources} uses={uses} centerLabel={t("finance.stats.moneyIn")} format={approx} />;
}
