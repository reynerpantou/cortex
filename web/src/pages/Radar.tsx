import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import type { Problem, ProblemInput, Scope, Source, Stats, Status } from "../lib/types";
import { SCOPES, SOURCES, STATUSES } from "../lib/types";
import { scopeIcon, sourceIcon, statusIcon } from "../lib/icons";
import ProblemCard from "../components/ProblemCard";
import ProblemForm from "../components/ProblemForm";

interface Filters {
  scope: Scope[];
  source: Source[];
  status: Status[];
  q: string;
  sort: "updated" | "created";
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function Radar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [problems, setProblems] = useState<Problem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>({ scope: [], source: [], status: [], q: "", sort: "updated" });

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const [list, s] = await Promise.all([
        api.listProblems({
          scope: filters.scope.join(","),
          source: filters.source.join(","),
          status: filters.status.join(","),
          q: filters.q,
          sort: filters.sort,
        }),
        api.stats(),
      ]);
      setProblems(list);
      setStats(s);
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

  const create = async (input: Partial<ProblemInput> & { title: string }) => {
    const p = await api.createProblem(input);
    setCreating(false);
    navigate(`/radar/${p.id}`);
  };

  const activeCount = filters.scope.length + filters.source.length + filters.status.length;

  return (
    <div className="page">
      <header className="page-head page-head-row">
        <div>
          <h1 className="page-title">{t("radar.title")}</h1>
          <p className="page-lead">{t("radar.lead")}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          {t("radar.add")}
        </button>
      </header>

      {stats && (
        <p className="stat-summary">
          <strong>{stats.total}</strong> {t("stats.total")}
          {" · "}<strong>{stats.new_today}</strong> {t("stats.newToday")}
          {" · "}<strong>{stats.validated}</strong> {t("stats.validated")}
        </p>
      )}

      <div className="toolbar-row">
        <input
          className="input search-bar"
          placeholder={t("radar.search")}
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        />
        <select
          className="input sort-select"
          value={filters.sort}
          onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as Filters["sort"] }))}
        >
          <option value="updated">{t("sort.updated")}</option>
          <option value="created">{t("sort.created")}</option>
        </select>
        <button
          type="button"
          className={`btn btn-ghost filters-toggle ${activeCount > 0 ? "has-active" : ""}`}
          onClick={() => setFiltersOpen((v) => !v)}
        >
          {t("filter.title")}{activeCount > 0 ? ` (${activeCount})` : ""}
        </button>
      </div>

      {filtersOpen && (
        <div className="filter-groups">
          <div className="filter-group">
            <span className="filter-group-label">{t("filter.scope")}</span>
            <div className="filter-group-chips">
              {SCOPES.map((s) => (
                <button
                  key={`scope-${s}`}
                  type="button"
                  className={`chip-toggle ${filters.scope.includes(s) ? "is-on" : ""}`}
                  aria-pressed={filters.scope.includes(s)}
                  onClick={() => setFilters((f) => ({ ...f, scope: toggle(f.scope, s) }))}
                >
                  <span aria-hidden="true">{scopeIcon[s]}</span>
                  {t(`scope.${s}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <span className="filter-group-label">{t("filter.source")}</span>
            <div className="filter-group-chips">
              {SOURCES.map((s) => (
                <button
                  key={`source-${s}`}
                  type="button"
                  className={`chip-toggle ${filters.source.includes(s) ? "is-on" : ""}`}
                  aria-pressed={filters.source.includes(s)}
                  onClick={() => setFilters((f) => ({ ...f, source: toggle(f.source, s) }))}
                >
                  <span aria-hidden="true">{sourceIcon[s]}</span>
                  {t(`source.${s}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <span className="filter-group-label">{t("filter.status")}</span>
            <div className="filter-group-chips">
              {STATUSES.map((s) => (
                <button
                  key={`status-${s}`}
                  type="button"
                  className={`chip-toggle ${filters.status.includes(s) ? "is-on" : ""}`}
                  aria-pressed={filters.status.includes(s)}
                  onClick={() => setFilters((f) => ({ ...f, status: toggle(f.status, s) }))}
                >
                  <span aria-hidden="true">{statusIcon[s]}</span>
                  {t(`status.${s}`)}
                </button>
              ))}
              {activeCount > 0 && (
                <button
                  type="button"
                  className="chip-toggle chip-clear"
                  onClick={() => setFilters((f) => ({ ...f, scope: [], source: [], status: [] }))}
                >
                  {t("filter.clear")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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
              <ProblemCard key={p.id} problem={p} />
            ))}
          </div>
        </>
      )}

      {creating && (
        <div className="overlay" onClick={() => setCreating(false)}>
          <div className="overlay-body" onClick={(e) => e.stopPropagation()}>
            <ProblemForm onSubmit={create} onCancel={() => setCreating(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
