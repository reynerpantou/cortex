import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import type { AiSummary, Problem, Scope, Source, Status } from "../lib/types";
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

  // Each section's open/closed state is set once when the problem loads and
  // never recomputed from the live text afterward — otherwise a <details
  // open={!!context}> snaps shut mid-edit the instant you backspace a field
  // back to empty, which is exactly the bug this was.
  const [contextOpen, setContextOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [brainstormingOpen, setBrainstormingOpen] = useState(false);
  const [researchBriefOpen, setResearchBriefOpen] = useState(false);
  const [findingsOpen, setFindingsOpen] = useState(false);

  const [relatedIds, setRelatedIds] = useState<number[]>([]);
  const [relatedTitles, setRelatedTitles] = useState<Record<number, string>>({});
  const [relatedQuery, setRelatedQuery] = useState("");
  const [relatedSuggestions, setRelatedSuggestions] = useState<Problem[]>([]);
  const [relatedSearched, setRelatedSearched] = useState(false);

  const [evidenceText, setEvidenceText] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");

  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [archiveReasonDraft, setArchiveReasonDraft] = useState("");

  const [aiSummary, setAiSummary] = useState<AiSummary | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

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
      setContextOpen(!!p.context);
      setEvidenceOpen((p.evidence?.length ?? 0) > 0);
      setBrainstormingOpen(!!p.brainstorming || relIds.length > 0);
      setResearchBriefOpen(!!p.research_brief);
      setFindingsOpen(!!p.findings);
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

  // archive_reason is only ever set by confirmArchive below, at the moment
  // of archiving — a plain Save (or unarchiving via the status dropdown)
  // always clears it, so a stale reason never lingers past the archived
  // state it was given for.
  const persist = async (overrides: Partial<{ status: Status; archive_reason: string }> = {}) => {
    if (!problem) return null;
    const resolvedStatus = overrides.status ?? status;
    const updated = await api.updateProblem(problem.id, {
      title: title.trim(),
      body: body.trim(),
      scope,
      source,
      context,
      brainstorming,
      research_brief: researchBrief,
      findings,
      related_ids: relatedIds,
      status: resolvedStatus,
      archive_reason: resolvedStatus === "archived" ? (overrides.archive_reason ?? problem.archive_reason ?? "") : "",
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

  const openArchiveModal = () => {
    setArchiveReasonDraft("");
    setArchiveModalOpen(true);
  };

  const confirmArchive = async () => {
    setSaving(true);
    try {
      if (await persist({ status: "archived", archive_reason: archiveReasonDraft.trim() })) {
        setArchiveModalOpen(false);
        flashToast(t("detail.archived"));
      }
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

  const askAI = async () => {
    if (!problem) return;
    setAiLoading(true);
    setAiError("");
    try {
      const result = await api.aiSummary(problem.id, {
        title: title.trim(),
        body: body.trim(),
        scope,
        source,
        context,
        brainstorming,
        research_brief: researchBrief,
        findings,
      });
      setAiSummary(result);
    } catch {
      setAiError(t("common.error"));
    } finally {
      setAiLoading(false);
    }
  };

  // The guiding sub-questions used to live only in the placeholder, which
  // vanishes the moment you type a single character — losing the prompts
  // for whatever you haven't answered yet. Seeding real markdown headings
  // into the field on first focus (only while it's still empty) keeps them
  // visible as you fill in the blanks, without turning this back into rigid
  // separate fields.
  const seedOnFocus = (value: string, setValue: (v: string) => void, scaffoldKey: string) => () => {
    if (!value.trim()) setValue(t(scaffoldKey));
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
            {/* Archiving always goes through the Archive button + reason modal below —
                offering it here would let it happen with no reason captured. It's only
                included when already archived, so the dropdown still shows the current
                value and can be used to unarchive. */}
            {STATUSES.filter((s) => s !== "archived" || status === "archived").map((s) => (
              <option key={s} value={s}>{statusIcon[s]} {t(`status.${s}`)}</option>
            ))}
          </select>
        </div>
        {readOnly && (
          <p className="archived-hint">
            {t("detail.archivedHint")}
            {problem.archive_reason ? ` — "${problem.archive_reason}"` : ""}
          </p>
        )}
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

      <div className="ai-summary-block">
        {!aiSummary ? (
          <button type="button" className="btn ai-ask-btn" disabled={aiLoading} onClick={() => void askAI()}>
            <span aria-hidden="true">{"✨"}</span>
            {aiLoading ? t("detail.aiAsking") : t("detail.aiAskButton")}
          </button>
        ) : (
          <div className="ai-summary-card">
            <div className="ai-summary-header">
              <span className="ai-summary-title"><span aria-hidden="true">{"✨"}</span> {t("detail.aiSummaryTitle")}</span>
              <div className="ai-summary-header-actions">
                <button type="button" className="btn btn-ghost btn-sm" disabled={aiLoading} onClick={() => void askAI()}>
                  {aiLoading ? t("detail.aiAsking") : t("detail.aiRefresh")}
                </button>
                <button
                  type="button"
                  className="ai-summary-dismiss"
                  aria-label={t("form.delete")}
                  onClick={() => setAiSummary(null)}
                >
                  {"×"}
                </button>
              </div>
            </div>
            {aiSummary.mock && <p className="ai-summary-mock-note">{t("detail.aiMockNote")}</p>}
            <p className="ai-summary-text">{aiSummary.summary}</p>

            <div className="ai-summary-section">
              <h4>{t("detail.aiClarify")}</h4>
              <ul>{aiSummary.clarify.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
            <div className="ai-summary-section">
              <h4>{t("detail.aiSolutions")}</h4>
              <ul>{aiSummary.solutions.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
            <div className="ai-summary-section">
              <h4>{t("detail.aiNextStep")}</h4>
              <p>{aiSummary.next_step}</p>
            </div>
            {aiSummary.obstacle && (
              <div className="ai-summary-section">
                <h4>{t("detail.aiObstacle")}</h4>
                <p>{aiSummary.obstacle}</p>
              </div>
            )}
          </div>
        )}
        {aiError && <p className="form-error">{aiError}</p>}
      </div>

      <details className="workspace-section" open={contextOpen}>
        <summary>{t("detail.context")}</summary>
        <div className="workspace-section-body">
          <textarea
            className="input textarea"
            rows={5}
            value={context}
            disabled={readOnly}
            placeholder={t("detail.contextPlaceholder")}
            onFocus={seedOnFocus(context, setContext, "detail.contextScaffold")}
            onChange={(e) => setContext(e.target.value)}
          />
        </div>
      </details>

      <details className="workspace-section" open={evidenceOpen}>
        <summary>{t("detail.evidence")}{problem.evidence?.length ? ` (${problem.evidence.length})` : ""}</summary>
        <div className="workspace-section-body">
          {(problem.evidence ?? []).map((e) => (
            <div key={e.id} className="evidence-item">
              <div className="evidence-item-body">
                {e.text && <p>{e.text}</p>}
                {e.url && (/^https?:\/\//i.test(e.url)
                  ? <a href={e.url} target="_blank" rel="noopener noreferrer">{e.url}</a>
                  : <span>{e.url}</span>)}
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

      <details className="workspace-section" open={brainstormingOpen}>
        <summary>{t("detail.brainstorming")}</summary>
        <div className="workspace-section-body">
          <textarea
            className="input textarea"
            rows={5}
            value={brainstorming}
            disabled={readOnly}
            placeholder={t("detail.brainstormingPlaceholder")}
            onFocus={seedOnFocus(brainstorming, setBrainstorming, "detail.brainstormingScaffold")}
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

      <details className="workspace-section" open={researchBriefOpen}>
        <summary>{t("detail.researchBrief")}</summary>
        <div className="workspace-section-body">
          <textarea
            className="input textarea"
            rows={5}
            value={researchBrief}
            disabled={readOnly}
            placeholder={t("detail.researchBriefPlaceholder")}
            onFocus={seedOnFocus(researchBrief, setResearchBrief, "detail.researchBriefScaffold")}
            onChange={(e) => setResearchBrief(e.target.value)}
          />
        </div>
      </details>

      <details className="workspace-section" open={findingsOpen}>
        <summary>{t("detail.findings")}</summary>
        <div className="workspace-section-body">
          <textarea
            className="input textarea"
            rows={5}
            value={findings}
            disabled={readOnly}
            placeholder={t("detail.findingsPlaceholder")}
            onFocus={seedOnFocus(findings, setFindings, "detail.findingsScaffold")}
            onChange={(e) => setFindings(e.target.value)}
          />
        </div>
      </details>

      <div className="detail-actions">
        {!readOnly ? (
          <button type="button" className="btn btn-danger" disabled={saving} onClick={openArchiveModal}>
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

      {archiveModalOpen && (
        <div className="overlay" onClick={() => setArchiveModalOpen(false)}>
          <div className="overlay-body" onClick={(e) => e.stopPropagation()}>
            <div className="form-panel">
              <h2 className="form-heading">{t("detail.archiveConfirmTitle")}</h2>
              <div className="field">
                <span className="field-label">{t("detail.archiveReasonLabel")}</span>
                <textarea
                  className="input textarea"
                  rows={3}
                  autoFocus
                  value={archiveReasonDraft}
                  placeholder={t("detail.archiveReasonPlaceholder")}
                  onChange={(e) => setArchiveReasonDraft(e.target.value)}
                />
              </div>
              <div className="form-actions">
                <div className="spacer" />
                <button type="button" className="btn btn-ghost" onClick={() => setArchiveModalOpen(false)}>
                  {t("form.cancel")}
                </button>
                <button type="button" className="btn btn-danger" disabled={saving} onClick={() => void confirmArchive()}>
                  {t("detail.archive")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast toast-success" role="status">
          <span className="toast-check" aria-hidden="true">{"✓"}</span>
          {toast}
        </div>
      )}
    </div>
  );
}
