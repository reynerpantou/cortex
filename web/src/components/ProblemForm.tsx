import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Problem, ProblemInput, Scope, Source, Status } from "../lib/types";

interface Props {
  initial?: Problem;
  onSubmit: (input: ProblemInput) => Promise<void> | void;
  onCancel: () => void;
  onDelete?: () => Promise<void> | void;
}

const scopes: Scope[] = ["id", "row"];
const sources: Source[] = ["personal", "other", "ai"];
const statuses: Status[] = ["inbox", "validated", "parked", "dropped"];

export default function ProblemForm({ initial, onSubmit, onCancel, onDelete }: Props) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [scope, setScope] = useState<Scope>(initial?.scope ?? "row");
  const [source, setSource] = useState<Source>(initial?.source ?? "other");
  const [status, setStatus] = useState<Status>(initial?.status ?? "inbox");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      setError(t("form.title"));
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

      <div className="field-row">
        <label className="field">
          <span className="field-label">{t("form.scope")}</span>
          <select className="input" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
            {scopes.map((s) => (
              <option key={s} value={s}>{t(`scope.${s}`)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t("form.source")}</span>
          <select className="input" value={source} onChange={(e) => setSource(e.target.value as Source)}>
            {sources.map((s) => (
              <option key={s} value={s}>{t(`source.${s}`)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t("form.status")}</span>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            {statuses.map((s) => (
              <option key={s} value={s}>{t(`status.${s}`)}</option>
            ))}
          </select>
        </label>
      </div>

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
