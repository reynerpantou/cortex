import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProblemInput, Scope, Source, Status } from "../lib/types";
import { SCOPES, SOURCES, STATUSES } from "../lib/types";
import { scopeIcon, sourceIcon, statusIcon } from "../lib/icons";

interface Props {
  onSubmit: (input: Partial<ProblemInput> & { title: string }) => Promise<void> | void;
  onCancel: () => void;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

// Quick capture: only a title is required. Everything else is collapsed
// behind "More details" so jotting a problem down never feels like filling
// out a form — deeper thinking happens on the problem's own page afterward.
export default function ProblemForm({ onSubmit, onCancel }: Props) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<Scope[]>([]);
  const [source, setSource] = useState<Source[]>([]);
  const [status, setStatus] = useState<Status>("backlog");
  const [showMore, setShowMore] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      setError(t("form.titleRequired"));
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
      <h2 className="form-heading">{t("form.new")}</h2>

      <label className="field">
        <span className="field-label">{t("form.title")}<span className="required-mark">*</span></span>
        <input
          className="input"
          value={title}
          autoFocus
          placeholder={t("form.titlePlaceholder")}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !showMore && void submit()}
        />
      </label>

      {!showMore ? (
        <button type="button" className="disclosure-toggle" onClick={() => setShowMore(true)}>
          {t("form.moreDetails")}
        </button>
      ) : (
        <>
          <label className="field">
            <span className="field-label">{t("form.body")}</span>
            <textarea
              className="input textarea"
              value={body}
              rows={3}
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
                  className={`chip-toggle ${scope.includes(s) ? "is-on" : ""}`}
                  aria-pressed={scope.includes(s)}
                  onClick={() => setScope(toggle(scope, s))}
                >
                  <span aria-hidden="true">{scopeIcon[s]}</span>
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
                  className={`chip-toggle ${source.includes(s) ? "is-on" : ""}`}
                  aria-pressed={source.includes(s)}
                  onClick={() => setSource(toggle(source, s))}
                >
                  <span aria-hidden="true">{sourceIcon[s]}</span>
                  {t(`source.${s}`)}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span className="field-label">{t("form.status")}</span>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{statusIcon[s]} {t(`status.${s}`)}</option>
              ))}
            </select>
          </label>
        </>
      )}

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <div className="spacer" />
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          {t("form.cancel")}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
          {t("form.addProblem")}
        </button>
      </div>
    </div>
  );
}
