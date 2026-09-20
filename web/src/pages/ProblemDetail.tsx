import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import type { Problem, Scope, Source, Status } from "../lib/types";
import { SCOPES, SOURCES, STATUSES } from "../lib/types";
import { scopeIcon, sourceIcon, statusIcon } from "../lib/icons";
import { copyToClipboard, downloadMarkdown, fullExportMarkdown } from "../lib/export";

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function ProblemDetail() {
  const { id } = useParams();
  const { t } = useTranslation();

  const [problem, setProblem] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState(false);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<Scope[]>([]);
  const [source, setSource] = useState<Source[]>([]);
  const [status, setStatus] = useState<Status>("backlog");
  const [context, setContext] = useState("");
  const [brainstorming, setBrainstorming] = useState("");
  const [researchBrief, setResearchBrief] = useState("");
  const [findings, setFindings] = useState("");

  const [relatedIds, setRelatedIds] = useState<number[]>([]);
  const [relatedTitles, setRelatedTitles] = useState<Record<number, string>>({});
  const [relatedQuery, setRelatedQuery] = useState("");
  const [relatedSuggestions, setRelatedSuggestions] = useState<Problem[]>([]);
  const [relatedSearched, setRelatedSearched] = useState(false);

  const [evidenceText, setEvidenceText] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");

  // Archived problems are read-only until the status is changed away from
  // "archived" — the status control itself is the only way to unlock them.
  const readOnly = status === "archived";

  const flashToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 1800);
  };

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(false);
    try {
      const p = await api.getProblem(Number(id));
      setProblem(p);
      setTitle(p.title);
      setBody(p.body);
      setScope(p.scope);
      setSource(p.source);
      setStatus(p.status);
      setContext(p.context ?? "");
      setBrainstorming(p.brainstorming ?? "");
      setResearchBrief(p.research_brief ?? "");
      setFindings(p.findings ?? "");
      const relIds = p.related_ids ?? [];
      setRelatedIds(relIds);
      // Related chips must show what they point to, not just a bare number —
      // fetch each linked problem's title once.
      const titles: Record<number, string> = {};
      await Promise.all(
        relIds.map(async (rid) => {
          try {
            titles[rid] = (await api.getProblem(rid)).title;
          } catch {
            titles[rid] = t("detail.relatedMissing");
          }
        })
      );
      setRelatedTitles(titles);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Search-as-you-type for linking a related problem: matches by title/body
  // text, and additionally verifies an exact numeric id directly, so a valid
  // id always resolves even if that number never appears in any title.
  useEffect(() => {
    const q = relatedQuery.trim();
    if (!q) {
      setRelatedSuggestions([]);
      setRelatedSearched(false);
      return;
    }
    setRelatedSearched(false);
    const timer = setTimeout(async () => {
      const results: Problem[] = [];
      const asId = /^#?\d+$/.test(q) ? parseInt(q.replace("#", ""), 10) : null;
      if (asId) {
        try {
          results.push(await api.getProblem(asId));
        } catch {
          // not a real id — fine, text search below still runs
        }
      }
      try {
        for (const m of await api.listProblems({ q })) {
          if (!results.some((r) => r.id === m.id)) results.push(m);
        }
      } catch {
        // ignore search failures, just show whatever we have
      }
      setRelatedSuggestions(
        results.filter((r) => r.id !== problem?.id && !relatedIds.includes(r.id)).slice(0, 6)
      );
      setRelatedSearched(true);
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relatedQuery]);

  const persist = async (overrides: Partial<{ status: Status }> = {}) => {
    if (!problem) return null;
    const updated = await api.updateProblem(problem.id, {
      title: title.trim(),
      body: body.trim(),
      scope,
      source,
      status,
      context,
      brainstorming,
      research_brief: researchBrief,
      findings,
      related_ids: relatedIds,
      ...overrides,
    });
    setProblem(updated);
    setStatus(updated.status);
    return updated;
  };

  const save = async () => {
    setSaving(true);
    try {
      if (await persist()) flashToast(t("detail.saved"));
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    setSaving(true);
    try {
      if (await persist({ status: "archived" })) flashToast(t("detail.archived"));
    } finally {
      setSaving(false);
    }
  };

  const addRelated = (p: Problem) => {
    setRelatedIds([...relatedIds, p.id]);
    setRelatedTitles((prev) => ({ ...prev, [p.id]: p.title }));
    setRelatedQuery("");
    setRelatedSuggestions([]);
  };

  const addEvidence = async () => {
    if (!problem || (!evidenceText.trim() && !evidenceUrl.trim())) return;
    const e = await api.addEvidence(problem.id, {
      text: evidenceText.trim(),
      url: evidenceUrl.trim() || undefined,
    });
    setProblem({ ...problem, evidence: [e, ...(problem.evidence ?? [])] });
    setEvidenceText("");
    setEvidenceUrl("");
  };

  const removeEvidence = async (eid: number) => {
    if (!problem) return;
    await api.deleteEvidence(problem.id, eid);
    setProblem({ ...problem, evidence: (problem.evidence ?? []).filter((e) => e.id !== eid) });
  };

  // Everything currently on screen, not just the last-saved version — Copy
  // and Export must reflect unsaved edits to every field, not only the
  // workspace text sections, and must always match each other exactly.
  const currentSnapshot = (): Problem =>
    problem
      ? {
          ...problem,
          title,
          body,
          scope,
          source,
          status,
          context,
          brainstorming,
          research_brief: researchBrief,
          findings,
          related_ids: relatedIds,
        }
      : ({} as Problem);

  const doCopy = async () => {
    await copyToClipboard(fullExportMarkdown(currentSnapshot(), relatedTitles));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const doExport = () => {
    if (!problem) return;
    downloadMarkdown(`cortex-problem-${problem.id}.md`, fullExportMarkdown(currentSnapshot(), relatedTitles));
  };

  if (loading) return <div className="page"><p className="muted">{t("common.loading")}</p></div>;
  if (loadError || !problem) {
    return (
      <div className="page">
        <div className="center">
          <p className="muted">{t("common.error")}</p>
          <button className="btn btn-ghost" onClick={() => void load()}>{t("common.retry")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page detail-page">
      <Link to="/radar" className="back-link">{"← "}{t("detail.back")}</Link>

      <header className="detail-head">
        <div className="detail-head-top">
          <span className="card-id">#{problem.id}</span>
          <select
            className={`badge-select badge-status-${status}`}
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{statusIcon[s]} {t(`status.${s}`)}</option>
            ))}
          </select>
        </div>
        {readOnly && <p className="archived-hint">{t("detail.archivedHint")}</p>}
        <span className="field-label">{t("form.title")}<span className="required-mark">*</span></span>
        <input
          className="input detail-title-input"
          value={title}
          disabled={readOnly}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("form.titlePlaceholder")}
        />
        <textarea
          className="input textarea detail-body-input"
          value={body}
          rows={2}
          disabled={readOnly}
          placeholder={t("form.bodyPlaceholder")}
          onChange={(e) => setBody(e.target.value)}
        />

        <div className="field-row">
          <div className="field">
            <span className="field-label">{t("form.scope")}</span>
            <div className="chip-select">
              {SCOPES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`chip-toggle ${scope.includes(s) ? "is-on" : ""}`}
                  disabled={readOnly}
                  onClick={() => setScope(toggle(scope, s))}
                >
                  <span aria-hidden="true">{scopeIcon[s]}</span>{t(`scope.${s}`)}
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
                  disabled={readOnly}
                  onClick={() => setSource(toggle(source, s))}
                >
                  <span aria-hidden="true">{sourceIcon[s]}</span>{t(`source.${s}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <details className="workspace-section" open={!!context}>
        <summary>{t("detail.context")}</summary>
        <div className="workspace-section-body">
          <textarea
            className="input textarea"
            rows={5}
            value={context}
            disabled={readOnly}
            placeholder={t("detail.contextPlaceholder")}
            onChange={(e) => setContext(e.target.value)}
          />
        </div>
      </details>

      <details className="workspace-section" open={(problem.evidence?.length ?? 0) > 0}>
        <summary>{t("detail.evidence")}{problem.evidence?.length ? ` (${problem.evidence.length})` : ""}</summary>
        <div className="workspace-section-body">
          {(problem.evidence ?? []).map((e) => (
            <div key={e.id} className="evidence-item">
              <div className="evidence-item-body">
                {e.text && <p>{e.text}</p>}
                {e.url && <a href={e.url} target="_blank" rel="noreferrer">{e.url}</a>}
                <span className="evidence-date">{e.noted_at.slice(0, 10)}</span>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" disabled={readOnly} onClick={() => void removeEvidence(e.id)}>
                {t("form.delete")}
              </button>
            </div>
          ))}
          <div className="evidence-add">
            <input
              className="input"
              placeholder={t("detail.evidenceTextPlaceholder")}
              value={evidenceText}
              disabled={readOnly}
              onChange={(e) => setEvidenceText(e.target.value)}
            />
            <input
              className="input"
              placeholder={t("detail.evidenceUrlPlaceholder")}
              value={evidenceUrl}
              disabled={readOnly}
              onChange={(e) => setEvidenceUrl(e.target.value)}
            />
            <button type="button" className="btn btn-ghost" disabled={readOnly} onClick={() => void addEvidence()}>
              {t("detail.addEvidence")}
            </button>
          </div>
        </div>
      </details>

      <details className="workspace-section" open={!!brainstorming || relatedIds.length > 0}>
        <summary>{t("detail.brainstorming")}</summary>
        <div className="workspace-section-body">
          <textarea
            className="input textarea"
            rows={5}
            value={brainstorming}
            disabled={readOnly}
            placeholder={t("detail.brainstormingPlaceholder")}
            onChange={(e) => setBrainstorming(e.target.value)}
          />
          <div className="related-block">
            <span className="field-label">{t("detail.relatedProblems")}</span>
            <div className="related-list">
              {relatedIds.map((rid) => (
                <span key={rid} className="related-chip">
                  <Link to={`/radar/${rid}`}>#{rid} {relatedTitles[rid] ?? "…"}</Link>
                  <button type="button" aria-label={t("form.delete")} disabled={readOnly} onClick={() => setRelatedIds(relatedIds.filter((x) => x !== rid))}>
                    {"×"}
                  </button>
                </span>
              ))}
            </div>
            <div className="related-add">
              <div className="related-search">
                <input
                  className="input"
                  placeholder={t("detail.relatedPlaceholder")}
                  value={relatedQuery}
                  disabled={readOnly}
                  onChange={(e) => setRelatedQuery(e.target.value)}
                />
                {relatedQuery.trim() && (
                  <div className="related-suggestions">
                    {relatedSuggestions.length > 0 ? (
                      relatedSuggestions.map((s) => (
                        <button key={s.id} type="button" className="related-suggestion" onClick={() => addRelated(s)}>
                          <span className="related-suggestion-id">#{s.id}</span>{s.title}
                        </button>
                      ))
                    ) : relatedSearched ? (
                      <div className="related-empty-hint">{t("detail.relatedNoMatch")}</div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </details>

      <details className="workspace-section" open={!!researchBrief}>
        <summary>{t("detail.researchBrief")}</summary>
        <div className="workspace-section-body">
          <textarea
            className="input textarea"
            rows={5}
            value={researchBrief}
            disabled={readOnly}
            placeholder={t("detail.researchBriefPlaceholder")}
            onChange={(e) => setResearchBrief(e.target.value)}
          />
        </div>
      </details>

      <details className="workspace-section" open={!!findings}>
        <summary>{t("detail.findings")}</summary>
        <div className="workspace-section-body">
          <textarea
            className="input textarea"
            rows={5}
            value={findings}
            disabled={readOnly}
            placeholder={t("detail.findingsPlaceholder")}
            onChange={(e) => setFindings(e.target.value)}
          />
        </div>
      </details>

      <div className="detail-actions">
        {!readOnly ? (
          <button type="button" className="btn btn-danger" disabled={saving} onClick={() => void archive()}>
            {t("detail.archive")}
          </button>
        ) : (
          <span className="muted archived-hint-inline">{t("detail.archivedHint")}</span>
        )}
        <div className="spacer" />
        <button type="button" className="btn btn-ghost" onClick={() => void doCopy()}>
          {copied ? t("detail.copied") : t("detail.copyBrief")}
        </button>
        <button type="button" className="btn btn-ghost" onClick={doExport}>{t("detail.exportMarkdown")}</button>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? t("common.loading") : t("form.save")}
        </button>
      </div>

      {toast && (
        <div className="toast toast-success" role="status">
          <span className="toast-check" aria-hidden="true">{"✓"}</span>
          {toast}
        </div>
      )}
    </div>
  );
}
