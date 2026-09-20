import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import { api, ApiError } from "../lib/api";

export default function Profile() {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();

  const [username, setUsername] = useState(user?.username ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  if (!user) return null;

  const flashToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 1800);
  };

  const save = async () => {
    setError("");
    const trimmed = username.trim();
    if (!trimmed) {
      setError(t("profile.usernameRequired"));
      return;
    }
    if (newPassword && newPassword !== confirmPassword) {
      setError(t("profile.passwordMismatch"));
      return;
    }
    if (newPassword && !currentPassword) {
      setError(t("profile.currentPasswordRequired"));
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateMe({
        username: trimmed,
        current_password: currentPassword || undefined,
        new_password: newPassword || undefined,
      });
      setUser(updated);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      flashToast(t("profile.saved"));
    } catch (e) {
      if (e instanceof ApiError && e.code === "username_taken") setError(t("profile.usernameTaken"));
      else if (e instanceof ApiError && e.code === "invalid_credentials") setError(t("profile.currentPasswordWrong"));
      else if (e instanceof ApiError && e.code === "validation_error") setError(e.message);
      else setError(t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title">{t("profile.title")}</h1>
        <p className="page-lead">{t("profile.lead")}</p>
      </header>

      <div className="filter-groups">
        <div className="field">
          <span className="field-label">{t("profile.username")}</span>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h2 className="section-title">{t("profile.changePassword")}</h2>
        </div>
        <div className="filter-groups">
          <div className="field">
            <span className="field-label">{t("profile.currentPassword")}</span>
            <input
              className="input"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder={t("profile.currentPasswordPlaceholder")}
            />
          </div>
          <div className="field-row">
            <div className="field">
              <span className="field-label">{t("profile.newPassword")}</span>
              <input
                className="input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="field">
              <span className="field-label">{t("profile.confirmPassword")}</span>
              <input
                className="input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="detail-actions">
        <div className="spacer" />
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? t("common.loading") : t("form.save")}
        </button>
      </div>

      {toast && (
        <div className="toast toast-success" role="status">
          <span className="toast-check" aria-hidden="true">{"✓"}</span>
          {toast}
        </div>
      )}
    </div>
  );
}
