// Package handlers holds the HTTP API. Handlers take *sql.DB directly and never
// import the database package, so the driver is wired only in main.
package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"sync"

	"github.com/reynerpantou/cortex/internal/config"
)

type Server struct {
	DB  *sql.DB
	Cfg config.Config

	financeReady sync.Map // user ids whose finance setup is known to exist
}

func New(db *sql.DB, cfg config.Config) *Server { return &Server{DB: db, Cfg: cfg} }

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

func decode(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

// decodeLarge is decode with a bigger body cap, for bulk imports.
func decodeLarge(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 8<<20))
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}
