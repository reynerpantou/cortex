import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  activeMethods,
  financeApi,
  formatMoney,
  formatRate,
  methodIcon,
  parseAmount,
  todayISO,
  type FinanceMeta,
  type Kind,
  type Transaction,
  type TxInput,
} from "../../lib/finance";
import { ApiError } from "../../lib/api";
import CategoryPicker from "./CategoryPicker";
import { useFx } from "./useFx";

interface Props {
  meta: FinanceMeta;
  initial?: Transaction;
  defaultDate?: string;
  onSaved: (tx: Transaction, addAnother: boolean) => void;
  onCancel?: () => void;
  onDeleted?: () => void;
}

export default function TxForm({ meta, initial, defaultDate, onSaved, onCancel, onDeleted }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "en";
  const base = meta.base_currency;

  const [kind, setKind] = useState<Kind>(initial?.kind ?? "expense");
  const [date, setDate] = useState(initial?.occurred_on ?? defaultDate ?? todayISO());
  const [amountText, setAmountText] = useState(initial ? String(initial.amount) : "");
  const [currency, setCurrency] = useState(initial?.currency ?? base);
  // An edited transaction keeps the rate it was saved with unless the user
  // changes it (or the currency/date) — history shouldn't silently re-price.
  const [manualRate, setManualRate] = useState<string | null>(
    initial && initial.currency !== base ? String(initial.rate) : null
  );
  const [categoryId, setCategoryId] = useState<number | null>(initial?.category_id ?? null);
  const [methodId, setMethodId] = useState<number | null>(initial?.payment_method_id ?? null);
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fx = useFx(currency, date, base);
  const amount = parseAmount(amountText);
  const manualRateNum = manualRate !== null ? parseAmount(manualRate) : null;
  const effectiveRate = currency === base ? 1 : manualRateNum ?? fx.quote?.rate ?? null;
  const needsManualRate = currency !== base && fx.unavailable && manualRate === null;

  const switchKind = (k: Kind) => {
    if (k === kind) return;
    setKind(k);
    setCategoryId(null);
  };

  const reset = () => {
    setAmountText("");
    setNote("");
    setCategoryId(null);
    setManualRate(null);
    setError("");
  };

  const submit = async (addAnother: boolean) => {
    if (amount === null || amount <= 0) {
      setError(t("finance.form.amountRequired"));
      return;
    }
    if (currency !== base && !(effectiveRate && effectiveRate > 0)) {
      setError(t("finance.form.rateRequired"));
      return;
    }
    const input: TxInput = {
      kind,
      occurred_on: date,
      amount,
      currency,
      rate: effectiveRate ?? undefined,
      category_id: categoryId,
      payment_method_id: methodId,
      note: note.trim(),
    };
    setBusy(true);
    setError("");
    try {
      const saved = initial ? await financeApi.updateTransaction(initial.id, input) : await financeApi.createTransaction(input);
      if (addAnother) reset();
      onSaved(saved, addAnother);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!initial) return;
    setBusy(true);
    try {
      await financeApi.deleteTransaction(initial.id);
      onDeleted?.();
    } catch {
      setError(t("common.error"));
      setBusy(false);
    }
  };

  return (
    <form
      className="tx-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
    >
      <div className="kind-toggle" role="radiogroup" aria-label={t("finance.form.type")}>
        {(["expense", "income"] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            className={`kind-toggle-opt kind-${k} ${kind === k ? "is-on" : ""}`}
            onClick={() => switchKind(k)}
          >
            {t(`finance.kind.${k}`)}
          </button>
        ))}
      </div>

      <div className="field-row">
        <label className="field tx-date-field">
          <span className="field-label">{t("finance.form.date")}</span>
          <input
            type="date"
            className="input"
            value={date}
            required
            onChange={(e) => {
              setDate(e.target.value);
              setManualRate(null);
            }}
          />
        </label>
      </div>

      <div className="field">
        <span className="field-label">{t("finance.form.amount")}</span>
        <div className="amount-row">
          <select
            className="input currency-select"
            aria-label={t("finance.form.currency")}
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value);
              setManualRate(null);
            }}
          >
            {Array.from(new Set([base, ...meta.currencies, currency])).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            className="input amount-input"
            inputMode="decimal"
            autoFocus={!initial}
            placeholder="0"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
          />
        </div>
        {currency !== base && (
          <div className="fx-line">
            {amount !== null && amount > 0 && effectiveRate ? (
              <strong className="fx-converted">≈ {formatMoney(amount * effectiveRate, base, lang)}</strong>
            ) : null}
            {fx.loading && manualRate === null ? (
              <span className="muted">{t("finance.form.fetchingRate")}</span>
            ) : manualRate !== null || needsManualRate ? (
              <span className="fx-rate-edit">
                {"1 " + currency + " = "}
                <input
                  className="input fx-rate-input"
                  inputMode="decimal"
                  aria-label={t("finance.form.rate")}
                  value={manualRate ?? ""}
                  onChange={(e) => setManualRate(e.target.value)}
                />
                {" " + base}
                {fx.quote && (
                  <button type="button" className="link-btn" onClick={() => setManualRate(null)}>
                    {t("finance.form.useMarketRate")}
                  </button>
                )}
              </span>
            ) : fx.quote ? (
              <span className="fx-rate-text">
                {`1 ${currency} = ${formatMoney(fx.quote.rate, base, lang)} · ${t("finance.form.rateSource", { date: fx.quote.date })}`}
                <button type="button" className="link-btn" onClick={() => setManualRate(formatRate(fx.quote!.rate, "en").replace(/,/g, ""))}>
                  {t("finance.form.editRate")}
                </button>
              </span>
            ) : null}
            {needsManualRate && <span className="fx-warn">{t("finance.form.rateUnavailable")}</span>}
          </div>
        )}
      </div>

      <div className="field">
        <span className="field-label">{t("finance.form.category")}</span>
        <CategoryPicker meta={meta} kind={kind} value={categoryId} onChange={setCategoryId} />
      </div>

      <div className="field">
        <span className="field-label">{t("finance.form.paidWith")}</span>
        <div className="chip-select">
          {activeMethods(meta).map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip-toggle chip-sm ${methodId === p.id ? "is-on" : ""}`}
              aria-pressed={methodId === p.id}
              onClick={() => setMethodId(methodId === p.id ? null : p.id)}
            >
              <span aria-hidden="true">{methodIcon(p)}</span>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span className="field-label">{t("finance.form.note")}</span>
        <input className="input" value={note} placeholder={t("finance.form.notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        {initial && onDeleted && (
          confirmDelete ? (
            <>
              <span className="muted">{t("finance.form.confirmDelete")}</span>
              <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void remove()}>
                {t("form.delete")}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>
                {t("form.cancel")}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
              {t("form.delete")}
            </button>
          )
        )}
        <span className="spacer" />
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            {t("form.cancel")}
          </button>
        )}
        {!initial && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void submit(true)}>
            {t("finance.form.saveAndAdd")}
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {t("form.save")}
        </button>
      </div>
    </form>
  );
}
