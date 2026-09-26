import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { categoryIcon, currentMonth, financeApi, formatMoney, isValidMonth, parseAmount, type Budget } from "../../lib/finance";
import MonthSwitcher from "../../components/finance/MonthSwitcher";
import { useFinance } from "./FinanceLayout";

function level(spent: number, amount: number): "ok" | "near" | "over" {
  if (spent > amount) return "over";
  if (spent >= amount * 0.8) return "near";
  return "ok";
}

export default function Budgets() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "en";
  const { meta } = useFinance();
  const base = meta.base_currency;
  const [params, setParams] = useSearchParams();
  const month = isValidMonth(params.get("m")) ? params.get("m")! : currentMonth();

  const [budgets, setBudgets] = useState<Budget[] | null>(null);
  const [error, setError] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  const load = async () => {
    setError(false);
    try {
      setBudgets(await financeApi.budgets(month));
    } catch {
      setError(true);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const money = (v: number) => formatMoney(v, base, lang);

  const save = async (categoryId: number) => {
    const amount = parseAmount(draft) ?? 0;
    await financeApi.setBudget(categoryId, Math.max(0, amount));
    setEditingId(null);
    await load();
  };

  const budgeted = (budgets ?? []).filter((b) => b.amount != null);
  const totalBudget = budgeted.reduce((s, b) => s + (b.amount ?? 0), 0);
  const totalSpentBudgeted = budgeted.reduce((s, b) => s + b.spent, 0);
  const totalSpentAll = (budgets ?? []).reduce((s, b) => s + b.spent, 0);

  return (
    <>
      <div className="fin-toolbar">
        <MonthSwitcher
          month={month}
          onChange={(m) => setParams((prev) => {
            const next = new URLSearchParams(prev);
            if (m === currentMonth()) next.delete("m");
            else next.set("m", m);
            return next;
          }, { replace: true })}
        />
      </div>
      <p className="muted budget-lead">{t("finance.budgets.lead")}</p>

      {error ? (
        <p className="muted">{t("common.error")}</p>
      ) : !budgets ? (
        <p className="muted">{t("common.loading")}</p>
      ) : (
        <>
          {totalBudget > 0 && (
            <div className="budget-total">
              <div className="budget-row-head">
                <span className="budget-name">{t("finance.budgets.total")}</span>
                <span className="budget-figures">
                  {t("finance.budgets.ofBudget", { spent: money(totalSpentBudgeted), budget: money(totalBudget) })}
                </span>
              </div>
              <Meter spent={totalSpentBudgeted} amount={totalBudget} />
              <p className="muted budget-note">{t("finance.budgets.allSpending", { amount: money(totalSpentAll) })}</p>
            </div>
          )}

          <ul className="budget-list">
            {budgets.map((b) => {
              const c = meta.categories.find((x) => x.id === b.category_id);
              if (!c) return null;
              const lvl = b.amount != null ? level(b.spent, b.amount) : null;
              return (
                <li key={b.category_id} className="budget-row">
                  <div className="budget-row-head">
                    <span className="budget-name">
                      <span aria-hidden="true">{categoryIcon(meta, c)}</span> {c.name}
                    </span>
                    {editingId === b.category_id ? (
                      <form
                        className="budget-edit"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void save(b.category_id);
                        }}
                      >
                        <input
                          className="input budget-input"
                          inputMode="decimal"
                          autoFocus
                          placeholder={t("finance.budgets.amountPlaceholder", { currency: base })}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                        />
                        <button type="submit" className="btn btn-primary btn-sm">{t("form.save")}</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>{t("form.cancel")}</button>
                      </form>
                    ) : (
                      <span className="budget-figures">
                        {b.amount != null ? (
                          <>
                            {t("finance.budgets.ofBudget", { spent: money(b.spent), budget: money(b.amount) })}
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => {
                                setEditingId(b.category_id);
                                setDraft(String(b.amount));
                              }}
                            >
                              {t("finance.budgets.edit")}
                            </button>
                          </>
                        ) : (
                          <>
                            {b.spent > 0 && (
                              <Link className="muted" to={`/finance?category=${b.category_id}${month !== currentMonth() ? `&m=${month}` : ""}`}>
                                {t("finance.budgets.spentOnly", { spent: money(b.spent) })}
                              </Link>
                            )}
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => {
                                setEditingId(b.category_id);
                                setDraft("");
                              }}
                            >
                              {t("finance.budgets.set")}
                            </button>
                          </>
                        )}
                      </span>
                    )}
                  </div>
                  {b.amount != null && (
                    <>
                      <Meter spent={b.spent} amount={b.amount} />
                      <p className={`budget-status budget-status-${lvl}`}>
                        {lvl === "over"
                          ? `⚠ ${t("finance.budgets.over", { amount: money(b.spent - b.amount) })}`
                          : lvl === "near"
                            ? `● ${t("finance.budgets.left", { amount: money(b.amount - b.spent) })}`
                            : t("finance.budgets.left", { amount: money(b.amount - b.spent) })}
                      </p>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

function Meter({ spent, amount }: { spent: number; amount: number }) {
  const pct = amount > 0 ? Math.min(100, (spent / amount) * 100) : 0;
  return (
    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={amount} aria-valuenow={spent}>
      <div className={`meter-fill meter-${level(spent, amount)}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
