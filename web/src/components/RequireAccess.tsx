import { Link, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import { canUse } from "../lib/modules";

// Wraps a module's routes (or the admin page): anyone without access gets a
// plain "no access" page instead of a half-broken screen of 403 errors.
export default function RequireAccess({ module, admin }: { module?: string; admin?: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const allowed = admin ? !!user?.is_admin : module ? canUse(user, module) : true;
  if (allowed) return <Outlet />;
  return (
    <div className="page center">
      <h1 className="page-title">{t("access.title")}</h1>
      <p className="muted">{t(admin ? "access.adminOnly" : "access.notGranted")}</p>
      <Link to="/" className="btn btn-ghost">{t("access.home")}</Link>
    </div>
  );
}
