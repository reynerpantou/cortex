import { useTranslation } from "react-i18next";
import { currentMonth, monthLabel, shiftMonth } from "../../lib/finance";

interface Props {
  month: string;
  onChange: (month: string) => void;
  mode?: "month" | "year";
}

export default function MonthSwitcher({ month, onChange, mode = "month" }: Props) {
  const { t, i18n } = useTranslation();
  const step = mode === "year" ? 12 : 1;
  const label = mode === "year" ? month.slice(0, 4) : monthLabel(month, i18n.resolvedLanguage ?? "en");
  const isCurrent = mode === "year" ? month.slice(0, 4) === currentMonth().slice(0, 4) : month === currentMonth();

  return (
    <div className="month-switcher">
      <button type="button" className="month-switcher-btn" aria-label={t("finance.prev")} onClick={() => onChange(shiftMonth(month, -step))}>
        {"‹"}
      </button>
      <span className="month-switcher-label">{label}</span>
      <button type="button" className="month-switcher-btn" aria-label={t("finance.next")} onClick={() => onChange(shiftMonth(month, step))}>
        {"›"}
      </button>
      {!isCurrent && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(currentMonth())}>
          {t("finance.today")}
        </button>
      )}
    </div>
  );
}
