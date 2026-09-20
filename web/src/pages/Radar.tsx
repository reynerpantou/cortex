import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import type { Problem, ProblemInput, Scope, Source, Stats, Status } from "../lib/types";
import { SCOPES, SOURCES, STATUSES } from "../lib/types";
import ProblemCard from "../components/ProblemCard";
import ProblemForm from "../components/ProblemForm";

type Editing = Problem | "new" | null;

interface Filters {
  scope: Scope[];
  source: Source[];
  status: Status[];
  q: string;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function Radar() {
  const { t } = useTranslation();
  const [problems, setProblems] = useState<Problem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [filters, setFilters] = useState<Filters>({ scope: [], source: [], status: [], q: "" });

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

  const tiles: { key: keyof Stats; label: string }[] = [
    { key: "total", label: t("stats.total") },
    { key: "new_today", label: t("stats.newToday") },
    { key: "indonesia", label: t("stats.indonesia") },
    { key: "row", label: t("stats.row") },
    { key: "ai", label: t("stats.ai") },
    { key: "validated", label: t("stats.validated") },
  ];

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

  const activeCount = filters.scope.length + filters.source.length + filters.status.length;

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

      <div className="tiles">
        {tiles.map((tile) => (
          <div className="tile" key={tile.key}>
            <span className="tile-value">{stats ? stats[tile.key] : "–"}</span>
            <span className="tile-label">{tile.label}</span>
          </div>
        ))}
      </div>

      <input
        className="input search-bar"
        placeholder={t("radar.search")}
        value={filters.q}
        onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
      />

      <div className="filter-strip">
        {SCOPES.map((s) => (
          <button
            key={`scope-${s}`}
            type="button"
            className={`chip-toggle tag-scope-${s} ${filters.scope.includes(s) ? "is-on" : ""}`}
            aria-pressed={filters.scope.includes(s)}
            onClick={() => setFilters((f) => ({ ...f, scope: toggle(f.scope, s) }))}
          >
            {t(`scope.${s}`)}
          </button>
        ))}
        <span className="filter-sep" aria-hidden="true" />
        {SOURCES.map((s) => (
          <button
            key={`source-${s}`}
            type="button"
            className={`chip-toggle tag-source-${s} ${filters.source.includes(s) ? "is-on" : ""}`}
            aria-pressed={filters.source.includes(s)}
            onClick={() => setFilters((f) => ({ ...f, source: toggle(f.source, s) }))}
          >
            {t(`source.${s}`)}
          </button>
        ))}
        <span className="filter-sep" aria-hidden="true" />
        {STATUSES.map((s) => (
          <button
            key={`status-${s}`}
            type="button"
            className={`chip-toggle tag-status-${s} ${filters.status.includes(s) ? "is-on" : ""}`}
            aria-pressed={filters.status.includes(s)}
            onClick={() => setFilters((f) => ({ ...f, status: toggle(f.status, s) }))}
          >
            {t(`status.${s}`)}
          </button>
        ))}
        {activeCount > 0 && (
          <button
            type="button"
            className="chip-toggle chip-clear"
            onClick={() => setFilters((f) => ({ ...f, scope: [], source: [], status: [] }))}
          >
            {t("filter.clear")} ({activeCount})
          </button>
        )}
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
