package handlers

import (
	"database/sql"
	"errors"
	"net/http"
	"time"

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
	err := s.DB.QueryRow(
		`SELECT id, username, password_hash FROM users WHERE username = ?`, req.Username,
	).Scan(&u.ID, &u.Username, &u.PasswordHash)

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
	writeJSON(w, http.StatusOK, map[string]any{"id": u.ID, "username": u.Username})
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

// Me returns the authenticated user; used by the SPA to restore a session.
func (s *Server) Me(w http.ResponseWriter, r *http.Request) {
	uid, _ := middleware.UserIDFrom(r.Context())
	var u models.User
	err := s.DB.QueryRow(`SELECT id, username FROM users WHERE id = ?`, uid).Scan(&u.ID, &u.Username)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not signed in")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": u.ID, "username": u.Username})
}
