package handlers

import (
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/reynerpantou/cortex/internal/auth"
)

// Modules is every page an account can be granted. Home and Profile are
// always available; Administration follows is_admin, not this list.
var Modules = []string{"radar", "finance"}

// RequireModule refuses the request unless the signed-in user has been
// granted the module — so unticking a page in Administration actually
// closes it, rather than just hiding its menu entry.
func (s *Server) RequireModule(module string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var allowed bool
		err := s.DB.QueryRowContext(r.Context(), `SELECT $2 = ANY(modules) FROM users WHERE id = $1`, uid(r), module).Scan(&allowed)
		if err != nil || !allowed {
			writeError(w, http.StatusForbidden, "forbidden", "you don't have access to this page")
			return
		}
		h(w, r)
	}
}

func (s *Server) RequireAdmin(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var isAdmin bool
		err := s.DB.QueryRowContext(r.Context(), `SELECT is_admin FROM users WHERE id = $1`, uid(r)).Scan(&isAdmin)
		if err != nil || !isAdmin {
			writeError(w, http.StatusForbidden, "forbidden", "administrators only")
			return
		}
		h(w, r)
	}
}

type adminUser struct {
	ID            int64      `json:"id"`
	Username      string     `json:"username"`
	DisplayNameEN string     `json:"display_name_en"`
	DisplayNameID string     `json:"display_name_id"`
	DisplayNameZH string     `json:"display_name_zh"`
	IsAdmin       bool       `json:"is_admin"`
	Modules       []string   `json:"modules"`
	CreatedAt     time.Time  `json:"created_at"`
	LastSignIn    *time.Time `json:"last_sign_in"`
}

func (s *Server) AdminListUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.DB.QueryContext(r.Context(),
		`SELECT u.id, u.username, u.display_name_en, u.display_name_id, u.display_name_zh, u.is_admin,
		        array_to_string(u.modules, ','), u.created_at,
		        (SELECT MAX(created_at) FROM sessions WHERE user_id = u.id)
		 FROM users u ORDER BY u.id`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not load users")
		return
	}
	defer rows.Close()
	out := []adminUser{}
	for rows.Next() {
		var u adminUser
		var modules string
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayNameEN, &u.DisplayNameID, &u.DisplayNameZH, &u.IsAdmin, &modules, &u.CreatedAt, &u.LastSignIn); err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "could not read users")
			return
		}
		u.Modules = splitModules(modules)
		out = append(out, u)
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out, "modules": Modules})
}

func cleanModules(in []string) ([]string, bool) {
	out := []string{}
	for _, m := range in {
		if !slices.Contains(Modules, m) {
			return nil, false
		}
		if !slices.Contains(out, m) {
			out = append(out, m)
		}
	}
	return out, true
}

type adminUserInput struct {
	Username string   `json:"username"`
	Password string   `json:"password"`
	IsAdmin  bool     `json:"is_admin"`
	Modules  []string `json:"modules"`
}

func (s *Server) AdminCreateUser(w http.ResponseWriter, r *http.Request) {
	var in adminUserInput
	if err := decode(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "could not read the user")
		return
	}
	in.Username = strings.TrimSpace(in.Username)
	modules, ok := cleanModules(in.Modules)
	switch {
	case in.Username == "" || len(in.Username) > 64 || strings.ContainsAny(in.Username, " \t\r\n"):
		writeError(w, http.StatusBadRequest, "validation_error", "username is required and can't contain spaces")
		return
	case len(in.Password) < 8:
		writeError(w, http.StatusBadRequest, "validation_error", "password must be at least 8 characters")
		return
	case !ok:
		writeError(w, http.StatusBadRequest, "validation_error", "unknown module")
		return
	}
	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not set the password")
		return
	}
	var id int64
	err = s.DB.QueryRowContext(r.Context(),
		`INSERT INTO users (username, password_hash, created_at, display_name_en, display_name_id, display_name_zh, is_admin, modules)
		 VALUES ($1, $2, now(), $1, $1, $1, $3, $4) RETURNING id`,
		in.Username, hash, in.IsAdmin, modules,
	).Scan(&id)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeError(w, http.StatusConflict, "username_taken", "that username is already taken")
			return
		}
		writeError(w, http.StatusInternalServerError, "server_error", "could not create the user")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]int64{"id": id})
}

// AdminUpdateUser changes a user's role, modules and optionally password.
// An admin can't demote themselves or reset their own password here (that's
// what Profile is for), and the last administrator can never be demoted.
// A password reset signs the user out everywhere.
func (s *Server) AdminUpdateUser(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid id")
		return
	}
	var in adminUserInput
	if err := decode(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "could not read the user")
		return
	}
	modules, ok := cleanModules(in.Modules)
	if !ok {
		writeError(w, http.StatusBadRequest, "validation_error", "unknown module")
		return
	}
	self := id == uid(r)
	if self && !in.IsAdmin {
		writeError(w, http.StatusBadRequest, "cannot_demote_self", "you can't remove your own administrator role")
		return
	}
	if self && in.Password != "" {
		writeError(w, http.StatusBadRequest, "use_profile", "change your own password from Profile")
		return
	}
	if in.Password != "" && len(in.Password) < 8 {
		writeError(w, http.StatusBadRequest, "validation_error", "password must be at least 8 characters")
		return
	}

	tx, err := s.DB.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not update the user")
		return
	}
	defer tx.Rollback()
	var wasAdmin bool
	if err := tx.QueryRowContext(r.Context(), `SELECT is_admin FROM users WHERE id = $1 FOR UPDATE`, id).Scan(&wasAdmin); err != nil {
		writeError(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	if wasAdmin && !in.IsAdmin {
		var admins int
		_ = tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM users WHERE is_admin`).Scan(&admins)
		if admins <= 1 {
			writeError(w, http.StatusBadRequest, "last_admin", "there must be at least one administrator")
			return
		}
	}
	if _, err := tx.ExecContext(r.Context(), `UPDATE users SET is_admin = $1, modules = $2 WHERE id = $3`, in.IsAdmin, modules, id); err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not update the user")
		return
	}
	if in.Password != "" {
		hash, err := auth.HashPassword(in.Password)
		if err == nil {
			_, err = tx.ExecContext(r.Context(), `UPDATE users SET password_hash = $1 WHERE id = $2`, hash, id)
		}
		if err == nil {
			_, err = tx.ExecContext(r.Context(), `DELETE FROM sessions WHERE user_id = $1`, id)
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "could not reset the password")
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not update the user")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// AdminDeleteUser removes an account and everything that belongs to it
// (sessions, sidebar layout, finance ledger — all cascade). An admin can't
// delete themselves.
func (s *Server) AdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid id")
		return
	}
	if id == uid(r) {
		writeError(w, http.StatusBadRequest, "cannot_delete_self", "you can't delete your own account")
		return
	}
	res, err := s.DB.ExecContext(r.Context(), `DELETE FROM users WHERE id = $1`, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not delete the user")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
