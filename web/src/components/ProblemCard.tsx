import { useTranslation } from "react-i18next";
import type { Problem } from "../lib/types";
import SourceBadge from "./SourceBadge";

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
        {problem.recurrence > 1 && (
          <span className="recurrence" title={t("problem.seen", { count: problem.recurrence })}>
            {t("problem.seen", { count: problem.recurrence })}
          </span>
        )}
      </div>
      {problem.body && <p className="card-body">{problem.body}</p>}
      <div className="card-tags">
        <SourceBadge source={problem.source} />
        <span className="badge badge-scope">{t(`scope.${problem.scope}`)}</span>
        <span className={`badge badge-status status-${problem.status}`}>
          {t(`status.${problem.status}`)}
        </span>
      </div>
    </article>
  );
}
