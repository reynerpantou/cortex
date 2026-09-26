import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import LanguageSwitcher from "../components/LanguageSwitcher";

export default function Login() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The cooldown is enforced by the server; this only counts it down so the
  // button stays disabled until it's worth trying again.
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const waitSecs = Math.max(0, Math.ceil((lockedUntil - now) / 1000));

  useEffect(() => {
    if (!lockedUntil) return;
    const id = window.setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= lockedUntil) {
        setLockedUntil(0);
        setError("");
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [lockedUntil]);

  const submit = async () => {
    if (busy || waitSecs > 0) return;
    setBusy(true);
    setError("");
    try {
      await login(username, password);
      navigate("/", { replace: true });
    } catch (e) {
      const body = (e instanceof ApiError ? e.body : null) as
        | { retry_after?: number; remaining_attempts?: number }
        | null;
      if (e instanceof ApiError && e.status === 429) {
        const secs = body?.retry_after ?? 60;
        setNow(Date.now());
        setLockedUntil(Date.now() + secs * 1000);
        setError(t("login.locked"));
      } else if (e instanceof ApiError && e.status === 401) {
        const left = body?.remaining_attempts;
        setError(
          left !== undefined && left <= 3
            ? `${t("login.failed")}. ${t("login.attemptsLeft", { count: left })}`
            : t("login.failed"),
        );
      } else {
        setError(t("login.error"));
      }
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

        {error && (
          <p className="form-error" role="alert">
            {error}
            {waitSecs > 0 && <> {t("login.tryAgainIn", { time: formatWait(waitSecs) })}</>}
          </p>
        )}

        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => void submit()}
          disabled={busy || waitSecs > 0}
        >
          {busy ? t("login.signingIn") : waitSecs > 0 ? formatWait(waitSecs) : t("login.submit")}
        </button>
      </div>
    </div>
  );
}

function formatWait(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return (h ? `${h}:` : "") + `${mm}:${String(s).padStart(2, "0")}`;
}
