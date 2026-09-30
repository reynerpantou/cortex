import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import { api, ApiError } from "../lib/api";
import ProviderIcon from "../components/ProviderIcon";

const PROVIDERS = ["google", "apple"];

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

  if (!user) return null;

  const flash = (setter: (v: string) => void, msg: string) => {
    setter(msg);
    setTimeout(() => setter(""), 1800);
  };

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
      if (e instanceof ApiError && e.code === "username_taken")
        setProfileError(t("profile.usernameTaken"));
      else setProfileError(t("common.error"));
    } finally {
      setSavingProfile(false);
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
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
        </div>

        <div className="section-head">
          <h2 className="section-title">{t("profile.displayName")}</h2>
        </div>
        <p className="page-lead">{t("profile.displayNameLead")}</p>
        <div className="filter-groups">
          <div className="field">
            <span className="field-label">{t("profile.nameEn")}</span>
            <input
              className="input"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
            />
          </div>
          <div className="field">
            <span className="field-label">{t("profile.nameId")}</span>
            <div className="profile-name-row">
              <input
                className="input"
                value={nameId}
                onChange={(e) => setNameId(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setNameId(nameEn)}
              >
                {t("profile.useEnglishName")}
              </button>
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t("profile.nameZh")}</span>
            <div className="profile-name-row">
              <input
                className="input"
                value={nameZh}
                onChange={(e) => setNameZh(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setNameZh(nameEn)}
              >
                {t("profile.useEnglishName")}
              </button>
            </div>
          </div>
        </div>

        {profileError && <p className="form-error">{profileError}</p>}

        <div className="detail-actions">
          <div className="spacer" />
          <button
            type="button"
            className="btn btn-primary"
            disabled={savingProfile}
            onClick={() => void saveProfile()}
          >
            {savingProfile ? t("common.loading") : t("form.save")}
          </button>
        </div>

        {profileToast && (
          <div className="toast toast-success" role="status">
            <span className="toast-check" aria-hidden="true">
              {"✓"}
            </span>
            {profileToast}
          </div>
        )}
      </div>

      <div className="section profile-section">
        <div className="section-head">
          <h2 className="section-title">{t("profile.signIn")}</h2>
        </div>
        <p className="page-lead">
          {user.email
            ? t("profile.signInLead", { email: user.email })
            : t("profile.signInNoEmail")}
        </p>
        <div className="filter-groups">
          <ul className="signin-accounts">
            {PROVIDERS.map((p) => (
              <li key={p} className="signin-account">
                <ProviderIcon provider={p} />
                <span>{t(`profile.provider.${p}`)}</span>
                <span className="muted">
                  {user.linked?.includes(p)
                    ? t("profile.linked")
                    : t("profile.notLinked")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
