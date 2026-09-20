import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import type { Problem, Scope, Source, Status } from "../lib/types";
import { SCOPES, SOURCES, STATUSES } from "../lib/types";
import { scopeIcon, sourceIcon, statusIcon } from "../lib/icons";
import { copyToClipboard, downloadMarkdown, fullExportMarkdown, researchBriefMarkdown } from "../lib/export";

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function ProblemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [problem, setProblem] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [copied, setCopied] = useState(false);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<Scope[]>([]);
  const [source, setSource] = useState<Source[]>([]);
  const [status, setStatus] = useState<Status>("backlog");
  const [aiAssisted, setAiAssisted] = useState(false);
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
      setAiAssisted(p.ai_assisted);
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

  const save = async () => {
    if (!problem) return;
    setSaving(true);
    try {
      const updated = await api.updateProblem(problem.id, {
        title: title.trim(),
        body: body.trim(),
        scope,
        source,
        status,
        ai_assisted: aiAssisted,
        context,
        brainstorming,
        research_brief: researchBrief,
        findings,
        related_ids: relatedIds,
      });
      setProblem(updated);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 1800);
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

  const remove = async () => {
    if (!problem) return;
    if (!confirm(t("form.confirmDelete"))) return;
    await api.deleteProblem(problem.id);
    navigate("/radar");
  };

  // Everything currently on screen, not just the last-saved version — Copy
  // and Export must reflect unsaved edits to every field, not only the
  // workspace text sections.
  const currentSnapshot = (): Problem =>
    problem
      ? {
          ...problem,
          title,
          body,
          scope,
          source,
          ai_assisted: aiAssisted,
          status,
          context,
          brainstorming,
          research_brief: researchBrief,
          findings,
          related_ids: relatedIds,
        }
      : ({} as Problem);

  const doCopyBrief = async () => {
    await copyToClipboard(researchBriefMarkdown(currentSnapshot()));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const doExport = () => {
    if (!problem) return;
    downloadMarkdown(`cortex-problem-${problem.id}.md`, fullExportMarkdown(currentSnapshot()));
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
        <span className="field-label">{t("form.title")}<span className="required-mark">*</span></span>
        <input
          className="input detail-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("form.titlePlaceholder")}
        />
        <textarea
          className="input textarea detail-body-input"
          value={body}
          rows={2}
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
                  onClick={() => setSource(toggle(source, s))}
                >
                  <span aria-hidden="true">{sourceIcon[s]}</span>{t(`source.${s}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <label className="checkbox-field">
          <input type="checkbox" checked={aiAssisted} onChange={(e) => setAiAssisted(e.target.checked)} />
          {"✨ " + t("problem.aiAssisted")}
        </label>
      </header>

      <details className="workspace-section" open={!!context}>
        <summary>{t("detail.context")}</summary>
        <div className="workspace-section-body">
          <textarea
            className="input textarea"
            rows={5}
            value={context}
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
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void removeEvidence(e.id)}>
                {t("form.delete")}
              </button>
            </div>
          ))}
          <div className="evidence-add">
            <input
              className="input"
              placeholder={t("detail.evidenceTextPlaceholder")}
              value={evidenceText}
              onChange={(e) => setEvidenceText(e.target.value)}
            />
            <input
              className="input"
              placeholder={t("detail.evidenceUrlPlaceholder")}
              value={evidenceUrl}
              onChange={(e) => setEvidenceUrl(e.target.value)}
            />
            <button type="button" className="btn btn-ghost" onClick={() => void addEvidence()}>
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
            placeholder={t("detail.brainstormingPlaceholder")}
            onChange={(e) => setBrainstorming(e.target.value)}
          />
          <div className="related-block">
            <span className="field-label">{t("detail.relatedProblems")}</span>
            <div className="related-list">
              {relatedIds.map((rid) => (
                <span key={rid} className="related-chip">
                  <Link to={`/radar/${rid}`}>#{rid} {relatedTitles[rid] ?? "…"}</Link>
                  <button type="button" aria-label={t("form.delete")} onClick={() => setRelatedIds(relatedIds.filter((x) => x !== rid))}>
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
            placeholder={t("detail.findingsPlaceholder")}
            onChange={(e) => setFindings(e.target.value)}
          />
        </div>
      </details>

      <div className="detail-actions">
        <button type="button" className="btn btn-danger" onClick={() => void remove()}>{t("form.delete")}</button>
        <div className="spacer" />
        <button type="button" className="btn btn-ghost" onClick={() => void doCopyBrief()}>
          {copied ? t("detail.copied") : t("detail.copyBrief")}
        </button>
        <button type="button" className="btn btn-ghost" onClick={doExport}>{t("detail.exportMarkdown")}</button>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? t("common.loading") : t("form.save")}
        </button>
      </div>

      {savedToast && (
        <div className="toast toast-success" role="status">
          <span className="toast-check" aria-hidden="true">{"✓"}</span>
          {t("detail.saved")}
        </div>
      )}
    </div>
  );
}
