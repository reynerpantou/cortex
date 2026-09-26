import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../lib/api";
import {
  DEFAULT_CATEGORY_ICON,
  DEFAULT_METHOD_ICON,
  activeMethods,
  categoryIcon,
  currentMonth,
  childrenOf,
  financeApi,
  parseAmount,
  rateLabel,
  suggestIcon,
  todayISO,
  topLevel,
  type Category,
  type Kind,
  type PaymentMethod,
} from "../../lib/finance";
import IconPicker from "../../components/finance/IconPicker";
import ExportDialog from "../../components/finance/ExportDialog";
import { useFinance } from "./FinanceLayout";

export default function Settings() {
  const { t } = useTranslation();
  const { meta, reloadMeta } = useFinance();
  const [kind, setKind] = useState<Kind>("expense");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setNotice("");
    try {
      await fn();
      await reloadMeta();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : t("common.error"));
    }
  };

  const move = (list: { id: number }[], index: number, dir: -1 | 1, save: (ids: number[]) => Promise<void>) => {
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    const ids = list.map((x) => x.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void run(() => save(ids));
  };

  const removeCategory = (c: Category) =>
    run(async () => {
      const res = await financeApi.deleteCategory(c.id);
      if (res.archived) setNotice(t("finance.settings.archivedNotice", { name: c.name }));
    });

  const removeMethod = (p: PaymentMethod) =>
    run(async () => {
      const res = await financeApi.deletePaymentMethod(p.id);
      if (res.archived) setNotice(t("finance.settings.archivedNotice", { name: p.name }));
    });

  const tops = topLevel(meta, kind);
  const methods = activeMethods(meta);

  return (
    <div className="fin-settings">
      {notice && <p className="notice-ok">{notice}</p>}

      <section className="stats-card">
        <header className="stats-card-head">
          <h2 className="section-title">{t("finance.settings.categories")}</h2>
          <div className="seg" role="tablist">
            {(["expense", "income"] as Kind[]).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={kind === k} className={`seg-opt ${kind === k ? "is-on" : ""}`} onClick={() => { setKind(k); setExpanded(null); }}>
                {t(`finance.kind.${k}`)}
              </button>
            ))}
          </div>
        </header>

        <ul className="setting-list">
          {tops.map((c, i) => {
            const subs = childrenOf(meta, c.id);
            const open = expanded === c.id;
            return (
              <li key={c.id} className="setting-item">
                <EditableRow
                  item={c}
                  fallbackIcon={DEFAULT_CATEGORY_ICON}
                  onSave={(name, icon) => run(() => financeApi.updateCategory(c.id, { name, icon, archived: false }))}
                  onUp={i > 0 ? () => move(tops, i, -1, financeApi.reorderCategories) : undefined}
                  onDown={i < tops.length - 1 ? () => move(tops, i, 1, financeApi.reorderCategories) : undefined}
                  onDelete={() => void removeCategory(c)}
                  extra={
                    <button type="button" className="link-btn" aria-expanded={open} onClick={() => setExpanded(open ? null : c.id)}>
                      {t("finance.settings.subcount", { count: subs.length })} {open ? "▾" : "▸"}
                    </button>
                  }
                />
                {open && (
                  <ul className="setting-sublist">
                    {subs.map((s, si) => (
                      <li key={s.id}>
                        <EditableRow
                          item={s}
                          fallbackIcon={categoryIcon(meta, c)}
                          onSave={(name, icon) => run(() => financeApi.updateCategory(s.id, { name, icon, archived: false }))}
                          onUp={si > 0 ? () => move(subs, si, -1, financeApi.reorderCategories) : undefined}
                          onDown={si < subs.length - 1 ? () => move(subs, si, 1, financeApi.reorderCategories) : undefined}
                          onDelete={() => void removeCategory(s)}
                        />
                      </li>
                    ))}
                    <li>
                      <AddRow
                        placeholder={t("finance.settings.newSubcategory", { name: c.name })}
                        fallbackIcon={categoryIcon(meta, c)}
                        onAdd={(name, icon) => run(() => financeApi.createCategory({ kind, parent_id: c.id, name, icon }))}
                      />
                    </li>
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        <AddRow
          placeholder={t("finance.settings.newCategory")}
          fallbackIcon={DEFAULT_CATEGORY_ICON}
          onAdd={(name, icon) => run(() => financeApi.createCategory({ kind, parent_id: null, name, icon }))}
        />
      </section>

      <section className="stats-card">
        <header className="stats-card-head">
          <h2 className="section-title">{t("finance.settings.paymentMethods")}</h2>
        </header>
        <p className="muted setting-lead">{t("finance.settings.paymentLead")}</p>
        <ul className="setting-list">
          {methods.map((p, i) => (
            <li key={p.id} className="setting-item">
              <EditableRow
                item={p}
                fallbackIcon={DEFAULT_METHOD_ICON}
                onSave={(name, icon) => run(() => financeApi.updatePaymentMethod(p.id, { name, icon, archived: false }))}
                onUp={i > 0 ? () => move(methods, i, -1, financeApi.reorderPaymentMethods) : undefined}
                onDown={i < methods.length - 1 ? () => move(methods, i, 1, financeApi.reorderPaymentMethods) : undefined}
                onDelete={() => void removeMethod(p)}
              />
            </li>
          ))}
        </ul>
        <AddRow
          placeholder={t("finance.settings.newMethod")}
          fallbackIcon={DEFAULT_METHOD_ICON}
          onAdd={(name, icon) => run(() => financeApi.createPaymentMethod({ name, icon }))}
        />
      </section>

      <BaseCurrencySection />

      <section className="stats-card">
        <header className="stats-card-head">
          <h2 className="section-title">{t("finance.export.title")}</h2>
        </header>
        <p className="muted setting-lead">{t("finance.export.lead")}</p>
        <button type="button" className="btn btn-ghost" onClick={() => setExporting(true)}>
          {t("finance.export.button")}
        </button>
      </section>
      {exporting && <ExportDialog meta={meta} month={currentMonth()} onClose={() => setExporting(false)} />}
    </div>
  );
}

function BaseCurrencySection() {
  const { t, i18n } = useTranslation();
  const { meta, reloadMeta } = useFinance();
  const oldBase = meta.base_currency;
  const hasData = meta.has_transactions || meta.has_budgets;
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [rateText, setRateText] = useState("");
  const [rateInfo, setRateInfo] = useState<{ loading: boolean; date?: string; unavailable?: boolean }>({ loading: false });
  const [mode, setMode] = useState<"convert" | "reset">("convert");
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const choices = meta.currencies.filter((c) => c !== oldBase);

  const pick = (c: string) => {
    setTarget(c);
    setRateText("");
    setError("");
    if (!c || !hasData) return;
    setRateInfo({ loading: true });
    financeApi
      .fx(oldBase, todayISO(), c)
      .then((q) => {
        setRateText(String(q.rate));
        setRateInfo({ loading: false, date: q.date });
      })
      .catch(() => setRateInfo({ loading: false, unavailable: true }));
  };

  const close = () => {
    setOpen(false);
    setTarget("");
    setMode("convert");
    setConfirmReset(false);
    setError("");
  };

  const rate = parseAmount(rateText);
  const canSubmit =
    !!target && !busy && (!hasData || (mode === "convert" ? rate !== null && rate > 0 : confirmReset));

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await financeApi.changeBaseCurrency(
        hasData ? { base_currency: target, mode, rate: mode === "convert" ? rate ?? undefined : undefined } : { base_currency: target }
      );
      await reloadMeta();
      setDone(t("finance.settings.baseChanged", { from: oldBase, to: target }));
      close();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stats-card">
      <header className="stats-card-head">
        <h2 className="section-title">{t("finance.settings.baseCurrency")}</h2>
      </header>
      <p className="muted setting-lead">{t("finance.settings.baseLead")}</p>
      {done && <p className="notice-ok">{done}</p>}
      {!open ? (
        <div className="base-current">
          <span className="base-code">{oldBase}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOpen(true); setDone(""); }}>
            {t("finance.settings.changeBase")}
          </button>
        </div>
      ) : (
        <div className="base-change">
          <label className="field">
            <span className="field-label">{t("finance.settings.newBase")}</span>
            <select className="input base-select" value={target} onChange={(e) => pick(e.target.value)}>
              <option value="">—</option>
              {choices.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>

          {target && hasData && (
            <>
              <div className="radio-list">
                <label className="radio-row">
                  <input type="radio" name="base-mode" checked={mode === "convert"} onChange={() => setMode("convert")} />
                  <span>
                    <strong>{t("finance.settings.modeConvert")}</strong>
                    <span className="radio-desc">{t("finance.settings.modeConvertDesc", { to: target })}</span>
                  </span>
                </label>
                <label className="radio-row">
                  <input type="radio" name="base-mode" checked={mode === "reset"} onChange={() => setMode("reset")} />
                  <span>
                    <strong>{t("finance.settings.modeReset")}</strong>
                    <span className="radio-desc">{t("finance.settings.modeResetDesc")}</span>
                  </span>
                </label>
              </div>

              {mode === "convert" ? (
                <div className="fx-line base-rate">
                  <span>{`1 ${oldBase} = `}</span>
                  <input
                    className="input fx-rate-input"
                    inputMode="decimal"
                    aria-label={t("finance.form.rate")}
                    value={rateText}
                    placeholder={rateInfo.loading ? "…" : ""}
                    onChange={(e) => setRateText(e.target.value)}
                  />
                  <span>{target}</span>
                  {rate !== null && rate > 0 && rate < 1 && <span className="muted">{`(${rateLabel(oldBase, target, rate, i18n.resolvedLanguage ?? "en")})`}</span>}
                  {rateInfo.date && <span className="muted">{t("finance.form.rateSource", { date: rateInfo.date })}</span>}
                  {rateInfo.unavailable && <span className="fx-warn">{t("finance.form.rateUnavailable")}</span>}
                </div>
              ) : (
                <label className="radio-row reset-confirm">
                  <input type="checkbox" checked={confirmReset} onChange={(e) => setConfirmReset(e.target.checked)} />
                  <span>{t("finance.settings.resetConfirm")}</span>
                </label>
              )}
            </>
          )}

          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <span className="spacer" />
            <button type="button" className="btn btn-ghost" onClick={close}>{t("form.cancel")}</button>
            <button
              type="button"
              className={`btn ${mode === "reset" && hasData ? "btn-danger" : "btn-primary"}`}
              disabled={!canSubmit}
              onClick={() => void submit()}
            >
              {target ? t("finance.settings.changeTo", { currency: target }) : t("finance.settings.changeBase")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function AddRow({
  placeholder,
  fallbackIcon,
  onAdd,
}: {
  placeholder: string;
  fallbackIcon: string;
  onAdd: (name: string, icon: string) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  // Until the user picks one, the icon follows what they type ("Pets" → 🐾).
  const [pickedIcon, setPickedIcon] = useState<string | null>(null);
  const icon = pickedIcon ?? suggestIcon(name);

  return (
    <form
      className="setting-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        void onAdd(name.trim(), icon).then(() => {
          setName("");
          setPickedIcon(null);
        });
      }}
    >
      <IconPicker value={icon} fallback={fallbackIcon} label={t("finance.settings.icon")} onChange={setPickedIcon} />
      <input className="input" value={name} placeholder={placeholder} onChange={(e) => setName(e.target.value)} />
      <button type="submit" className="btn btn-ghost btn-sm" disabled={!name.trim()}>{t("finance.settings.add")}</button>
    </form>
  );
}

function EditableRow({
  item,
  fallbackIcon,
  onSave,
  onUp,
  onDown,
  onDelete,
  extra,
}: {
  item: { name: string; icon: string };
  fallbackIcon: string;
  onSave: (name: string, icon: string) => Promise<void> | void;
  onUp?: () => void;
  onDown?: () => void;
  onDelete: () => void;
  extra?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [confirming, setConfirming] = useState(false);

  const picker = (
    <IconPicker
      value={item.icon}
      fallback={fallbackIcon}
      label={t("finance.settings.changeIcon", { name: item.name })}
      onChange={(icon) => void onSave(item.name, icon)}
    />
  );

  if (editing) {
    return (
      <form
        className="setting-row is-editing"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void Promise.resolve(onSave(name.trim(), item.icon)).then(() => setEditing(false));
        }}
      >
        {picker}
        <input className="input" value={name} autoFocus aria-label={t("finance.settings.name")} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-primary btn-sm">{t("form.save")}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setName(item.name); }}>
          {t("form.cancel")}
        </button>
      </form>
    );
  }

  return (
    <div className="setting-row">
      {picker}
      <span className="setting-name">{item.name}</span>
      {extra}
      <span className="setting-actions">
        <button
          type="button"
          className="icon-btn"
          onClick={() => { setName(item.name); setEditing(true); }}
          aria-label={t("finance.settings.rename")}
          title={t("finance.settings.rename")}
        >
          ✎
        </button>
        <button type="button" className="icon-btn" disabled={!onUp} onClick={onUp} aria-label={t("finance.settings.moveUp")}>↑</button>
        <button type="button" className="icon-btn" disabled={!onDown} onClick={onDown} aria-label={t("finance.settings.moveDown")}>↓</button>
        {confirming ? (
          <>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => { setConfirming(false); onDelete(); }}>{t("form.delete")}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>{t("form.cancel")}</button>
          </>
        ) : (
          <button type="button" className="icon-btn icon-btn-danger" onClick={() => setConfirming(true)} aria-label={t("form.delete")}>×</button>
        )}
      </span>
    </div>
  );
}
