// Command cortex is a single binary that serves the JSON API and the embedded
// React SPA from one port, backed by Postgres.
package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/mail"
	"os"
	"os/signal"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/reynerpantou/cortex/internal/auth"
	"github.com/reynerpantou/cortex/internal/config"
	"github.com/reynerpantou/cortex/internal/database"
	"github.com/reynerpantou/cortex/internal/handlers"
	"github.com/reynerpantou/cortex/internal/middleware"
)

func main() {
	cfg := config.Load()
	if len(os.Args) == 1 {
		reportSignIn(cfg)
	}

	db, err := database.Open(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer db.Close()

	if err := database.Migrate(db); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	// Server-side recovery commands. They need shell access to the server,
	// which is exactly what makes them the right place for owner recovery.
	if len(os.Args) > 1 {
		if err := runCommand(db, cfg, os.Args[1:]); err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}
		return
	}
	announceSetup(db, cfg)
	go purgeSessions(db)

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           routes(db, cfg),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      90 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    64 << 10,
	}

	go func() {
		log.Printf("cortex listening on %s", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("serve: %v", err)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()
	log.Println("shutting down")
	shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutCtx)
}

func routes(db *sql.DB, cfg config.Config) http.Handler {
	s := handlers.New(db, cfg)

	api := http.NewServeMux()
	// A per-IP ceiling on sign-in requests. There are no passwords to guess
	// any more; this just keeps floods off the database and the providers.
	loginRL := middleware.NewRateLimit(20, time.Minute, s.ClientIP)
	protected := func(h http.HandlerFunc) http.Handler {
		return middleware.Chain(h, middleware.RequireAuth(db), middleware.CSRF)
	}
	// Module routes also check the account was granted that module; finance
	// additionally makes sure the account's own ledger exists first.
	radar := func(h http.HandlerFunc) http.Handler { return protected(s.RequireModule("radar", h)) }
	finance := func(h http.HandlerFunc) http.Handler {
		return protected(s.RequireModule("finance", s.WithFinanceUser(h)))
	}
	admin := func(h http.HandlerFunc) http.Handler { return protected(s.RequireAdmin(h)) }

	api.Handle("GET /auth/providers", http.HandlerFunc(s.AuthProviders))
	// Start and callback are pages the browser navigates to, so hitting the
	// limit lands back on the sign-in page with a message.
	limited := http.RedirectHandler("/login?error=rate_limited", http.StatusSeeOther)
	api.Handle("GET /auth/{provider}/start", loginRL.WrapWith(http.HandlerFunc(s.AuthStart), limited))
	api.Handle("GET /auth/{provider}/callback", loginRL.WrapWith(http.HandlerFunc(s.AuthCallback), limited))
	api.Handle("POST /auth/{provider}/callback", loginRL.WrapWith(http.HandlerFunc(s.AuthCallback), limited))
	api.Handle("POST /auth/link", loginRL.Wrap(http.HandlerFunc(s.AuthLink)))
	api.Handle("POST /setup/start", loginRL.Wrap(http.HandlerFunc(s.SetupStart)))
	api.Handle("POST /logout", protected(s.Logout))
	api.Handle("GET /me", protected(s.Me))
	api.Handle("PUT /me", protected(s.UpdateMe))
	api.Handle("GET /nav", protected(s.GetNav))
	api.Handle("PUT /nav", protected(s.UpdateNav))
	api.Handle("GET /admin/users", admin(s.AdminListUsers))
	api.Handle("POST /admin/users", admin(s.AdminCreateUser))
	api.Handle("PUT /admin/users/{id}", admin(s.AdminUpdateUser))
	api.Handle("DELETE /admin/users/{id}", admin(s.AdminDeleteUser))
	api.Handle("GET /radar/stats", radar(s.Stats))
	api.Handle("GET /radar/problems", radar(s.ListProblems))
	api.Handle("POST /radar/problems", radar(s.CreateProblem))
	api.Handle("GET /radar/problems/{id}", radar(s.GetProblem))
	api.Handle("PUT /radar/problems/{id}", radar(s.UpdateProblem))
	api.Handle("DELETE /radar/problems/{id}", radar(s.DeleteProblem))
	api.Handle("POST /radar/problems/{id}/evidence", radar(s.CreateEvidence))
	api.Handle("DELETE /radar/problems/{id}/evidence/{eid}", radar(s.DeleteEvidence))
	api.Handle("POST /radar/problems/{id}/ai-summary", radar(s.RadarAISummary))

	api.Handle("GET /finance/meta", finance(s.FinanceMeta))
	api.Handle("PUT /finance/settings/base-currency", finance(s.ChangeBaseCurrency))
	api.Handle("PUT /finance/settings/stats-layout", finance(s.UpdateStatsLayout))
	api.Handle("GET /finance/fx", finance(s.FinanceFX))
	api.Handle("GET /finance/notes", finance(s.FinanceNotes))
	api.Handle("POST /finance/categories", finance(s.CreateFinanceCategory))
	api.Handle("PUT /finance/categories/order", finance(s.ReorderFinanceCategories))
	api.Handle("PUT /finance/categories/{id}", finance(s.UpdateFinanceCategory))
	api.Handle("DELETE /finance/categories/{id}", finance(s.DeleteFinanceCategory))
	api.Handle("POST /finance/payment-methods", finance(s.CreateFinancePaymentMethod))
	api.Handle("PUT /finance/payment-methods/order", finance(s.ReorderFinancePaymentMethods))
	api.Handle("PUT /finance/payment-methods/{id}", finance(s.UpdateFinancePaymentMethod))
	api.Handle("DELETE /finance/payment-methods/{id}", finance(s.DeleteFinancePaymentMethod))
	api.Handle("GET /finance/transactions", finance(s.ListFinanceTransactions))
	api.Handle("POST /finance/transactions", finance(s.CreateFinanceTransaction))
	api.Handle("POST /finance/transactions/bulk", finance(s.BulkCreateFinanceTransactions))
	api.Handle("PUT /finance/transactions/{id}", finance(s.UpdateFinanceTransaction))
	api.Handle("DELETE /finance/transactions/{id}", finance(s.DeleteFinanceTransaction))
	api.Handle("GET /finance/stats", finance(s.FinanceStats))
	api.Handle("GET /finance/trend", finance(s.FinanceTrend))
	api.Handle("GET /finance/budgets", finance(s.FinanceBudgets))
	api.Handle("PUT /finance/budgets/{id}", finance(s.SetFinanceBudget))

	mux := http.NewServeMux()
	mux.Handle("/api/", http.StripPrefix("/api", middleware.NoStore(api)))
	mux.Handle("/", s.SPAHandler())

	return middleware.Chain(mux,
		middleware.Recover,
		middleware.Logger,
		middleware.SecurityHeaders(cfg.CookieSecure),
	)
}

// reportSignIn says at startup which sign-in buttons will show, and what's
// missing when a provider is only partly configured.
func reportSignIn(cfg config.Config) {
	var on []string
	if cfg.GoogleClientID != "" && cfg.GoogleClientSecret != "" {
		on = append(on, "Google")
	} else if cfg.GoogleClientID != "" || cfg.GoogleClientSecret != "" {
		log.Printf("sign-in: Google is OFF — set both CORTEX_GOOGLE_CLIENT_ID and CORTEX_GOOGLE_CLIENT_SECRET")
	}
	apple := []string{cfg.AppleClientID, cfg.AppleTeamID, cfg.AppleKeyID, cfg.ApplePrivateKey}
	switch n := len(slices.DeleteFunc(slices.Clone(apple), func(v string) bool { return v == "" })); n {
	case 4:
		on = append(on, "Apple")
	case 0:
	default:
		log.Printf("sign-in: Apple is OFF — set all of CORTEX_APPLE_CLIENT_ID, _TEAM_ID, _KEY_ID and _PRIVATE_KEY")
	}
	if len(on) == 0 {
		log.Printf("sign-in: no provider configured, so no sign-in buttons will show — add CORTEX_GOOGLE_CLIENT_ID and CORTEX_GOOGLE_CLIENT_SECRET to .env")
		return
	}
	log.Printf("sign-in: %s (callbacks go to %s/api/auth/…/callback)", strings.Join(on, " + "), cfg.PublicURL)
}

// announceSetup prints a fresh owner setup link while nobody can sign in
// as the owner (a new install). There's nothing to configure: open the link,
// sign in with Google or Apple, and that account is the owner.
func announceSetup(db *sql.DB, cfg config.Config) {
	link, err := handlers.NewSetupLink(context.Background(), db, cfg.PublicURL)
	if err != nil {
		log.Printf("owner setup: %v", err)
		return
	}
	if link == "" {
		return
	}
	log.Printf(`
  ┌─ Cortex has no owner yet ──────────────────────────────────────────
  │ Open this link and sign in with Google or Apple to become the owner:
  │
  │   %s
  │
  │ It works once and expires in 24 hours. A new one is printed on every
  │ start until someone claims it (or run: cortex setup-link).
  └────────────────────────────────────────────────────────────────────`, link)
}

func purgeSessions(db *sql.DB) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		if err := auth.PurgeExpiredSessions(db); err != nil {
			log.Printf("purge sessions: %v", err)
		}
		// Abandoned sign-ins and unused sign-in links.
		for _, q := range []string{
			`DELETE FROM auth_flows WHERE expires_at < now()`,
			`DELETE FROM sign_in_links WHERE expires_at < now()`,
		} {
			if _, err := db.Exec(q); err != nil {
				log.Printf("purge sign-in state: %v", err)
			}
		}
	}
}

const usage = `usage:
  cortex                               run the server
  cortex setup-link                    print a new owner setup link (only while nobody can sign in as owner)
  cortex list-users                    list accounts (username, email, role)
  cortex sign-in-link <username>       print a one-time sign-in link (valid 15 minutes)
  cortex set-email <username> <email>  change who can sign in as this account (unlinks Google/Apple, signs out everywhere)
  cortex make-owner <username>         make this account the owner (the previous owner stays an administrator)`

func runCommand(db *sql.DB, cfg config.Config, args []string) error {
	if len(args) == 1 && args[0] == "setup-link" {
		link, err := handlers.NewSetupLink(context.Background(), db, cfg.PublicURL)
		if err != nil {
			return err
		}
		if link == "" {
			return errors.New("Cortex already has an owner who can sign in; use sign-in-link for recovery")
		}
		fmt.Printf("Owner setup link (valid 24 hours, replaces any earlier one):\n\n  %s\n\n", link)
		return nil
	}
	if len(args) == 1 && args[0] == "list-users" {
		rows, err := db.Query(`SELECT username, COALESCE(email, '—'), CASE WHEN is_owner THEN 'owner' WHEN is_admin THEN 'admin' ELSE 'member' END
		                       FROM users ORDER BY is_owner DESC, is_admin DESC, lower(username)`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var u, e, role string
			if err := rows.Scan(&u, &e, &role); err != nil {
				return err
			}
			fmt.Printf("%-24s %-36s %s\n", u, e, role)
		}
		return rows.Err()
	}
	if len(args) < 2 {
		return fmt.Errorf("%s", usage)
	}
	var id int64
	if err := db.QueryRow(`SELECT id FROM users WHERE lower(username) = lower($1)`, args[1]).Scan(&id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("no user %q", args[1])
		}
		return err
	}
	switch {
	case args[0] == "sign-in-link" && len(args) == 2:
		link, err := handlers.NewSignInLink(db, cfg.PublicURL, id)
		if err != nil {
			return err
		}
		fmt.Printf("One-time sign-in link for %q (valid 15 minutes):\n\n  %s\n\n", args[1], link)
	case args[0] == "set-email" && len(args) == 3:
		email := strings.ToLower(strings.TrimSpace(args[2]))
		if a, err := mail.ParseAddress(email); err != nil || a.Address != email {
			return fmt.Errorf("%q is not a valid email address", args[2])
		}
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		for _, q := range []string{
			`UPDATE users SET email = $2 WHERE id = $1`,
			`DELETE FROM user_identities WHERE user_id = $1`,
			`DELETE FROM sessions WHERE user_id = $1`,
		} {
			args := []any{id}
			if strings.Contains(q, "$2") {
				args = append(args, email)
			}
			if _, err := tx.Exec(q, args...); err != nil {
				return err
			}
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		fmt.Printf("%q now signs in as %s; old sign-ins and sessions were removed.\n", args[1], email)
	case args[0] == "make-owner" && len(args) == 2:
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if _, err := tx.Exec(`UPDATE users SET is_owner = false WHERE is_owner`); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE users SET is_owner = true, is_admin = true, modules = $2 WHERE id = $1`, id, handlers.Modules); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		fmt.Printf("%q is now the owner.\n", args[1])
	default:
		return fmt.Errorf("%s", usage)
	}
	return nil
}
