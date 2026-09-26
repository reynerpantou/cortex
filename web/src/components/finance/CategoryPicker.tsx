import { useTranslation } from "react-i18next";
import { childrenOf, topLevel, type FinanceMeta, type Kind } from "../../lib/finance";

interface Props {
  meta: FinanceMeta;
  kind: Kind;
  value: number | null;
  onChange: (id: number | null) => void;
}

// Two-step chip picker: pick a category, then (if it has any) optionally a
// subcategory — the Money Manager flow, without a nested dropdown.
export default function CategoryPicker({ meta, kind, value, onChange }: Props) {
  const { t } = useTranslation();
  const selected = value == null ? null : meta.categories.find((c) => c.id === value) ?? null;
  const topId = selected ? selected.parent_id ?? selected.id : null;
  const subs = topId != null ? childrenOf(meta, topId) : [];

  return (
    <div className="cat-picker">
      <div className="cat-grid">
        {topLevel(meta, kind).map((c) => (
          <button
            key={c.id}
            type="button"
            className={`cat-chip ${topId === c.id ? "is-on" : ""}`}
            aria-pressed={topId === c.id}
            onClick={() => onChange(topId === c.id ? null : c.id)}
          >
            <span className="cat-chip-icon" aria-hidden="true">{c.icon || "•"}</span>
            <span className="cat-chip-name">{c.name}</span>
          </button>
        ))}
      </div>
      {subs.length > 0 && topId != null && (
        <div className="subcat-row">
          <span className="subcat-label">{t("finance.form.subcategory")}</span>
          <button
            type="button"
            className={`chip-toggle chip-sm ${value === topId ? "is-on" : ""}`}
            onClick={() => onChange(topId)}
          >
            {t("finance.form.noSubcategory")}
          </button>
          {subs.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`chip-toggle chip-sm ${value === s.id ? "is-on" : ""}`}
              onClick={() => onChange(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
