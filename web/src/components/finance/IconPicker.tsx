import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ICON_GROUPS } from "../../lib/finance";

interface Props {
  value: string;
  fallback: string;
  onChange: (icon: string) => void;
  label: string;
}

// A tap-to-open emoji grid, so choosing an icon never means hunting for an
// emoji keyboard. A free-text box still accepts any emoji not in the set.
export default function IconPicker({ value, fallback, onChange, label }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (icon: string) => {
    onChange(icon);
    setOpen(false);
    setCustom("");
  };

  return (
    <div className="icon-picker" ref={rootRef}>
      <button
        type="button"
        className={`icon-picker-trigger ${value ? "" : "is-fallback"}`}
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        {value || fallback}
      </button>
      {open && (
        <div className="icon-picker-panel" role="dialog" aria-label={label}>
          {ICON_GROUPS.map((g) => (
            <div key={g.key} className="icon-picker-group">
              <div className="icon-picker-group-label">{t(`finance.icons.${g.key}`)}</div>
              <div className="icon-picker-grid">
                {g.icons.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    className={`icon-picker-opt ${icon === value ? "is-on" : ""}`}
                    onClick={() => pick(icon)}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <form
            className="icon-picker-custom"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) pick(custom.trim());
            }}
          >
            <input
              className="input"
              value={custom}
              maxLength={8}
              placeholder={t("finance.icons.custom")}
              onChange={(e) => setCustom(e.target.value)}
            />
            <button type="submit" className="btn btn-ghost btn-sm" disabled={!custom.trim()}>
              {t("finance.icons.use")}
            </button>
            {value && (
              <button type="button" className="link-btn" onClick={() => pick("")}>
                {t("finance.icons.reset")}
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
