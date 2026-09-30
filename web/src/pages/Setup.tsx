import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../lib/api";
import LanguageSwitcher from "../components/LanguageSwitcher";
import ProviderIcon from "../components/ProviderIcon";

// Claiming the owner account with the one-time link the server printed to
// its log. The token stays in the #fragment (never sent anywhere by the
// browser) and goes to the server only in the request that starts sign-in.
export default function Setup() {
  const { t } = useTranslation();
  const [token] = useState(() => window.location.hash.slice(1));
  const [providers, setProviders] = useState<string[] | null>(null);
  const [needed, setNeeded] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    // Keep the token out of history and screenshots once it's read.
    window.history.replaceState(null, "", window.location.pathname);
    api
      .authProviders()
      .then((r) => {
        setProviders(r.providers);
        setNeeded(r.setup_needed);
      })
      .catch(() => setProviders([]));
  }, []);

  const start = async (provider: string) => {
    setError("");
    setBusy(provider);
    try {
      const { redirect } = await api.setupStart(token, provider);
      window.location.assign(redirect);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setError(code === "setup_done" ? t("setup.done") : code === "setup_link_invalid" ? t("setup.invalid") : t("login.errors.failed"));
      setBusy("");
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
        <h1 className="setup-title">{t("setup.title")}</h1>

        {!needed ? (
          <>
            <p className="login-sub">{t("setup.done")}</p>
            <a className="btn btn-ghost btn-block" href="/login">{t("login.backToSignIn")}</a>
          </>
        ) : !token ? (
          <p className="form-error login-error" role="alert">{t("setup.noToken")}</p>
        ) : (
          <>
            <p className="login-sub">{t("setup.lead")}</p>
            {error && <p className="form-error login-error" role="alert">{error}</p>}
            {providers === null ? (
              <p className="muted">{t("common.loading")}</p>
            ) : providers.length === 0 ? (
              <p className="muted login-none">{t("setup.noProviders")}</p>
            ) : (
              <div className="login-providers">
                {providers.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`btn btn-block provider-btn provider-${p}`}
                    disabled={!!busy}
                    onClick={() => void start(p)}
                  >
                    <ProviderIcon provider={p} />
                    <span>{t(`login.continueWith.${p}`)}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="login-foot muted">{t("setup.foot")}</p>
          </>
        )}
      </div>
    </div>
  );
}
