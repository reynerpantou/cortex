import { useState } from "react";
import { useTranslation } from "react-i18next";
import { buildExportCsv, downloadText, financeApi, monthLabel, monthRange, todayISO, type FinanceMeta } from "../../lib/finance";

type Scope = "month" | "year" | "all" | "custom";

export interface ExportFilters {
  category_id?: number;
  payment_method_id?: number;
  q?: string;
}

interface Props {
  meta: FinanceMeta;
  month: string;
  filters?: ExportFilters;
  onClose: () => void;
}

export default function ExportDialog({ meta, month, filters, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "en";
  const hasFilters = !!(filters && (filters.category_id || filters.payment_method_id || filters.q));
  const [scope, setScope] = useState<Scope>("month");
  const [from, setFrom] = useState(`${month.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(todayISO());
  const [useFilters, setUseFilters] = useState(hasFilters);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const year = month.slice(0, 4);
  const rangeFor = (): { from: string; to: string; name: string } | null => {
    switch (scope) {
      case "month":
        return { ...monthRange(month), name: month };
      case "year":
        return { from: `${year}-01-01`, to: `${year}-12-31`, name: year };
      case "all":
        return { from: "1900-01-01", to: "9999-12-31", name: "all" };
      case "custom":
        return from && to && from <= to ? { from, to, name: `${from}_to_${to}` } : null;
    }
  };

  const run = async () => {
    const r = rangeFor();
    if (!r) {
      setMessage(t("finance.export.badRange"));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const txs = await financeApi.listTransactions({ from: r.from, to: r.to, ...(useFilters ? filters : {}) });
      if (txs.length === 0) {
        setMessage(t("finance.export.nothing"));
        return;
      }
      downloadText(`cortex-finance-${r.name}.csv`, buildExportCsv(meta, txs));
      onClose();
    } catch {
      setMessage(t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const options: { value: Scope; label: string }[] = [
    { value: "month", label: t("finance.export.month", { month: monthLabel(month, lang) }) },
    { value: "year", label: t("finance.export.year", { year }) },
    { value: "all", label: t("finance.export.all") },
    { value: "custom", label: t("finance.export.custom") },
  ];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-body" onClick={(e) => e.stopPropagation()}>
        <div className="form-panel" role="dialog" aria-label={t("finance.export.title")}>
          <h2 className="form-heading">{t("finance.export.title")}</h2>
          <p className="muted setting-lead">{t("finance.export.lead")}</p>
          <div className="radio-list">
            {options.map((o) => (
              <label key={o.value} className="radio-row">
                <input type="radio" name="export-scope" checked={scope === o.value} onChange={() => setScope(o.value)} />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
          {scope === "custom" && (
            <div className="field-row">
              <label className="field">
                <span className="field-label">{t("finance.export.from")}</span>
                <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">{t("finance.export.to")}</span>
                <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
          )}
          {hasFilters && (
            <label className="radio-row">
              <input type="checkbox" checked={useFilters} onChange={(e) => setUseFilters(e.target.checked)} />
              <span>{t("finance.export.onlyFiltered")}</span>
            </label>
          )}
          {message && <p className="form-error">{message}</p>}
          <div className="form-actions">
            <span className="spacer" />
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t("form.cancel")}</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run()}>
              {busy ? t("common.loading") : t("finance.export.download")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
