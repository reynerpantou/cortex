package handlers

import (
	"database/sql"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/reynerpantou/cortex/internal/auth"
	"github.com/reynerpantou/cortex/internal/middleware"
	"github.com/reynerpantou/cortex/internal/models"
)

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *Server) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := decode(r, &req); err != nil || strings.TrimSpace(req.Username) == "" || req.Password == "" || len(req.Password) > 1024 {
		writeError(w, http.StatusBadRequest, "invalid_request", "username and password are required")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	ctx := r.Context()
	ip := s.ClientIP(r)

	// A cooldown is checked before the password, so nothing can be learned
	// (and no guess can succeed) while it lasts.
	if wait, err := s.loginLockedFor(ctx, req.Username, ip); err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not sign you in")
		return
	} else if wait > 0 {
		writeLocked(w, wait)
		return
	}

	var u models.User
	var modules string
	err := s.DB.QueryRow(
		`SELECT `+userColumns+`, password_hash FROM users WHERE lower(username) = lower($1)`, req.Username,
	).Scan(&u.ID, &u.Username, &u.DisplayNameEN, &u.DisplayNameID, &u.DisplayNameZH, &u.IsAdmin, &u.IsOwner, &modules, &u.PasswordHash)
	u.Modules = splitModules(modules)
	if u.IsOwner {
		u.Modules = slices.Clone(Modules) // the owner always has every page
	}

	// Always run a verify to keep timing uniform whether or not the user exists.
	valid := false
	if errors.Is(err, sql.ErrNoRows) {
		_, _ = auth.VerifyPassword(req.Password, "pbkdf2_sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not sign you in")
		return
	} else {
		valid, _ = auth.VerifyPassword(req.Password, u.PasswordHash)
	}
	if !valid {
		remaining, locked, err := s.recordLoginFailure(ctx, req.Username, ip)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "could not sign you in")
			return
		}
		if locked > 0 {
			writeLocked(w, locked)
			return
		}
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"code":               "invalid_credentials",
			"message":            "incorrect username or password",
			"remaining_attempts": remaining,
		})
		return
	}
	s.clearLoginFailures(ctx, req.Username, ip)

	token, err := auth.CreateSession(s.DB, u.ID, s.Cfg.SessionTTL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not start your session")
		return
	}
	csrf, _ := auth.NewToken()

	http.SetCookie(w, &http.Cookie{
		Name: middleware.SessionCookie, Value: token, Path: "/",
		HttpOnly: true, Secure: s.Cfg.CookieSecure, SameSite: http.SameSiteLaxMode,
		Expires: time.Now().Add(s.Cfg.SessionTTL),
	})
	http.SetCookie(w, &http.Cookie{
		Name: middleware.CSRFCookie, Value: csrf, Path: "/",
		HttpOnly: false, Secure: s.Cfg.CookieSecure, SameSite: http.SameSiteLaxMode,
		Expires: time.Now().Add(s.Cfg.SessionTTL),
	})
	writeJSON(w, http.StatusOK, userJSON(u))
}

func (s *Server) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(middleware.SessionCookie); err == nil {
		_ = auth.DeleteSession(s.DB, c.Value)
	}
	clear := func(name string) {
		http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", MaxAge: -1, HttpOnly: name == middleware.SessionCookie, Secure: s.Cfg.CookieSecure, SameSite: http.SameSiteLaxMode})
	}
	clear(middleware.SessionCookie)
	clear(middleware.CSRFCookie)
	w.WriteHeader(http.StatusNoContent)
}

// userJSON is the shape returned for the signed-in user everywhere
// (login, /me, profile update) — kept in one place so they can't drift.
func userJSON(u models.User) map[string]any {
	return map[string]any{
		"id":              u.ID,
		"username":        u.Username,
		"display_name_en": u.DisplayNameEN,
		"display_name_id": u.DisplayNameID,
		"display_name_zh": u.DisplayNameZH,
		"is_admin":        u.IsAdmin,
		"is_owner":        u.IsOwner,
		"modules":         u.Modules,
	}
}

const userColumns = `id, username, display_name_en, display_name_id, display_name_zh, is_admin, is_owner, array_to_string(modules, ',')`

func splitModules(joined string) []string {
	if joined == "" {
		return []string{}
	}
	return strings.Split(joined, ",")
}

func (s *Server) loadUser(id int64) (models.User, error) {
	var u models.User
	var modules string
	err := s.DB.QueryRow(`SELECT `+userColumns+` FROM users WHERE id = $1`, id).
		Scan(&u.ID, &u.Username, &u.DisplayNameEN, &u.DisplayNameID, &u.DisplayNameZH, &u.IsAdmin, &u.IsOwner, &modules)
	u.Modules = splitModules(modules)
	if u.IsOwner {
		u.Modules = slices.Clone(Modules) // the owner always has every page
	}
	return u, err
}

// Me returns the authenticated user; used by the SPA to restore a session.
func (s *Server) Me(w http.ResponseWriter, r *http.Request) {
	uid, _ := middleware.UserIDFrom(r.Context())
	u, err := s.loadUser(uid)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not signed in")
		return
	}
	writeJSON(w, http.StatusOK, userJSON(u))
}

type updateMeRequest struct {
	Username        string `json:"username"`
	DisplayNameEN   string `json:"display_name_en"`
	DisplayNameID   string `json:"display_name_id"`
	DisplayNameZH   string `json:"display_name_zh"`
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

// UpdateMe lets the signed-in user rename themselves and/or change their
// password. It never touches provider API keys — those stay in environment
// config, not the database (see internal/config).
func (s *Server) UpdateMe(w http.ResponseWriter, r *http.Request) {
	uid, _ := middleware.UserIDFrom(r.Context())
	var req updateMeRequest
	if err := decode(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "could not read the request")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	req.DisplayNameEN = strings.TrimSpace(req.DisplayNameEN)
	req.DisplayNameID = strings.TrimSpace(req.DisplayNameID)
	req.DisplayNameZH = strings.TrimSpace(req.DisplayNameZH)
	if msg := validateUsername(req.Username); msg != "" {
		writeError(w, http.StatusBadRequest, "validation_error", msg)
		return
	}
	for _, n := range []string{req.DisplayNameEN, req.DisplayNameID, req.DisplayNameZH} {
		if utf8.RuneCountInString(n) > 80 {
			writeError(w, http.StatusBadRequest, "validation_error", "display names can be at most 80 characters")
			return
		}
	}

	var currentHash string
	if err := s.DB.QueryRow(`SELECT password_hash FROM users WHERE id = $1`, uid).Scan(&currentHash); err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not load your account")
		return
	}

	newHash := currentHash
	if req.NewPassword != "" {
		if msg := validatePassword(req.NewPassword); msg != "" {
			writeError(w, http.StatusBadRequest, "validation_error", msg)
			return
		}
		valid, _ := auth.VerifyPassword(req.CurrentPassword, currentHash)
		if !valid {
			writeError(w, http.StatusUnauthorized, "invalid_credentials", "current password is incorrect")
			return
		}
		hash, err := auth.HashPassword(req.NewPassword)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "could not set the new password")
			return
		}
		newHash = hash
	}

	_, err := s.DB.Exec(
		`UPDATE users SET username = $1, display_name_en = $2, display_name_id = $3, display_name_zh = $4, password_hash = $5 WHERE id = $6`,
		req.Username, req.DisplayNameEN, req.DisplayNameID, req.DisplayNameZH, newHash, uid,
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeError(w, http.StatusConflict, "username_taken", "that username is already taken")
			return
		}
		writeError(w, http.StatusInternalServerError, "server_error", "could not update your account")
		return
	}
	// A new password signs every other device out, so whoever knew the old
	// one loses access immediately.
	if req.NewPassword != "" {
		if c, err := r.Cookie(middleware.SessionCookie); err == nil {
			_ = auth.DeleteOtherSessions(s.DB, uid, c.Value)
		}
	}
	s.Me(w, r)
}

// validateUsername is shared by sign-up (admin) and profile edits.
func validateUsername(u string) string {
	switch {
	case u == "":
		return "username is required"
	case utf8.RuneCountInString(u) > 64:
		return "username can be at most 64 characters"
	case strings.IndexFunc(u, func(r rune) bool { return r <= ' ' || r == 0x7f }) >= 0:
		return "username can't contain spaces"
	}
	return ""
}

func validatePassword(p string) string {
	switch {
	case len(p) < 8:
		return "password must be at least 8 characters"
	case len(p) > 1024:
		return "password is too long"
	}
	return ""
}
