import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CSV_TEMPLATE,
  activeMethods,
  categoryIcon,
  childrenOf,
  financeApi,
  findCategoryByNames,
  findMethodByName,
  formatMoney,
  parseAmount,
  parseDate,
  parseImport,
  parseQuickEntry,
  suggestIcon,
  todayISO,
  topLevel,
  type FinanceMeta,
  type ImportedRow,
  type Kind,
  type RowError,
  type TxInput,
  type TxSource,
} from "../../lib/finance";
import { ApiError } from "../../lib/api";
import TxForm from "../../components/finance/TxForm";
import { useFx } from "../../components/finance/useFx";
import { useFinance } from "./FinanceLayout";

interface GridRow {
  key: string;
  kind: Kind;
  date: string;
  categoryId: number | null;
  amountText: string;
  currency: string;
  rateText: string;
  methodId: number | null;
  note: string;
  source: TxSource;
  missingCategory?: { name: string; sub: string };
  missingMethod?: string;
  error?: string;
}

let rowSeq = 0;
const newKey = () => `r${++rowSeq}`;

function blankRow(meta: FinanceMeta, date = todayISO()): GridRow {
  return { key: newKey(), kind: "expense", date, categoryId: null, amountText: "", currency: meta.base_currency, rateText: "", methodId: null, note: "", source: "manual" };
}

function isBlank(r: GridRow): boolean {
  return !r.amountText.trim() && !r.note.trim() && r.categoryId == null && !r.missingCategory;
}

function rowFromImport(r: ImportedRow, meta: FinanceMeta): GridRow {
  let kind = r.kind;
  let cat = r.category ? findCategoryByNames(meta, kind, r.category, r.subcategory) : null;
  if (!cat && r.category) {
    // The file may omit the type column; a category name that only exists
    // on the other side (e.g. "Salary") settles which side the row is.
    const other: Kind = kind === "income" ? "expense" : "income";
    const alt = findCategoryByNames(meta, other, r.category, r.subcategory);
    if (alt) {
      cat = alt;
      kind = other;
    }
  }
  const method = r.paymentMethod ? findMethodByName(meta, r.paymentMethod) : null;
  return {
    key: newKey(),
    kind,
    date: r.date ?? "",
    categoryId: cat?.id ?? null,
    amountText: r.amount != null ? String(r.amount) : "",
    currency: r.currency || meta.base_currency,
    rateText: r.rate != null ? String(r.rate) : "",
    methodId: method?.id ?? null,
    note: r.note,
    source: "csv",
    missingCategory: r.category && !cat ? { name: r.category, sub: r.subcategory } : undefined,
    missingMethod: r.paymentMethod && !method ? r.paymentMethod : undefined,
    error: r.date ? undefined : "invalid-date",
  };
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function speechCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

const SPEECH_LANG: Record<string, string> = { en: "en-US", id: "id-ID", zh: "zh-CN" };

export default function Add() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "en";
  const { meta, reloadMeta } = useFinance();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "bulk" ? "bulk" : "single";
  const defaultDate = parseDate(params.get("date") ?? "") ?? todayISO();

  const setTab = (next: "single" | "bulk") =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === "bulk") p.set("tab", "bulk");
      else p.delete("tab");
      return p;
    }, { replace: true });

  const [rows, setRows] = useState<GridRow[]>(() => [blankRow(meta, defaultDate)]);
  const [quickText, setQuickText] = useState("");
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [creatingMissing, setCreatingMissing] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 2400);
    return () => clearTimeout(id);
  }, [toast]);

  const updateRow = (key: string, patch: Partial<GridRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch, error: undefined } : r)));

  const appendRows = (incoming: GridRow[]) => {
    if (incoming.length === 0) return;
    setRows((prev) => [...prev.filter((r) => !isBlank(r)), ...incoming]);
    setTab("bulk");
  };

  const addFromQuick = (text: string, source: TxSource) => {
    const drafts = parseQuickEntry(text, meta);
    if (drafts.length === 0) {
      setNotice({ kind: "error", text: t("finance.addPage.quickNoAmount") });
      return;
    }
    appendRows(
      drafts.map((d) => ({
        key: newKey(),
        kind: d.kind,
        date: d.occurred_on,
        categoryId: d.category_id,
        amountText: d.amount != null ? String(d.amount) : "",
        currency: d.currency,
        rateText: "",
        methodId: d.payment_method_id,
        note: d.note,
        source,
      }))
    );
    setNotice({ kind: "ok", text: t("finance.addPage.quickAdded", { count: drafts.length }) });
    setQuickText("");
  };

  const Speech = speechCtor();

  const toggleVoice = () => {
    if (!Speech) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const rec = new Speech();
    rec.lang = SPEECH_LANG[lang] ?? "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (e) => {
      finalText = Array.from(e.results).map((r) => r[0].transcript).join(" ");
      setQuickText(finalText);
    };
    rec.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") setNotice({ kind: "error", text: t("finance.addPage.voiceError") });
    };
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      if (finalText.trim()) addFromQuick(finalText, "voice");
    };
    recognitionRef.current = rec;
    setNotice(null);
    setListening(true);
    rec.start();
  };

  useEffect(() => () => recognitionRef.current?.stop(), []);

  const importText = (text: string) => {
    const parsed = parseImport(text);
    if (parsed.length === 0) {
      setNotice({ kind: "error", text: t("finance.addPage.importEmpty") });
      return;
    }
    appendRows(parsed.map((r) => rowFromImport(r, meta)));
    setNotice({ kind: "ok", text: t("finance.addPage.imported", { count: parsed.length }) });
  };

  const onFile = async (file: File) => {
    importText(await file.text());
    if (fileRef.current) fileRef.current.value = "";
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "cortex-finance-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const missingCats = Array.from(
    new Map(
      rows
        .filter((r) => r.missingCategory)
        .map((r) => [`${r.kind}|${r.missingCategory!.name.toLowerCase()}|${r.missingCategory!.sub.toLowerCase()}`, { kind: r.kind, ...r.missingCategory! }])
    ).values()
  );
  const missingMethods = Array.from(new Set(rows.filter((r) => r.missingMethod).map((r) => r.missingMethod!.trim())));

  const createMissing = async () => {
    setCreatingMissing(true);
    try {
      let current = meta;
      for (const m of missingCats) {
        let parent = findCategoryByNames(current, m.kind, m.name, "");
        if (!parent) {
          parent = await financeApi.createCategory({ kind: m.kind, parent_id: null, name: m.name, icon: suggestIcon(m.name) });
          current = { ...current, categories: [...current.categories, parent] };
        }
        if (m.sub && !findCategoryByNames(current, m.kind, m.name, m.sub)) {
          const sub = await financeApi.createCategory({ kind: m.kind, parent_id: parent.id, name: m.sub, icon: suggestIcon(m.sub) });
          current = { ...current, categories: [...current.categories, sub] };
        }
      }
      for (const name of missingMethods) {
        if (!findMethodByName(current, name)) {
          const pm = await financeApi.createPaymentMethod({ name, icon: suggestIcon(name) });
          current = { ...current, payment_methods: [...current.payment_methods, pm] };
        }
      }
      setRows((prev) =>
        prev.map((r) => {
          const next = { ...r };
          if (r.missingCategory) {
            const c = findCategoryByNames(current, r.kind, r.missingCategory.name, r.missingCategory.sub);
            if (c) {
              next.categoryId = c.id;
              next.missingCategory = undefined;
            }
          }
          if (r.missingMethod) {
            const pm = findMethodByName(current, r.missingMethod);
            if (pm) {
              next.methodId = pm.id;
              next.missingMethod = undefined;
            }
          }
          if (next.error === "missing-category" || next.error === "missing-method") next.error = undefined;
          return next;
        })
      );
      setNotice(null);
      await reloadMeta();
    } catch {
      setNotice({ kind: "error", text: t("common.error") });
    } finally {
      setCreatingMissing(false);
    }
  };

  const saveAll = async () => {
    const pending = rows.filter((r) => !isBlank(r));
    if (pending.length === 0) return;
    let invalid = false;
    const checked = rows.map((r) => {
      if (isBlank(r)) return r;
      const amount = parseAmount(r.amountText);
      let error: string | undefined;
      if (!r.date) error = "invalid-date";
      else if (amount === null || amount <= 0) error = "amount";
      else if (r.missingCategory) error = "missing-category";
      else if (r.missingMethod) error = "missing-method";
      if (error) invalid = true;
      return { ...r, error };
    });
    setRows(checked);
    if (invalid) {
      setNotice({ kind: "error", text: t("finance.addPage.fixRows") });
      return;
    }

    const inputs: TxInput[] = pending.map((r) => {
      const rate = parseAmount(r.rateText);
      return {
        kind: r.kind,
        occurred_on: r.date,
        amount: parseAmount(r.amountText)!,
        currency: r.currency,
        rate: rate && rate > 0 ? rate : undefined,
        category_id: r.categoryId,
        payment_method_id: r.methodId,
        note: r.note.trim(),
        source: r.source,
      };
    });
    setSaving(true);
    setNotice(null);
    try {
      const res = await financeApi.bulkCreate(inputs);
      setRows([blankRow(meta)]);
      setToast(t("finance.addPage.saved", { count: res.created }));
      void reloadMeta();
    } catch (e) {
      const rowErrors = e instanceof ApiError ? ((e.body as { row_errors?: RowError[] } | null)?.row_errors ?? []) : [];
      if (rowErrors.length > 0) {
        const byKey = new Map(rowErrors.map((re) => [pending[re.index]?.key, re.message]));
        setRows((prev) => prev.map((r) => (byKey.has(r.key) ? { ...r, error: byKey.get(r.key) } : r)));
        setNotice({ kind: "error", text: t("finance.addPage.fixRows") });
      } else {
        setNotice({ kind: "error", text: e instanceof ApiError ? e.message : t("common.error") });
      }
    } finally {
      setSaving(false);
    }
  };

  const filled = rows.filter((r) => !isBlank(r)).length;

  return (
    <>
      <div className="add-head">
        <Link to="/finance" className="back-link">{"← " + t("finance.backToTransactions")}</Link>
        <div className="seg" role="tablist">
          {(["single", "bulk"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={tab === v} className={`seg-opt ${tab === v ? "is-on" : ""}`} onClick={() => setTab(v)}>
              {t(`finance.addPage.${v}`)}
              {v === "bulk" && filled > 0 ? ` (${filled})` : ""}
            </button>
          ))}
        </div>
      </div>

      <section className="quick-entry">
        <form
          className="quick-entry-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (quickText.trim()) addFromQuick(quickText, "manual");
          }}
        >
          <button
            type="button"
            className={`mic-btn ${listening ? "is-listening" : ""}`}
            onClick={toggleVoice}
            disabled={!Speech}
            aria-pressed={listening}
            aria-label={listening ? t("finance.addPage.stopListening") : t("finance.addPage.speak")}
            title={Speech ? t("finance.addPage.speak") : t("finance.addPage.voiceUnsupported")}
          >
            {listening ? "■" : "🎤"}
          </button>
          <input
            className="input"
            value={quickText}
            placeholder={listening ? t("finance.addPage.listening") : t("finance.addPage.quickPlaceholder")}
            onChange={(e) => setQuickText(e.target.value)}
          />
          <button type="submit" className="btn btn-ghost" disabled={!quickText.trim()}>
            {t("finance.addPage.quickAdd")}
          </button>
        </form>
        <p className="quick-entry-hint muted">{t("finance.addPage.quickHint")}</p>
      </section>

      {notice && <p className={notice.kind === "ok" ? "notice-ok" : "form-error"}>{notice.text}</p>}

      {tab === "single" ? (
        <div className="form-panel">
          <TxForm
            meta={meta}
            defaultDate={defaultDate}
            onSaved={(tx, addAnother) => {
              void reloadMeta();
              if (addAnother) setToast(t("finance.addPage.saved", { count: 1 }));
              else navigate(`/finance?m=${tx.occurred_on.slice(0, 7)}`);
            }}
            onCancel={() => navigate("/finance")}
          />
        </div>
      ) : (
        <div className="form-panel bulk-panel">
          <div className="bulk-tools">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
              {t("finance.addPage.importCsv")}
            </button>
            <button type="button" className="link-btn" onClick={downloadTemplate}>
              {t("finance.addPage.template")}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
              hidden
              onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
            />
            <span className="muted bulk-paste-hint">{t("finance.addPage.pasteHint")}</span>
          </div>

          {(missingCats.length > 0 || missingMethods.length > 0) && (
            <div className="missing-banner">
              <span>
                {t("finance.addPage.missing", {
                  names: [
                    ...missingCats.map((m) => (m.sub ? `${m.name} › ${m.sub}` : m.name)),
                    ...missingMethods,
                  ].join(", "),
                })}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" disabled={creatingMissing} onClick={() => void createMissing()}>
                {t("finance.addPage.createMissing")}
              </button>
            </div>
          )}

          <div
            className="bulk-grid-wrap"
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (text.includes("\t") || text.trim().includes("\n")) {
                e.preventDefault();
                importText(text);
              }
            }}
          >
            <table className="bulk-grid">
              <thead>
                <tr>
                  <th>{t("finance.form.date")}</th>
                  <th>{t("finance.form.type")}</th>
                  <th>{t("finance.form.category")}</th>
                  <th>{t("finance.form.amount")}</th>
                  <th>{t("finance.form.paidWith")}</th>
                  <th>{t("finance.form.note")}</th>
                  <th aria-label={t("finance.addPage.removeRow")} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <BulkRow
                    key={r.key}
                    row={r}
                    meta={meta}
                    lang={lang}
                    onChange={(patch) => updateRow(r.key, patch)}
                    onRemove={() => setRows((prev) => (prev.length > 1 ? prev.filter((x) => x.key !== r.key) : [blankRow(meta)]))}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                const last = rows[rows.length - 1];
                setRows((prev) => [...prev, { ...blankRow(meta, last?.date || todayISO()), kind: last?.kind ?? "expense" }]);
              }}
            >
              {"+ " + t("finance.addPage.addRow")}
            </button>
            <span className="spacer" />
            <button type="button" className="btn btn-primary" disabled={saving || filled === 0} onClick={() => void saveAll()}>
              {saving ? t("common.loading") : t("finance.addPage.saveAll", { count: filled })}
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <span className="toast-check" aria-hidden="true">✓</span>
          {toast}
        </div>
      )}
    </>
  );
}

function BulkRow({
  row,
  meta,
  lang,
  onChange,
  onRemove,
}: {
  row: GridRow;
  meta: FinanceMeta;
  lang: string;
  onChange: (patch: Partial<GridRow>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const base = meta.base_currency;
  const fx = useFx(row.rateText ? "" : row.currency, row.date, base);
  const amount = parseAmount(row.amountText);
  const rate = row.currency === base ? 1 : parseAmount(row.rateText) ?? fx.quote?.rate ?? null;

  const errorText =
    row.error === "invalid-date"
      ? t("finance.addPage.errDate")
      : row.error === "amount"
        ? t("finance.form.amountRequired")
        : row.error === "missing-category"
          ? t("finance.addPage.errCategory")
          : row.error === "missing-method"
            ? t("finance.addPage.errMethod")
            : row.error;

  return (
    <>
      <tr className={`bulk-row ${row.error ? "has-error" : ""}`}>
        <td>
          <input type="date" className="input bulk-date" value={row.date} onChange={(e) => onChange({ date: e.target.value })} aria-label={t("finance.form.date")} />
        </td>
        <td>
          <select
            className={`input bulk-kind kind-text-${row.kind}`}
            value={row.kind}
            aria-label={t("finance.form.type")}
            onChange={(e) => onChange({ kind: e.target.value as Kind, categoryId: null, missingCategory: undefined })}
          >
            <option value="expense">{t("finance.kind.expense")}</option>
            <option value="income">{t("finance.kind.income")}</option>
          </select>
        </td>
        <td>
          <select
            className={`input bulk-cat ${row.missingCategory ? "input-invalid" : ""}`}
            aria-label={t("finance.form.category")}
            value={row.missingCategory ? "missing" : row.categoryId ?? ""}
            onChange={(e) => onChange({ categoryId: e.target.value ? Number(e.target.value) : null, missingCategory: undefined })}
          >
            {row.missingCategory && (
              <option value="missing" disabled>
                {`⚠ ${row.missingCategory.sub ? `${row.missingCategory.name} › ${row.missingCategory.sub}` : row.missingCategory.name}`}
              </option>
            )}
            <option value="">{t("finance.uncategorized")}</option>
            {topLevel(meta, row.kind).flatMap((c) => [
              <option key={c.id} value={c.id}>{`${categoryIcon(meta, c)} ${c.name}`}</option>,
              ...childrenOf(meta, c.id).map((s) => (
                <option key={s.id} value={s.id}>{`   ${c.name} › ${s.name}`}</option>
              )),
            ])}
          </select>
        </td>
        <td>
          <div className="bulk-amount">
            <select className="input bulk-currency" value={row.currency} aria-label={t("finance.form.currency")} onChange={(e) => onChange({ currency: e.target.value, rateText: "" })}>
              {Array.from(new Set([base, ...meta.currencies, row.currency])).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input
              className="input bulk-amount-input"
              inputMode="decimal"
              placeholder="0"
              value={row.amountText}
              aria-label={t("finance.form.amount")}
              onChange={(e) => onChange({ amountText: e.target.value })}
            />
          </div>
          {row.currency !== base && (
            <div className="bulk-fx">
              {amount && rate ? `≈ ${formatMoney(amount * rate, base, lang)}` : fx.loading ? "…" : ""}
              {fx.unavailable && !row.rateText && (
                <input
                  className="input bulk-rate-input"
                  inputMode="decimal"
                  placeholder={t("finance.addPage.ratePlaceholder", { currency: row.currency, base })}
                  value={row.rateText}
                  onChange={(e) => onChange({ rateText: e.target.value })}
                />
              )}
            </div>
          )}
        </td>
        <td>
          <select
            className={`input bulk-method ${row.missingMethod ? "input-invalid" : ""}`}
            aria-label={t("finance.form.paidWith")}
            value={row.missingMethod ? "missing" : row.methodId ?? ""}
            onChange={(e) => onChange({ methodId: e.target.value ? Number(e.target.value) : null, missingMethod: undefined })}
          >
            {row.missingMethod && <option value="missing" disabled>{`⚠ ${row.missingMethod}`}</option>}
            <option value="">—</option>
            {activeMethods(meta).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </td>
        <td>
          <input className="input bulk-note" value={row.note} aria-label={t("finance.form.note")} onChange={(e) => onChange({ note: e.target.value })} />
        </td>
        <td>
          <button type="button" className="row-remove" aria-label={t("finance.addPage.removeRow")} onClick={onRemove}>
            ×
          </button>
        </td>
      </tr>
      {errorText && (
        <tr className="bulk-row-error">
          <td colSpan={7}>{errorText}</td>
        </tr>
      )}
    </>
  );
}
