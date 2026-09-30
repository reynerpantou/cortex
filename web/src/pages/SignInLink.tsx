import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";

// Redeems a one-time link made on the server with `cortex sign-in-link`.
// The token sits in the URL fragment (#…), which the browser never sends
// to any server, so link previews can't use it up before you do.
export default function SignInLink() {
  const { t } = useTranslation();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = window.location.hash.slice(1);
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) {
      setFailed(true);
      return;
    }
    api
      .redeemSignInLink(token)
      .then((u) => {
        setUser(u);
        navigate("/", { replace: true });
      })
      .catch(() => setFailed(true));
  }, [navigate, setUser]);

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand brand-lg">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">{t("app.name")}</span>
        </div>
        {failed ? (
          <>
            <p className="form-error login-error" role="alert">{t("login.linkExpired")}</p>
            <Link className="btn btn-ghost btn-block" to="/login">{t("login.backToSignIn")}</Link>
          </>
        ) : (
          <p className="login-sub">{t("login.signingIn")}</p>
        )}
      </div>
    </div>
  );
}
