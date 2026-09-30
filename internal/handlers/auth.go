package handlers

import (
	"errors"
	"net/http"
	"net/mail"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/reynerpantou/cortex/internal/auth"
	"github.com/reynerpantou/cortex/internal/middleware"
	"github.com/reynerpantou/cortex/internal/models"
)

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
		"email":           u.Email,
		"modules":         u.Modules,
	}
}

const userColumns = `id, username, display_name_en, display_name_id, display_name_zh, is_admin, is_owner, COALESCE(email, ''), array_to_string(modules, ',')`

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
		Scan(&u.ID, &u.Username, &u.DisplayNameEN, &u.DisplayNameID, &u.DisplayNameZH, &u.IsAdmin, &u.IsOwner, &u.Email, &modules)
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
	out := userJSON(u)
	out["linked"] = s.linkedProviders(r.Context(), uid)
	writeJSON(w, http.StatusOK, out)
}

type updateMeRequest struct {
	Username      string `json:"username"`
	DisplayNameEN string `json:"display_name_en"`
	DisplayNameID string `json:"display_name_id"`
	DisplayNameZH string `json:"display_name_zh"`
}

// UpdateMe lets the signed-in user rename themselves. Their email (which
// decides who can sign in as them) is set in Administration, not here.
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

	_, err := s.DB.Exec(
		`UPDATE users SET username = $1, display_name_en = $2, display_name_id = $3, display_name_zh = $4 WHERE id = $5`,
		req.Username, req.DisplayNameEN, req.DisplayNameID, req.DisplayNameZH, uid,
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

// validateEmail normalizes an invitation email, or explains what's wrong.
func validateEmail(e string) (string, string) {
	e = strings.ToLower(strings.TrimSpace(e))
	addr, err := mail.ParseAddress(e)
	if err != nil || addr.Address != e || len(e) > 254 {
		return "", "enter a valid email address"
	}
	return e, ""
}
