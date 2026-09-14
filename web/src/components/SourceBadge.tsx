import { useTranslation } from "react-i18next";
import type { Source } from "../lib/types";

// The AI badge is deliberately the odd one out — filled, with a marker dot — so
// AI-surfaced problems are never mistaken for something you captured yourself.
export default function SourceBadge({ source }: { source: Source }) {
  const { t } = useTranslation();
  return (
    <span className={`badge badge-src badge-${source}`}>
      {source === "ai" && <span className="badge-dot" aria-hidden="true" />}
      {t(`source.${source}`)}
    </span>
  );
}
