import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import { api, ApiError } from "../lib/api";

export default function Profile() {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();

  const [username, setUsername] = useState(user?.username ?? "");
  const [nameEn, setNameEn] = useState(user?.display_name_en ?? "");
  const [nameId, setNameId] = useState(user?.display_name_id ?? "");
  const [nameZh, setNameZh] = useState(user?.display_name_zh ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileToast, setProfileToast] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordToast, setPasswordToast] = useState("");

  if (!user) return null;

  const passwordsMismatch = newPassword.length > 0 && confirmPassword.length > 0 && newPassword !== confirmPassword;

  const flash = (setter: (v: string) => void, msg: string) => {
    setter(msg);
    setTimeout(() => setter(""), 1800);
  };

  // Independent from the password form below — saving your name never
  // touches your password, and there's nothing to fill in or worry about
  // here if all you want is to rename yourself.
  const saveProfile = async () => {
    setProfileError("");
    const trimmed = username.trim();
    if (!trimmed) {
      setProfileError(t("profile.usernameRequired"));
      return;
    }
    setSavingProfile(true);
    try {
      const updated = await api.updateMe({
        username: trimmed,
        display_name_en: nameEn.trim(),
        display_name_id: nameId.trim(),
        display_name_zh: nameZh.trim(),
      });
      setUser(updated);
      flash(setProfileToast, t("profile.saved"));
    } catch (e) {
      if (e instanceof ApiError && e.code === "username_taken") setProfileError(t("profile.usernameTaken"));
      else setProfileError(t("common.error"));
    } finally {
      setSavingProfile(false);
    }
  };

  // Independent from the profile form above — sends the account's
  // already-saved username/names back unchanged, so this action can never
  // accidentally commit an unsaved edit sitting in the other form.
  const savePassword = async () => {
    setPasswordError("");
    if (!newPassword) return;
    if (passwordsMismatch) {
      setPasswordError(t("profile.passwordMismatch"));
      return;
    }
    if (!currentPassword) {
      setPasswordError(t("profile.currentPasswordRequired"));
      return;
    }
    setSavingPassword(true);
    try {
      const updated = await api.updateMe({
        username: user.username,
        display_name_en: user.display_name_en,
        display_name_id: user.display_name_id,
        display_name_zh: user.display_name_zh,
        current_password: currentPassword,
        new_password: newPassword,
      });
      setUser(updated);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      flash(setPasswordToast, t("profile.saved"));
    } catch (e) {
      if (e instanceof ApiError && e.code === "invalid_credentials") setPasswordError(t("profile.currentPasswordWrong"));
      else setPasswordError(t("common.error"));
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title">{t("profile.title")}</h1>
        <p className="page-lead">{t("profile.lead")}</p>
      </header>

      <div className="section profile-section">
        <div className="filter-groups">
          <div className="field">
            <span className="field-label">{t("profile.username")}</span>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
        </div>

        <div className="section-head">
          <h2 className="section-title">{t("profile.displayName")}</h2>
        </div>
        <p className="page-lead">{t("profile.displayNameLead")}</p>
        <div className="filter-groups">
          <div className="field">
            <span className="field-label">{t("profile.nameEn")}</span>
            <input className="input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </div>
          <div className="field">
            <span className="field-label">{t("profile.nameId")}</span>
            <div className="profile-name-row">
              <input className="input" value={nameId} onChange={(e) => setNameId(e.target.value)} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNameId(nameEn)}>
                {t("profile.useEnglishName")}
              </button>
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t("profile.nameZh")}</span>
            <div className="profile-name-row">
              <input className="input" value={nameZh} onChange={(e) => setNameZh(e.target.value)} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNameZh(nameEn)}>
                {t("profile.useEnglishName")}
              </button>
            </div>
          </div>
        </div>

        {profileError && <p className="form-error">{profileError}</p>}

        <div className="detail-actions">
          <div className="spacer" />
          <button type="button" className="btn btn-primary" disabled={savingProfile} onClick={() => void saveProfile()}>
            {savingProfile ? t("common.loading") : t("form.save")}
          </button>
        </div>

        {profileToast && (
          <div className="toast toast-success" role="status">
            <span className="toast-check" aria-hidden="true">{"✓"}</span>
            {profileToast}
          </div>
        )}
      </div>

      <div className="section profile-section">
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
                className={`input ${passwordsMismatch ? "input-invalid" : ""}`}
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {passwordsMismatch && <span className="field-error">{t("profile.passwordMismatch")}</span>}
            </div>
          </div>
        </div>

        {passwordError && <p className="form-error">{passwordError}</p>}

        <div className="detail-actions">
          <div className="spacer" />
          <button
            type="button"
            className="btn btn-primary"
            disabled={savingPassword || !newPassword || passwordsMismatch}
            onClick={() => void savePassword()}
          >
            {savingPassword ? t("common.loading") : t("profile.updatePassword")}
          </button>
        </div>

        {passwordToast && (
          <div className="toast toast-success" role="status">
            <span className="toast-check" aria-hidden="true">{"✓"}</span>
            {passwordToast}
          </div>
        )}
      </div>
    </div>
  );
}
