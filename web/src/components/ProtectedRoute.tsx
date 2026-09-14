import { Navigate, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";

export default function ProtectedRoute() {
  const { user, loading } = useAuth();
  const { t } = useTranslation();
  if (loading) return <div className="center muted">{t("common.loading")}</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}
