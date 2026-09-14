// Package middleware provides HTTP middleware: security headers, auth, CSRF,
// login rate limiting, panic recovery and request logging.
package middleware

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"log"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/reynerpantou/cortex/internal/auth"
)

const (
	SessionCookie = "cortex_session"
	CSRFCookie    = "cortex_csrf"
	CSRFHeader    = "X-CSRF-Token"
)

type ctxKey int

const userIDKey ctxKey = 0

// UserIDFrom returns the authenticated user id set by RequireAuth.
func UserIDFrom(ctx context.Context) (int64, bool) {
	id, ok := ctx.Value(userIDKey).(int64)
	return id, ok
}

// SecurityHeaders sets conservative defaults. The CSP allows only same-origin
// assets plus outbound calls the SPA needs; tighten further once the AI UI lands.
func SecurityHeaders(secure bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
			h.Set("Content-Security-Policy",
				"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
			if secure {
				h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireAuth validates the session cookie and injects the user id.
func RequireAuth(db *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c, err := r.Cookie(SessionCookie)
			if err != nil {
				unauthorized(w)
				return
			}
			uid, err := auth.ValidateSession(db, c.Value)
			if err != nil {
				unauthorized(w)
				return
			}
			ctx := context.WithValue(r.Context(), userIDKey, uid)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// CSRF enforces double-submit: mutating requests must echo the CSRF cookie in a
// header. Safe methods pass through untouched.
func CSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}
		cookie, err := r.Cookie(CSRFCookie)
		header := r.Header.Get(CSRFHeader)
		if err != nil || header == "" || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(header)) != 1 {
			http.Error(w, `{"code":"csrf_error","message":"invalid csrf token"}`, http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func unauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	http.Error(w, `{"code":"unauthorized","message":"not signed in"}`, http.StatusUnauthorized)
}

// RateLimit is a small fixed-window limiter keyed by client IP, used to blunt
// password brute-forcing on the login endpoint.
type RateLimit struct {
	mu     sync.Mutex
	hits   map[string][]time.Time
	limit  int
	window time.Duration
}

func NewRateLimit(limit int, window time.Duration) *RateLimit {
	return &RateLimit{hits: map[string][]time.Time{}, limit: limit, window: window}
}

func (rl *RateLimit) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		now := time.Now()
		rl.mu.Lock()
		recent := rl.hits[ip][:0:0]
		for _, t := range rl.hits[ip] {
			if now.Sub(t) < rl.window {
				recent = append(recent, t)
			}
		}
		if len(recent) >= rl.limit {
			rl.hits[ip] = recent
			rl.mu.Unlock()
			w.Header().Set("Retry-After", "60")
			http.Error(w, `{"code":"rate_limited","message":"too many attempts, try again later"}`, http.StatusTooManyRequests)
			return
		}
		rl.hits[ip] = append(recent, now)
		rl.mu.Unlock()
		next.ServeHTTP(w, r)
	})
}

// Recover turns panics into 500s instead of dropping the connection.
func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("panic: %v", rec)
				http.Error(w, `{"code":"server_error","message":"something went wrong"}`, http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// Logger writes one line per request.
func Logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
	})
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// Chain applies middleware in order (first listed runs outermost).
func Chain(h http.Handler, mw ...func(http.Handler) http.Handler) http.Handler {
	for i := len(mw) - 1; i >= 0; i-- {
		h = mw[i](h)
	}
	return h
}
