import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import type { Problem, ProblemInput } from "../lib/types";
import ProblemCard from "../components/ProblemCard";
import ProblemForm from "../components/ProblemForm";

type Editing = Problem | "new" | null;

export default function Radar() {
  const { t } = useTranslation();
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [filters, setFilters] = useState({ scope: "", source: "", status: "", q: "" });

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      setProblems(await api.listProblems(filters));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const id = setTimeout(() => void load(), filters.q ? 250 : 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const save = async (input: ProblemInput) => {
    if (editing && editing !== "new") {
      await api.updateProblem(editing.id, input);
    } else {
      await api.createProblem(input);
    }
    setEditing(null);
    await load();
  };

  const remove = async () => {
    if (editing && editing !== "new") {
      await api.deleteProblem(editing.id);
      setEditing(null);
      await load();
    }
  };

  const setFilter = (k: keyof typeof filters, v: string) =>
    setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div className="page">
      <header className="page-head page-head-row">
        <div>
          <h1 className="page-title">{t("radar.title")}</h1>
          <p className="page-lead">{t("radar.lead")}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
          {t("radar.add")}
        </button>
      </header>

      <div className="toolbar">
        <input
          className="input"
          placeholder={t("radar.search")}
          value={filters.q}
          onChange={(e) => setFilter("q", e.target.value)}
        />
        <select className="input" value={filters.scope} onChange={(e) => setFilter("scope", e.target.value)}>
          <option value="">{t("filter.allScopes")}</option>
          <option value="id">{t("scope.id")}</option>
          <option value="row">{t("scope.row")}</option>
        </select>
        <select className="input" value={filters.source} onChange={(e) => setFilter("source", e.target.value)}>
          <option value="">{t("filter.allSources")}</option>
          <option value="personal">{t("source.personal")}</option>
          <option value="other">{t("source.other")}</option>
          <option value="ai">{t("source.ai")}</option>
        </select>
        <select className="input" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">{t("filter.allStatuses")}</option>
          <option value="inbox">{t("status.inbox")}</option>
          <option value="validated">{t("status.validated")}</option>
          <option value="parked">{t("status.parked")}</option>
          <option value="dropped">{t("status.dropped")}</option>
        </select>
      </div>

      {loading ? (
        <p className="muted">{t("common.loading")}</p>
      ) : error ? (
        <div className="center">
          <p className="muted">{t("common.error")}</p>
          <button className="btn btn-ghost" onClick={() => void load()}>{t("common.retry")}</button>
        </div>
      ) : problems.length === 0 ? (
        <p className="empty">{t("radar.empty")}</p>
      ) : (
        <>
          <p className="count">{t("radar.count", { count: problems.length })}</p>
          <div className="grid">
            {problems.map((p) => (
              <ProblemCard key={p.id} problem={p} onEdit={setEditing} />
            ))}
          </div>
        </>
      )}

      {editing && (
        <div className="overlay" onClick={() => setEditing(null)}>
          <div className="overlay-body" onClick={(e) => e.stopPropagation()}>
            <ProblemForm
              initial={editing === "new" ? undefined : editing}
              onSubmit={save}
              onCancel={() => setEditing(null)}
              onDelete={editing === "new" ? undefined : remove}
            />
          </div>
        </div>
      )}
    </div>
  );
}
