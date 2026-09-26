import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { displayName } from "../lib/displayName";
import { modules } from "../lib/modules";
import type { AdminUser } from "../lib/types";

// No 0/O/1/l/I, so a temporary password survives being read out or retyped.
function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

type Editing = { mode: "create" } | { mode: "edit"; user: AdminUser };

export default function Admin() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "en";
  const { user: me, setUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [created, setCreated] = useState<{ username: string; password: string; reset: boolean } | null>(null);

  const load = async () => {
    setError(false);
    try {
      setUsers((await api.adminListUsers()).users);
    } catch {
      setError(true);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const dateLabel = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(lang === "zh" ? "zh-CN" : lang === "id" ? "id-ID" : "en-US", { day: "numeric", month: "short", year: "numeric" }) : t("admin.never");

  return (
    <div className="page">
      <header className="page-head page-head-row">
        <div>
          <h1 className="page-title">{t("admin.title")}</h1>
          <p className="page-lead">{t("admin.lead")}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ mode: "create" })}>
          {"+ " + t("admin.newUser")}
        </button>
      </header>

      {created && (
        <div className="created-banner" role="status">
          <div>
            <strong>{t(created.reset ? "admin.resetTitle" : "admin.createdTitle", { username: created.username })}</strong>
            <p className="muted">{t("admin.createdLead")}</p>
            <code className="created-cred">{`${created.username} / ${created.password}`}</code>
          </div>
          <div className="created-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard?.writeText(`${created.username} / ${created.password}`)}>
              {t("admin.copy")}
            </button>
            <button type="button" className="ai-summary-dismiss" aria-label={t("form.cancel")} onClick={() => setCreated(null)}>×</button>
          </div>
        </div>
      )}

      {error ? (
        <div className="center">
          <p className="muted">{t("common.error")}</p>
          <button className="btn btn-ghost" onClick={() => void load()}>{t("common.retry")}</button>
        </div>
      ) : !users ? (
        <p className="muted">{t("common.loading")}</p>
      ) : (
        <ul className="admin-users">
          {users.map((u) => {
            const isMe = u.id === me?.id;
            return (
              <li key={u.id} className="admin-user">
                <div className="admin-user-main">
                  <span className="user-avatar" aria-hidden="true">{displayName(u, lang).slice(0, 1).toUpperCase()}</span>
                  <div className="admin-user-id">
                    <span className="admin-user-name">
                      {displayName(u, lang)}
                      {u.is_admin && <span className="role-badge">{t("admin.adminBadge")}</span>}
                      {isMe && <span className="role-badge role-badge-me">{t("admin.you")}</span>}
                    </span>
                    <span className="muted admin-user-sub">
                      {`@${u.username} · ${t("admin.lastSignIn", { date: dateLabel(u.last_sign_in) })}`}
                    </span>
                  </div>
                </div>
                <div className="admin-user-modules" aria-label={t("admin.pages")}>
                  {modules.map((m) => (
                    <span key={m.key} className={`module-pill ${u.modules.includes(m.key) ? "is-on" : ""}`}>
                      <span aria-hidden="true">{u.modules.includes(m.key) ? "✓" : "–"}</span>
                      {t(m.navKey)}
                    </span>
                  ))}
                </div>
                <div className="admin-user-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ mode: "edit", user: u })}>
                    {t("admin.edit")}
                  </button>
                  {!isMe && (
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => setDeleting(u)}>
                      {t("form.delete")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <UserForm
          editing={editing}
          isMe={editing.mode === "edit" && editing.user.id === me?.id}
          onClose={() => setEditing(null)}
          onSaved={(result) => {
            const wasMe = editing.mode === "edit" && editing.user.id === me?.id;
            setEditing(null);
            if (result) setCreated(result);
            void load();
            // Editing your own pages takes effect in the sidebar right away.
            if (wasMe) void api.me().then(setUser).catch(() => undefined);
          }}
        />
      )}

      {deleting && (
        <div className="overlay" onClick={() => setDeleting(null)}>
          <div className="overlay-body" onClick={(e) => e.stopPropagation()}>
            <div className="form-panel" role="alertdialog" aria-label={t("admin.deleteTitle", { username: deleting.username })}>
              <h2 className="form-heading">{t("admin.deleteTitle", { username: deleting.username })}</h2>
              <p className="muted">{t("admin.deleteLead")}</p>
              <div className="form-actions">
                <span className="spacer" />
                <button type="button" className="btn btn-ghost" onClick={() => setDeleting(null)}>{t("form.cancel")}</button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    const target = deleting;
                    setDeleting(null);
                    void api.adminDeleteUser(target.id).then(load).catch(() => setError(true));
                  }}
                >
                  {t("admin.deleteConfirm")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UserForm({
  editing,
  isMe,
  onClose,
  onSaved,
}: {
  editing: Editing;
  isMe: boolean;
  onClose: () => void;
  onSaved: (created: { username: string; password: string; reset: boolean } | null) => void;
}) {
  const { t } = useTranslation();
  const existing = editing.mode === "edit" ? editing.user : null;
  const [username, setUsername] = useState(existing?.username ?? "");
  const [password, setPassword] = useState(existing ? "" : generatePassword());
  const [resetPassword, setResetPassword] = useState(false);
  const [isAdmin, setIsAdmin] = useState(existing?.is_admin ?? false);
  const [granted, setGranted] = useState<string[]>(existing?.modules ?? modules.map((m) => m.key));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const toggle = (key: string) => setGranted((g) => (g.includes(key) ? g.filter((k) => k !== key) : [...g, key]));

  const submit = async () => {
    setError("");
    if (!existing && !username.trim()) {
      setError(t("admin.usernameRequired"));
      return;
    }
    const sendPassword = !existing || resetPassword;
    if (sendPassword && password.length < 8) {
      setError(t("admin.passwordShort"));
      return;
    }
    setBusy(true);
    try {
      if (existing) {
        await api.adminUpdateUser(existing.id, { is_admin: isAdmin, modules: granted, password: resetPassword ? password : undefined });
        onSaved(resetPassword ? { username: existing.username, password, reset: true } : null);
      } else {
        await api.adminCreateUser({ username: username.trim(), password, is_admin: isAdmin, modules: granted });
        onSaved({ username: username.trim(), password, reset: false });
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "username_taken") setError(t("profile.usernameTaken"));
      else setError(e instanceof ApiError ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-body" onClick={(e) => e.stopPropagation()}>
        <form
          className="form-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h2 className="form-heading">{existing ? t("admin.editTitle", { username: existing.username }) : t("admin.newUser")}</h2>

          <label className="field">
            <span className="field-label">{t("profile.username")}</span>
            <input
              className="input"
              value={username}
              disabled={!!existing}
              autoFocus={!existing}
              autoComplete="off"
              onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
            />
            {existing && <span className="field-hint">{t("admin.usernameHint")}</span>}
          </label>

          {existing && !isMe && (
            <label className="radio-row">
              <input
                type="checkbox"
                checked={resetPassword}
                onChange={(e) => {
                  setResetPassword(e.target.checked);
                  if (e.target.checked && !password) setPassword(generatePassword());
                }}
              />
              <span>
                <strong>{t("admin.resetPassword")}</strong>
                <span className="radio-desc">{t("admin.resetPasswordDesc")}</span>
              </span>
            </label>
          )}
          {(!existing || resetPassword) && (
            <label className="field">
              <span className="field-label">{existing ? t("admin.newPassword") : t("admin.tempPassword")}</span>
              <div className="profile-name-row">
                <input className="input admin-password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className="btn btn-ghost" onClick={() => setPassword(generatePassword())}>
                  {t("admin.generate")}
                </button>
              </div>
              <span className="field-hint">{t("admin.passwordHint")}</span>
            </label>
          )}

          <fieldset className="admin-fieldset">
            <legend className="field-label">{t("admin.pages")}</legend>
            <p className="field-hint">{t("admin.pagesHint")}</p>
            {modules.map((m) => (
              <label key={m.key} className="radio-row">
                <input type="checkbox" checked={granted.includes(m.key)} onChange={() => toggle(m.key)} />
                <span>
                  <strong>{`${m.icon} ${t(m.navKey)}`}</strong>
                  <span className="radio-desc">{t(m.descriptionKey)}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="admin-fieldset">
            <legend className="field-label">{t("admin.role")}</legend>
            <label className="radio-row">
              <input type="checkbox" checked={isAdmin} disabled={isMe} onChange={(e) => setIsAdmin(e.target.checked)} />
              <span>
                <strong>{t("admin.isAdmin")}</strong>
                <span className="radio-desc">{isMe ? t("admin.isAdminSelf") : t("admin.isAdminDesc")}</span>
              </span>
            </label>
          </fieldset>

          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <span className="spacer" />
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t("form.cancel")}</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {existing ? t("form.save") : t("admin.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
