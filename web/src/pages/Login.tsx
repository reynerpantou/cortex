import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import LanguageSwitcher from "../components/LanguageSwitcher";
import ProviderIcon from "../components/ProviderIcon";

const ERRORS = ["cancelled", "expired", "failed", "unavailable", "not_invited", "rate_limited"];

export default function Login() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const [params] = useSearchParams();
  const [providers, setProviders] = useState<string[] | null>(null);

  useEffect(() => {
    api
      .authProviders()
      .then((r) => setProviders(r.providers))
      .catch(() => setProviders([]));
  }, []);

  if (!loading && user) return <Navigate to="/" replace />;

  const code = params.get("error");
  const error = code ? (ERRORS.includes(code) ? code : "failed") : "";
  const email = params.get("email") ?? "";

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

        {error && (
          <div className="form-error login-error" role="alert">
            {error === "not_invited" ? (
              <>
                <strong>{t("login.errors.not_invited")}</strong>
                {email && <span className="login-error-detail">{t("login.notInvitedEmail", { email })}</span>}
                <span className="login-error-detail">{t("login.notInvitedHint")}</span>
              </>
            ) : (
              t(`login.errors.${error}`)
            )}
          </div>
        )}

        {providers === null ? (
          <p className="muted">{t("common.loading")}</p>
        ) : providers.length === 0 ? (
          <p className="muted login-none">{t("login.noProviders")}</p>
        ) : (
          <div className="login-providers">
            {providers.map((p) => (
              // A real navigation, not fetch: the browser has to visit the
              // provider's own page to sign in.
              <a key={p} className={`btn btn-block provider-btn provider-${p}`} href={`/api/auth/${p}/start`}>
                <ProviderIcon provider={p} />
                <span>{t(`login.continueWith.${p}`)}</span>
              </a>
            ))}
          </div>
        )}
        <p className="login-foot muted">{t("login.inviteOnly")}</p>
      </div>
    </div>
  );
}
