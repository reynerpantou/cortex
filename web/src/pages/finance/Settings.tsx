import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../lib/api";
import { activeMethods, childrenOf, financeApi, topLevel, type Category, type Kind, type PaymentMethod } from "../../lib/finance";
import { useFinance } from "./FinanceLayout";

export default function Settings() {
  const { t } = useTranslation();
  const { meta, reloadMeta } = useFinance();
  const [kind, setKind] = useState<Kind>("expense");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [newSub, setNewSub] = useState("");
  const [newMethod, setNewMethod] = useState("");
  const [notice, setNotice] = useState("");
  const [baseError, setBaseError] = useState("");

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
                  onSave={(name, icon) => run(() => financeApi.updateCategory(c.id, { name, icon, archived: false }))}
                  onUp={i > 0 ? () => move(tops, i, -1, financeApi.reorderCategories) : undefined}
                  onDown={i < tops.length - 1 ? () => move(tops, i, 1, financeApi.reorderCategories) : undefined}
                  onDelete={() => void removeCategory(c)}
                  extra={
                    <button type="button" className="link-btn" aria-expanded={open} onClick={() => { setExpanded(open ? null : c.id); setNewSub(""); }}>
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
                          hideIcon
                          onSave={(name) => run(() => financeApi.updateCategory(s.id, { name, icon: s.icon, archived: false }))}
                          onUp={si > 0 ? () => move(subs, si, -1, financeApi.reorderCategories) : undefined}
                          onDown={si < subs.length - 1 ? () => move(subs, si, 1, financeApi.reorderCategories) : undefined}
                          onDelete={() => void removeCategory(s)}
                        />
                      </li>
                    ))}
                    <li>
                      <form
                        className="setting-add"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!newSub.trim()) return;
                          void run(() => financeApi.createCategory({ kind, parent_id: c.id, name: newSub.trim(), icon: "" })).then(() => setNewSub(""));
                        }}
                      >
                        <input className="input" value={newSub} placeholder={t("finance.settings.newSubcategory", { name: c.name })} onChange={(e) => setNewSub(e.target.value)} />
                        <button type="submit" className="btn btn-ghost btn-sm" disabled={!newSub.trim()}>{t("finance.settings.add")}</button>
                      </form>
                    </li>
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        <form
          className="setting-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            void run(() => financeApi.createCategory({ kind, parent_id: null, name: newName.trim(), icon: "" })).then(() => setNewName(""));
          }}
        >
          <input className="input" value={newName} placeholder={t("finance.settings.newCategory")} onChange={(e) => setNewName(e.target.value)} />
          <button type="submit" className="btn btn-ghost btn-sm" disabled={!newName.trim()}>{t("finance.settings.add")}</button>
        </form>
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
                onSave={(name, icon) => run(() => financeApi.updatePaymentMethod(p.id, { name, icon, archived: false }))}
                onUp={i > 0 ? () => move(methods, i, -1, financeApi.reorderPaymentMethods) : undefined}
                onDown={i < methods.length - 1 ? () => move(methods, i, 1, financeApi.reorderPaymentMethods) : undefined}
                onDelete={() => void removeMethod(p)}
              />
            </li>
          ))}
        </ul>
        <form
          className="setting-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newMethod.trim()) return;
            void run(() => financeApi.createPaymentMethod({ name: newMethod.trim(), icon: "" })).then(() => setNewMethod(""));
          }}
        >
          <input className="input" value={newMethod} placeholder={t("finance.settings.newMethod")} onChange={(e) => setNewMethod(e.target.value)} />
          <button type="submit" className="btn btn-ghost btn-sm" disabled={!newMethod.trim()}>{t("finance.settings.add")}</button>
        </form>
      </section>

      <section className="stats-card">
        <header className="stats-card-head">
          <h2 className="section-title">{t("finance.settings.baseCurrency")}</h2>
        </header>
        <p className="muted setting-lead">
          {meta.has_transactions ? t("finance.settings.baseLocked") : t("finance.settings.baseLead")}
        </p>
        <select
          className="input base-select"
          value={meta.base_currency}
          disabled={meta.has_transactions}
          onChange={(e) => {
            setBaseError("");
            financeApi
              .updateSettings(e.target.value)
              .then(() => reloadMeta())
              .catch((err) => setBaseError(err instanceof ApiError ? err.message : t("common.error")));
          }}
        >
          {Array.from(new Set([meta.base_currency, ...meta.currencies])).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {baseError && <p className="form-error">{baseError}</p>}
      </section>
    </div>
  );
}

function EditableRow({
  item,
  hideIcon,
  onSave,
  onUp,
  onDown,
  onDelete,
  extra,
}: {
  item: { name: string; icon: string };
  hideIcon?: boolean;
  onSave: (name: string, icon: string) => Promise<void> | void;
  onUp?: () => void;
  onDown?: () => void;
  onDelete: () => void;
  extra?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [icon, setIcon] = useState(item.icon);
  const [confirming, setConfirming] = useState(false);

  if (editing) {
    return (
      <form
        className="setting-row is-editing"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void Promise.resolve(onSave(name.trim(), icon.trim())).then(() => setEditing(false));
        }}
      >
        {!hideIcon && (
          <input className="input setting-icon-input" value={icon} maxLength={8} aria-label={t("finance.settings.icon")} placeholder="🙂" onChange={(e) => setIcon(e.target.value)} />
        )}
        <input className="input" value={name} autoFocus aria-label={t("finance.settings.name")} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-primary btn-sm">{t("form.save")}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setName(item.name); setIcon(item.icon); }}>
          {t("form.cancel")}
        </button>
      </form>
    );
  }

  return (
    <div className="setting-row">
      {!hideIcon && <span className="setting-icon" aria-hidden="true">{item.icon || "•"}</span>}
      <button type="button" className="setting-name" onClick={() => setEditing(true)} title={t("finance.settings.rename")}>
        {item.name}
      </button>
      {extra}
      <span className="setting-actions">
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
