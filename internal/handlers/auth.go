package handlers

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

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
	if err := decode(r, &req); err != nil || req.Username == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "username and password are required")
		return
	}

	var u models.User
	var modules string
	err := s.DB.QueryRow(
		`SELECT `+userColumns+`, password_hash FROM users WHERE username = $1`, req.Username,
	).Scan(&u.ID, &u.Username, &u.DisplayNameEN, &u.DisplayNameID, &u.DisplayNameZH, &u.IsAdmin, &modules, &u.PasswordHash)
	u.Modules = splitModules(modules)

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
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "incorrect username or password")
		return
	}

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
		"modules":         u.Modules,
	}
}

const userColumns = `id, username, display_name_en, display_name_id, display_name_zh, is_admin, array_to_string(modules, ',')`

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
		Scan(&u.ID, &u.Username, &u.DisplayNameEN, &u.DisplayNameID, &u.DisplayNameZH, &u.IsAdmin, &modules)
	u.Modules = splitModules(modules)
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
	if req.Username == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "username is required")
		return
	}

	var currentHash string
	if err := s.DB.QueryRow(`SELECT password_hash FROM users WHERE id = $1`, uid).Scan(&currentHash); err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not load your account")
		return
	}

	newHash := currentHash
	if req.NewPassword != "" {
		if len(req.NewPassword) < 8 {
			writeError(w, http.StatusBadRequest, "validation_error", "new password must be at least 8 characters")
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
	s.Me(w, r)
}
