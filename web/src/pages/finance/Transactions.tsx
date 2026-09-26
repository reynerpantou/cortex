import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  activeMethods,
  categoryLabel,
  childrenOf,
  currentMonth,
  financeApi,
  formatMoney,
  isValidMonth,
  localeFor,
  monthRange,
  todayISO,
  topLevel,
  type Transaction,
} from "../../lib/finance";
import MonthSwitcher from "../../components/finance/MonthSwitcher";
import TxForm from "../../components/finance/TxForm";
import { useFinance } from "./FinanceLayout";

type View = "daily" | "calendar";

function sumBy(txs: Transaction[]) {
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (t.kind === "income") income += t.base_amount;
    else expense += t.base_amount;
  }
  return { income, expense, net: income - expense };
}

export default function Transactions() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "en";
  const { meta, reloadMeta } = useFinance();
  const base = meta.base_currency;
  const [params, setParams] = useSearchParams();

  const month = isValidMonth(params.get("m")) ? params.get("m")! : currentMonth();
  const view: View = params.get("view") === "calendar" ? "calendar" : "daily";
  const categoryFilter = params.get("category") ?? "";
  const methodFilter = params.get("method") ?? "";
  const q = params.get("q") ?? "";

  const setParam = (key: string, value: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true }
    );
  };

  const [txs, setTxs] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(!!(categoryFilter || methodFilter || q));

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const { from, to } = monthRange(month);
      setTxs(
        await financeApi.listTransactions({
          from,
          to,
          category_id: categoryFilter ? Number(categoryFilter) : undefined,
          payment_method_id: methodFilter ? Number(methodFilter) : undefined,
          q,
        })
      );
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const id = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, categoryFilter, methodFilter, q]);

  useEffect(() => setSelectedDay(null), [month]);

  const totals = useMemo(() => sumBy(txs), [txs]);
  const byDay = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const tx of txs) {
      const list = map.get(tx.occurred_on) ?? [];
      list.push(tx);
      map.set(tx.occurred_on, list);
    }
    return map;
  }, [txs]);

  const money = (v: number) => formatMoney(v, base, lang);
  const activeFilterCount = (categoryFilter ? 1 : 0) + (methodFilter ? 1 : 0) + (q ? 1 : 0);

  const dayHeading = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return {
      day: String(d),
      weekday: date.toLocaleDateString(localeFor(lang), { weekday: "short" }),
      full: date.toLocaleDateString(localeFor(lang), { weekday: "long", day: "numeric", month: "long" }),
    };
  };

  const renderDay = (iso: string, list: Transaction[]) => {
    const h = dayHeading(iso);
    const s = sumBy(list);
    return (
      <section key={iso} className="day-group">
        <header className="day-group-head">
          <span className="day-group-date">
            <span className="day-num">{h.day}</span>
            <span className="day-weekday">{h.weekday}</span>
          </span>
          <span className="day-group-totals">
            {s.income > 0 && <span className="amt-income">{money(s.income)}</span>}
            {s.expense > 0 && <span className="amt-expense">{money(s.expense)}</span>}
          </span>
        </header>
        {list.map((tx) => {
          const cat = categoryLabel(meta, tx.category_id);
          const method = meta.payment_methods.find((p) => p.id === tx.payment_method_id);
          return (
            <button key={tx.id} type="button" className="tx-row" onClick={() => setEditing(tx)}>
              <span className="tx-row-icon" aria-hidden="true">{cat?.icon || "•"}</span>
              <span className="tx-row-main">
                <span className="tx-row-cat">
                  {cat ? (cat.parent ? `${cat.parent} › ${cat.name}` : cat.name) : t("finance.uncategorized")}
                </span>
                <span className="tx-row-sub">
                  {[tx.note, method?.name].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="tx-row-amount">
                <span className={tx.kind === "income" ? "amt-income" : "amt-expense"}>
                  {(tx.kind === "expense" ? "−" : "+") + money(tx.base_amount)}
                </span>
                {tx.currency !== base && (
                  <span className="tx-row-orig">{formatMoney(tx.amount, tx.currency, lang)}</span>
                )}
              </span>
            </button>
          );
        })}
      </section>
    );
  };

  const calendarCells = () => {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const daysInMonth = new Date(y, m, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // Monday-first
    const cells: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  };

  const weekdayNames = Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(localeFor(lang), { weekday: "short" })
  );
  const compact = (v: number) =>
    new Intl.NumberFormat(localeFor(lang), { notation: "compact", maximumFractionDigits: 1 }).format(v);

  return (
    <>
      <div className="fin-toolbar">
        <MonthSwitcher month={month} onChange={(m) => setParam("m", m === currentMonth() ? "" : m)} />
        <div className="seg" role="tablist">
          {(["daily", "calendar"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              className={`seg-opt ${view === v ? "is-on" : ""}`}
              onClick={() => setParam("view", v === "daily" ? "" : v)}
            >
              {t(`finance.view.${v}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`btn btn-ghost filters-toggle ${activeFilterCount > 0 ? "has-active" : ""}`}
          onClick={() => setFiltersOpen((v) => !v)}
        >
          {t("filter.title")}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </button>
      </div>

      {filtersOpen && (
        <div className="fin-filters">
          <input
            className="input"
            placeholder={t("finance.searchNotes")}
            value={q}
            onChange={(e) => setParam("q", e.target.value)}
          />
          <select className="input" value={categoryFilter} onChange={(e) => setParam("category", e.target.value)}>
            <option value="">{t("finance.allCategories")}</option>
            {(["expense", "income"] as const).map((k) => (
              <optgroup key={k} label={t(`finance.kind.${k}`)}>
                {topLevel(meta, k, true).flatMap((c) => [
                  <option key={c.id} value={c.id}>{`${c.icon} ${c.name}`}</option>,
                  ...childrenOf(meta, c.id, true).map((s) => (
                    <option key={s.id} value={s.id}>{`   ${c.name} › ${s.name}`}</option>
                  )),
                ])}
              </optgroup>
            ))}
          </select>
          <select className="input" value={methodFilter} onChange={(e) => setParam("method", e.target.value)}>
            <option value="">{t("finance.allMethods")}</option>
            {activeMethods(meta).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {activeFilterCount > 0 && (
            <button
              type="button"
              className="chip-toggle chip-clear"
              onClick={() =>
                setParams((prev) => {
                  const next = new URLSearchParams(prev);
                  ["q", "category", "method"].forEach((k) => next.delete(k));
                  return next;
                })
              }
            >
              {t("filter.clear")}
            </button>
          )}
        </div>
      )}

      <div className="fin-summary">
        <div className="fin-summary-item">
          <span className="fin-summary-label">{t("finance.kind.income")}</span>
          <span className="fin-summary-value amt-income">{money(totals.income)}</span>
        </div>
        <div className="fin-summary-item">
          <span className="fin-summary-label">{t("finance.kind.expense")}</span>
          <span className="fin-summary-value amt-expense">{money(totals.expense)}</span>
        </div>
        <div className="fin-summary-item">
          <span className="fin-summary-label">{t("finance.net")}</span>
          <span className="fin-summary-value">{money(totals.net)}</span>
        </div>
      </div>

      {loading ? (
        <p className="muted">{t("common.loading")}</p>
      ) : error ? (
        <div className="center">
          <p className="muted">{t("common.error")}</p>
          <button className="btn btn-ghost" onClick={() => void load()}>{t("common.retry")}</button>
        </div>
      ) : view === "daily" ? (
        txs.length === 0 ? (
          <div className="empty">
            <p>{activeFilterCount > 0 ? t("finance.emptyFiltered") : t("finance.emptyMonth")}</p>
            {activeFilterCount === 0 && (
              <Link to="/finance/add" className="btn btn-primary">{"+ " + t("finance.add")}</Link>
            )}
          </div>
        ) : (
          <div className="day-groups">{Array.from(byDay.entries()).map(([iso, list]) => renderDay(iso, list))}</div>
        )
      ) : (
        <>
          <div className="cal">
            {weekdayNames.map((w) => (
              <div key={w} className="cal-weekday">{w}</div>
            ))}
            {calendarCells().map((iso, i) => {
              if (!iso) return <div key={`blank-${i}`} className="cal-cell is-blank" />;
              const s = sumBy(byDay.get(iso) ?? []);
              const isToday = iso === todayISO();
              return (
                <button
                  key={iso}
                  type="button"
                  className={`cal-cell ${selectedDay === iso ? "is-selected" : ""} ${isToday ? "is-today" : ""}`}
                  onClick={() => setSelectedDay(selectedDay === iso ? null : iso)}
                  aria-label={dayHeading(iso).full}
                >
                  <span className="cal-day">{Number(iso.slice(8))}</span>
                  {s.income > 0 && <span className="cal-amt amt-income" title={money(s.income)}>{compact(s.income)}</span>}
                  {s.expense > 0 && <span className="cal-amt amt-expense" title={money(s.expense)}>{compact(s.expense)}</span>}
                </button>
              );
            })}
          </div>
          {selectedDay && (
            <div className="day-groups cal-detail">
              {byDay.get(selectedDay) ? (
                renderDay(selectedDay, byDay.get(selectedDay)!)
              ) : (
                <div className="empty">
                  <p>{t("finance.emptyDay", { day: dayHeading(selectedDay).full })}</p>
                  <Link to={`/finance/add?date=${selectedDay}`} className="btn btn-ghost btn-sm">{"+ " + t("finance.add")}</Link>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {editing && (
        <div className="overlay" onClick={() => setEditing(null)}>
          <div className="overlay-body" onClick={(e) => e.stopPropagation()}>
            <div className="form-panel">
              <h2 className="form-heading">{t("finance.editTitle")}</h2>
              <TxForm
                meta={meta}
                initial={editing}
                onSaved={() => {
                  setEditing(null);
                  void load();
                }}
                onDeleted={() => {
                  setEditing(null);
                  void load();
                  void reloadMeta();
                }}
                onCancel={() => setEditing(null)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
