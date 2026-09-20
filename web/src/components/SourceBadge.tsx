import { useTranslation } from "react-i18next";
import type { Source } from "../lib/types";
import { sourceIcon } from "../lib/icons";

// AI stays the deliberate odd one out — filled solid — so AI-surfaced
// problems are never mistaken for something captured yourself.
export default function SourceBadge({ source }: { source: Source }) {
  const { t } = useTranslation();
  return (
    <span className={`badge badge-source-${source}`}>
      <span aria-hidden="true">{sourceIcon[source]}</span>
      {t(`source.${source}`)}
    </span>
  );
}
