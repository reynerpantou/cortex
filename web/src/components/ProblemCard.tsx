import { Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Problem } from "../lib/types";
import { scopeIcon, sourceIcon, statusIcon } from "../lib/icons";

export default function ProblemCard({ problem }: { problem: Problem }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const metaParts = [
    ...problem.source.map((s) => (
      <span key={`source-${s}`}>{sourceIcon[s]} {t(`source.${s}`)}</span>
    )),
    ...problem.scope.map((s) => (
      <span key={`scope-${s}`}>{scopeIcon[s]} {t(`scope.${s}`)}</span>
    )),
  ];

  return (
    <article className="card" onClick={() => navigate(`/radar/${problem.id}`)}>
      <div className="card-head">
        <h3 className="card-title">
          <span className="card-id">#{problem.id}</span>
          {problem.title}
        </h3>
        <span className={`badge badge-status-${problem.status}`}>
          <span aria-hidden="true">{statusIcon[problem.status]}</span>
          {t(`status.${problem.status}`)}
        </span>
      </div>
      {problem.body && <p className="card-body">{problem.body}</p>}

      <p className="card-meta-line">
        {metaParts.map((part, i) => (
          <Fragment key={i}>
            {i > 0 && " · "}
            {part}
          </Fragment>
        ))}
        {problem.recurrence > 1 && (
          <span className="recurrence"> · {t("problem.seen", { count: problem.recurrence })}</span>
        )}
      </p>
    </article>
  );
}
