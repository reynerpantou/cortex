import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import type { Problem, Scope, Stats } from "../lib/types";
import { useAuth } from "../lib/auth";
import ProblemCard from "../components/ProblemCard";

export default function Home() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Problem[]>([]);
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState<Scope>("row");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [s, list] = await Promise.all([api.stats(), api.listProblems()]);
    setStats(s);
    setRecent(list.slice(0, 6));
  };

  useEffect(() => {
    void load();
  }, []);

  const capture = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await api.createProblem({
        title: title.trim(),
        body: "",
        scope,
        source: "other",
        status: "inbox",
      });
      setTitle("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const tiles: { key: keyof Stats; label: string }[] = [
    { key: "total", label: t("stats.total") },
    { key: "new_today", label: t("stats.newToday") },
    { key: "indonesia", label: t("stats.indonesia") },
    { key: "row", label: t("stats.row") },
    { key: "ai", label: t("stats.ai") },
    { key: "validated", label: t("stats.validated") },
  ];

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title">
          {t("home.greeting")}
          {user ? `, ${user.username}` : ""}
        </h1>
        <p className="page-lead">{t("home.lead")}</p>
      </header>

      <div className="capture">
        <input
          className="input capture-input"
          value={title}
          placeholder={t("home.capturePlaceholder")}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void capture()}
        />
        <div className="capture-scope">
          {(["row", "id"] as Scope[]).map((s) => (
            <button
              key={s}
              type="button"
              className={`chip ${scope === s ? "is-active" : ""}`}
              onClick={() => setScope(s)}
            >
              {t(`scope.${s}`)}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void capture()} disabled={busy}>
          {t("home.add")}
        </button>
      </div>

      <div className="tiles">
        {tiles.map((tile) => (
          <div className="tile" key={tile.key}>
            <span className="tile-value">{stats ? stats[tile.key] : "\u2013"}</span>
            <span className="tile-label">{tile.label}</span>
          </div>
        ))}
      </div>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">{t("home.recent")}</h2>
          <button type="button" className="btn btn-ghost" onClick={() => navigate("/radar")}>
            {t("home.viewAll")}
          </button>
        </div>
        {recent.length === 0 ? (
          <p className="empty">{t("home.empty")}</p>
        ) : (
          <div className="grid">
            {recent.map((p) => (
              <ProblemCard key={p.id} problem={p} onEdit={() => navigate("/radar")} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
