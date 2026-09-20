import { useTranslation } from "react-i18next";
import type { Problem } from "../lib/types";
import SourceBadge from "./SourceBadge";
import { scopeIcon, statusIcon } from "../lib/icons";

interface Props {
  problem: Problem;
  onEdit: (p: Problem) => void;
}

export default function ProblemCard({ problem, onEdit }: Props) {
  const { t } = useTranslation();
  return (
    <article className="card" onClick={() => onEdit(problem)}>
      <div className="card-head">
        <h3 className="card-title">{problem.title}</h3>
      </div>
      {problem.body && <p className="card-body">{problem.body}</p>}

      <div className="card-meta">
        <span className={`badge badge-status-${problem.status}`}>
          <span aria-hidden="true">{statusIcon[problem.status]}</span>
          {t(`status.${problem.status}`)}
        </span>
        {problem.recurrence > 1 && (
          <span className="recurrence" title={t("problem.seen", { count: problem.recurrence })}>
            {t("problem.seen", { count: problem.recurrence })}
          </span>
        )}
      </div>

      <div className="card-tag-group">
        <span className="card-tag-label">{t("tagGroup.source")}</span>
        {problem.source.map((s) => (
          <SourceBadge key={s} source={s} />
        ))}
      </div>
      <div className="card-tag-group">
        <span className="card-tag-label">{t("tagGroup.scope")}</span>
        {problem.scope.map((s) => (
          <span key={s} className={`badge badge-scope-${s}`}>
            <span aria-hidden="true">{scopeIcon[s]}</span>
            {t(`scope.${s}`)}
          </span>
        ))}
      </div>
    </article>
  );
}
