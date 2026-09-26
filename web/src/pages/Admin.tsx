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
  const [data, setData] = useState<{ users: AdminUser[]; total: number; page_size: number; can_grant_admin: boolean } | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [created, setCreated] = useState<{ username: string; password: string; reset: boolean } | null>(null);

  const load = async () => {
    setError(false);
    try {
      setData(await api.adminListUsers({ q, page }));
    } catch {
      setError(true);
    }
  };

  useEffect(() => {
    const id = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, page]);

  const dateLabel = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(lang === "zh" ? "zh-CN" : lang === "id" ? "id-ID" : "en-US", { day: "numeric", month: "short", year: "numeric" }) : t("admin.never");

  // A one-line summary instead of a pill per page, so the column stays the
  // same width however many modules Cortex grows.
  const access = (u: AdminUser) => {
    const names = modules.filter((m) => u.modules.includes(m.key)).map((m) => t(m.navKey));
    if (names.length === modules.length) return { label: t("admin.allPages"), full: names.join(", ") };
    if (names.length === 0) return { label: t("admin.noPages"), full: "" };
    if (names.length === 1) return { label: t("admin.onlyPage", { page: names[0] }), full: names[0] };
    const label = names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
    return { label, full: names.join(", ") };
  };

  const total = data?.total ?? 0;
  const pageSize = data?.page_size ?? 25;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

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

      <div className="admin-toolbar">
        <input
          className="input admin-search"
          type="search"
          value={q}
          placeholder={t("admin.search")}
          aria-label={t("admin.search")}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        {data && <span className="muted admin-count">{t("admin.count", { count: total })}</span>}
      </div>

      {error ? (
        <div className="center">
          <p className="muted">{t("common.error")}</p>
          <button className="btn btn-ghost" onClick={() => void load()}>{t("common.retry")}</button>
        </div>
      ) : !data ? (
        <p className="muted">{t("common.loading")}</p>
      ) : data.users.length === 0 ? (
        <p className="empty">{t("admin.noMatch")}</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("admin.colUser")}</th>
                <th>{t("admin.role")}</th>
                <th>{t("admin.colAccess")}</th>
                <th>{t("admin.colLastSignIn")}</th>
                <th aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => {
                const isMe = u.id === me?.id;
                const a = access(u);
                // The owner row is never editable; other rows only when the
                // server says this account may manage them (or it's you,
                // adjusting your own pages).
                const editable = u.manageable || (isMe && !u.is_owner);
                const open = () => editable && setEditing({ mode: "edit", user: u });
                return (
                  <tr key={u.id} className={editable ? "admin-row" : "admin-row admin-row-locked"} onClick={open}>
                    <td className="admin-cell-user">
                      <span className="user-avatar" aria-hidden="true">{displayName(u, lang).slice(0, 1).toUpperCase()}</span>
                      <span className="admin-user-id">
                        {editable ? (
                          <button
                            type="button"
                            className="admin-user-name"
                            onClick={(e) => {
                              e.stopPropagation();
                              open();
                            }}
                          >
                            {displayName(u, lang)}
                            {isMe && <span className="role-badge role-badge-me">{t("admin.you")}</span>}
                          </button>
                        ) : (
                          <span className="admin-user-name">
                            {displayName(u, lang)}
                            {isMe && <span className="role-badge role-badge-me">{t("admin.you")}</span>}
                          </span>
                        )}
                        <span className="muted admin-user-sub">{`@${u.username}`}</span>
                      </span>
                    </td>
                    <td className="admin-cell-role">
                      {u.is_owner ? (
                        <span className="role-badge role-badge-owner">{t("admin.ownerBadge")}</span>
                      ) : u.is_admin ? (
                        <span className="role-badge">{t("admin.adminBadge")}</span>
                      ) : (
                        <span className="muted">{t("admin.member")}</span>
                      )}
                    </td>
                    <td className="admin-cell-access" title={a.full}>{a.label}</td>
                    <td className="admin-cell-signin muted">{dateLabel(u.last_sign_in)}</td>
                    <td className="admin-cell-chevron" aria-hidden="true" title={editable ? undefined : t("admin.lockedRow")}>
                      {editable ? "›" : "🔒"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && total > pageSize && (
        <div className="admin-pager">
          <span className="muted">{t("admin.range", { from, to, total })}</span>
          <button type="button" className="month-switcher-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label={t("finance.prev")}>‹</button>
          <button type="button" className="month-switcher-btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label={t("finance.next")}>›</button>
        </div>
      )}

      {editing && (
        <UserForm
          editing={editing}
          isMe={editing.mode === "edit" && editing.user.id === me?.id}
          canGrantAdmin={!!data?.can_grant_admin}
          onClose={() => setEditing(null)}
          onDelete={
            editing.mode === "edit" && editing.user.id !== me?.id
              ? () => {
                  setDeleting(editing.user);
                  setEditing(null);
                }
              : undefined
          }
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
  canGrantAdmin,
  onClose,
  onSaved,
  onDelete,
}: {
  editing: Editing;
  isMe: boolean;
  canGrantAdmin: boolean;
  onClose: () => void;
  onDelete?: () => void;
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
              <input type="checkbox" checked={isAdmin} disabled={isMe || !canGrantAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
              <span>
                <strong>{t("admin.isAdmin")}</strong>
                <span className="radio-desc">
                  {isMe ? t("admin.isAdminSelf") : canGrantAdmin ? t("admin.isAdminDesc") : t("admin.isAdminOwnerOnly")}
                </span>
              </span>
            </label>
          </fieldset>

          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            {onDelete && (
              <button type="button" className="btn btn-danger" onClick={onDelete}>
                {t("admin.deleteConfirm")}
              </button>
            )}
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
