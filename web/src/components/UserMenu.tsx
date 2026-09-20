import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import { languages } from "../i18n";

export default function UserMenu() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [showLanguage, setShowLanguage] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const currentLang = i18n.resolvedLanguage ?? "en";
  const currentLangLabel = languages.find((l) => l.code === currentLang)?.label ?? currentLang;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    setShowLanguage(false);
    setOpen((o) => !o);
  };

  if (!user) return null;
  const initial = user.username.slice(0, 1).toUpperCase();

  return (
    <div className="user-menu" ref={rootRef}>
      <button type="button" className="user-menu-trigger" onClick={toggle} aria-label={user.username}>
        <span className="user-avatar" aria-hidden="true">{initial}</span>
      </button>

      {open && (
        <div className="user-menu-panel">
          {!showLanguage ? (
            <>
              <div className="user-menu-header">
                <span className="user-avatar user-avatar-lg" aria-hidden="true">{initial}</span>
                <span className="user-menu-name">{user.username}</span>
              </div>
              <div className="user-menu-divider" />
              <button type="button" className="user-menu-item" onClick={() => setShowLanguage(true)}>
                <span className="user-menu-item-icon" aria-hidden="true">{"\u{1F310}"}</span>
                <span className="user-menu-item-label">{t("nav.language")}</span>
                <span className="user-menu-item-value">{currentLangLabel}</span>
                <span className="user-menu-chevron" aria-hidden="true">{"›"}</span>
              </button>
              <div className="user-menu-divider" />
              <button
                type="button"
                className="user-menu-item"
                onClick={() => {
                  setOpen(false);
                  void logout();
                }}
              >
                <span className="user-menu-item-icon" aria-hidden="true">{"\u{1F6AA}"}</span>
                <span className="user-menu-item-label">{t("nav.logout")}</span>
              </button>
            </>
          ) : (
            <>
              <button type="button" className="user-menu-back" onClick={() => setShowLanguage(false)}>
                <span aria-hidden="true">{"‹"}</span> {t("nav.language")}
              </button>
              <div className="user-menu-divider" />
              {languages.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  className="user-menu-item"
                  onClick={() => {
                    i18n.changeLanguage(l.code);
                    setOpen(false);
                  }}
                >
                  <span className="user-menu-item-label">{l.label}</span>
                  {currentLang === l.code && <span aria-hidden="true">{"✓"}</span>}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
