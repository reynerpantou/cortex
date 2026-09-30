// Package handlers holds the HTTP API. Handlers take *sql.DB directly and never
// import the database package, so the driver is wired only in main.
package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"sync"

	"github.com/reynerpantou/cortex/internal/config"
	"github.com/reynerpantou/cortex/internal/middleware"
	"github.com/reynerpantou/cortex/internal/sso"
)

type Server struct {
	DB       *sql.DB
	Cfg      config.Config
	ClientIP func(*http.Request) string

	// Providers are the sign-in options that are configured, by name.
	Providers map[string]*sso.Provider

	financeReady sync.Map // user ids whose finance setup is known to exist
}

func New(db *sql.DB, cfg config.Config) *Server {
	s := &Server{DB: db, Cfg: cfg, ClientIP: middleware.ClientIP(cfg.TrustedProxies), Providers: map[string]*sso.Provider{}}
	if cfg.GoogleClientID != "" && cfg.GoogleClientSecret != "" {
		s.Providers["google"] = sso.NewGoogle(cfg.GoogleClientID, cfg.GoogleClientSecret, cfg.GoogleTestBase)
	}
	if cfg.AppleClientID != "" && cfg.AppleTeamID != "" && cfg.AppleKeyID != "" && cfg.ApplePrivateKey != "" {
		p, err := sso.NewApple(cfg.AppleClientID, cfg.AppleTeamID, cfg.AppleKeyID, cfg.ApplePrivateKey, cfg.AppleTestBase)
		if err != nil {
			log.Fatalf("sign in with apple: %v", err)
		}
		s.Providers["apple"] = p
	}
	return s
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError sends a machine-readable code plus a human message. The frontend
// translates by code, so messages here are English fallbacks only.
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"code": code, "message": message})
}

var errNotJSON = errors.New("request body must be application/json")

// requireJSON rejects bodies not sent as JSON. An HTML form on another site
// can only send form-encoded or text/plain bodies without a CORS preflight,
// so this closes cross-site form posts (login CSRF included) outright.
func requireJSON(r *http.Request) error {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		return errNotJSON
	}
	return nil
}

func decode(r *http.Request, v any) error {
	if err := requireJSON(r); err != nil {
		return err
	}
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

// decodeLarge is decode with a bigger body cap, for bulk imports.
func decodeLarge(r *http.Request, v any) error {
	if err := requireJSON(r); err != nil {
		return err
	}
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 8<<20))
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}
