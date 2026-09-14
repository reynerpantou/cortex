import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import LanguageSwitcher from "../components/LanguageSwitcher";

export default function Login() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await login(username, password);
      navigate("/", { replace: true });
    } catch {
      setError(t("login.failed"));
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-lang">
        <LanguageSwitcher />
      </div>
      <div className="login-card">
        <div className="brand brand-lg">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">{t("app.name")}</span>
        </div>
        <p className="login-sub">{t("login.subtitle")}</p>

        <label className="field">
          <span className="field-label">{t("login.username")}</span>
          <input
            className="input"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
        </label>
        <label className="field">
          <span className="field-label">{t("login.password")}</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
        </label>

        {error && <p className="form-error">{error}</p>}

        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => void submit()}
          disabled={busy}
        >
          {busy ? t("login.signingIn") : t("login.submit")}
        </button>
      </div>
    </div>
  );
}
