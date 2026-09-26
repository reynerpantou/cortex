// Command cortex is a single binary that serves the JSON API and the embedded
// React SPA from one port, backed by Postgres.
package main

import (
	"bufio"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
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
		if err := runCommand(db, os.Args[1:]); err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}
		return
	}
	if err := seedAdmin(db, cfg); err != nil {
		log.Fatalf("seed admin: %v", err)
	}
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
	// A coarse per-IP ceiling in front of the database-backed sign-in
	// throttle, so a flood can't even reach it.
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

	api.Handle("POST /login", loginRL.Wrap(http.HandlerFunc(s.Login)))
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

// seedAdmin creates the first user — the owner — on an empty database. If no password is
// provided it generates one and prints it once.
func seedAdmin(db *sql.DB, cfg config.Config) error {
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	password := cfg.AdminPassword
	generated := false
	if password == "" {
		tok, err := auth.NewToken()
		if err != nil {
			return err
		}
		password = tok[:16]
		generated = true
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	if _, err := db.Exec(
		`INSERT INTO users (username, password_hash, created_at, display_name_en, display_name_id, display_name_zh, is_admin, is_owner, modules)
		 VALUES ($1, $2, $3, $1, $1, $1, true, true, $4)`,
		cfg.AdminUser, hash, time.Now().UTC(), handlers.Modules,
	); err != nil {
		return err
	}
	if generated {
		fmt.Fprintf(os.Stderr, "\n  Created user %q with generated password: %s\n  Save it now; it will not be shown again.\n\n", cfg.AdminUser, password)
	} else {
		log.Printf("created user %q from CORTEX_ADMIN_PASSWORD", cfg.AdminUser)
	}
	return nil
}

func purgeSessions(db *sql.DB) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		if err := auth.PurgeExpiredSessions(db); err != nil {
			log.Printf("purge sessions: %v", err)
		}
		// Sign-in counters nobody has touched for two days are over: their
		// failure window and cooldown memory have both lapsed.
		if _, err := db.Exec(`DELETE FROM login_throttle WHERE updated_at < now() - interval '2 days'
		                        AND (locked_until IS NULL OR locked_until < now())`); err != nil {
			log.Printf("purge sign-in throttle: %v", err)
		}
	}
}

const usage = `usage:
  cortex                            run the server
  cortex reset-password <username>  set a new password (prompted) and sign the account out everywhere
  cortex make-owner <username>      make this account the owner (the previous owner stays an administrator)
  cortex unlock <username>          clear failed sign-in cooldowns for this account`

func runCommand(db *sql.DB, args []string) error {
	if len(args) != 2 {
		return fmt.Errorf("%s", usage)
	}
	var id int64
	if err := db.QueryRow(`SELECT id FROM users WHERE lower(username) = lower($1)`, args[1]).Scan(&id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("no user %q", args[1])
		}
		return err
	}
	switch args[0] {
	case "reset-password":
		password, err := readPassword()
		if err != nil {
			return err
		}
		hash, err := auth.HashPassword(password)
		if err != nil {
			return err
		}
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if _, err := tx.Exec(`UPDATE users SET password_hash = $1 WHERE id = $2`, hash, id); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM sessions WHERE user_id = $1`, id); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM login_throttle WHERE key LIKE 'ui:' || lower($1) || '|%' OR key = 'u:' || lower($1)`, args[1]); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		fmt.Printf("Password for %q changed; every session was signed out.\n", args[1])
	case "make-owner":
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
	case "unlock":
		if _, err := db.Exec(`DELETE FROM login_throttle WHERE key LIKE 'ui:' || lower($1) || '|%' OR key = 'u:' || lower($1)`, args[1]); err != nil {
			return err
		}
		fmt.Printf("Sign-in cooldowns for %q cleared.\n", args[1])
	default:
		return fmt.Errorf("%s", usage)
	}
	return nil
}

// readPassword takes the new password from CORTEX_NEW_PASSWORD or stdin, so
// it never ends up in shell history as an argument.
func readPassword() (string, error) {
	p := os.Getenv("CORTEX_NEW_PASSWORD")
	if p == "" {
		fmt.Fprint(os.Stderr, "New password: ")
		line, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err != nil && line == "" {
			return "", err
		}
		p = strings.TrimRight(line, "\r\n")
	}
	if len(p) < 8 {
		return "", errors.New("password must be at least 8 characters")
	}
	return p, nil
}
