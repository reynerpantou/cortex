import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Problem, ProblemInput, Scope, Source, Status } from "../lib/types";
import { SCOPES, SOURCES, STATUSES } from "../lib/types";

interface Props {
  initial?: Problem;
  onSubmit: (input: ProblemInput) => Promise<void> | void;
  onCancel: () => void;
  onDelete?: () => Promise<void> | void;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function ProblemForm({ initial, onSubmit, onCancel, onDelete }: Props) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [scope, setScope] = useState<Scope[]>(initial?.scope ?? ["row"]);
  const [source, setSource] = useState<Source[]>(initial?.source ?? ["other"]);
  const [status, setStatus] = useState<Status>(initial?.status ?? "backlog");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      setError(t("form.title"));
      return;
    }
    if (scope.length === 0 || source.length === 0) {
      setError(t("form.pickAtLeastOne"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSubmit({ title: title.trim(), body: body.trim(), scope, source, status });
    } catch {
      setError(t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-panel">
      <h2 className="form-heading">{initial ? t("form.edit") : t("form.new")}</h2>

      <label className="field">
        <span className="field-label">{t("form.title")}</span>
        <input
          className="input"
          value={title}
          autoFocus
          placeholder={t("form.titlePlaceholder")}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <label className="field">
        <span className="field-label">{t("form.body")}</span>
        <textarea
          className="input textarea"
          value={body}
          rows={4}
          placeholder={t("form.bodyPlaceholder")}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>

      <div className="field">
        <span className="field-label">{t("form.scope")}</span>
        <div className="chip-select">
          {SCOPES.map((s) => (
            <button
              key={s}
              type="button"
              className={`chip-toggle tag-scope-${s} ${scope.includes(s) ? "is-on" : ""}`}
              aria-pressed={scope.includes(s)}
              onClick={() => setScope(toggle(scope, s))}
            >
              {t(`scope.${s}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">{t("form.source")}</span>
        <div className="chip-select">
          {SOURCES.map((s) => (
            <button
              key={s}
              type="button"
              className={`chip-toggle tag-source-${s} ${source.includes(s) ? "is-on" : ""}`}
              aria-pressed={source.includes(s)}
              onClick={() => setSource(toggle(source, s))}
            >
              {t(`source.${s}`)}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span className="field-label">{t("form.status")}</span>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{t(`status.${s}`)}</option>
          ))}
        </select>
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        {onDelete && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={() => {
              if (confirm(t("form.confirmDelete"))) void onDelete();
            }}
          >
            {t("form.delete")}
          </button>
        )}
        <div className="spacer" />
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          {t("form.cancel")}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
          {t("form.save")}
        </button>
      </div>
    </div>
  );
}
