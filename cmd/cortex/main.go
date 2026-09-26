// Command cortex is a single binary that serves the JSON API and the embedded
// React SPA from one port, backed by Postgres.
package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
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
	if err := seedAdmin(db, cfg); err != nil {
		log.Fatalf("seed admin: %v", err)
	}
	go purgeSessions(db)

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           routes(db, cfg),
		ReadHeaderTimeout: 10 * time.Second,
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
	loginRL := middleware.NewRateLimit(10, time.Minute)
	protected := func(h http.HandlerFunc) http.Handler {
		return middleware.Chain(h, middleware.RequireAuth(db), middleware.CSRF)
	}

	api.Handle("POST /login", loginRL.Wrap(http.HandlerFunc(s.Login)))
	api.Handle("POST /logout", protected(s.Logout))
	api.Handle("GET /me", protected(s.Me))
	api.Handle("PUT /me", protected(s.UpdateMe))
	api.Handle("GET /nav", protected(s.GetNav))
	api.Handle("PUT /nav", protected(s.UpdateNav))
	api.Handle("GET /radar/stats", protected(s.Stats))
	api.Handle("GET /radar/problems", protected(s.ListProblems))
	api.Handle("POST /radar/problems", protected(s.CreateProblem))
	api.Handle("GET /radar/problems/{id}", protected(s.GetProblem))
	api.Handle("PUT /radar/problems/{id}", protected(s.UpdateProblem))
	api.Handle("DELETE /radar/problems/{id}", protected(s.DeleteProblem))
	api.Handle("POST /radar/problems/{id}/evidence", protected(s.CreateEvidence))
	api.Handle("DELETE /radar/problems/{id}/evidence/{eid}", protected(s.DeleteEvidence))
	api.Handle("POST /radar/problems/{id}/ai-summary", protected(s.RadarAISummary))

	api.Handle("GET /finance/meta", protected(s.FinanceMeta))
	api.Handle("PUT /finance/settings", protected(s.UpdateFinanceSettings))
	api.Handle("GET /finance/fx", protected(s.FinanceFX))
	api.Handle("POST /finance/categories", protected(s.CreateFinanceCategory))
	api.Handle("PUT /finance/categories/order", protected(s.ReorderFinanceCategories))
	api.Handle("PUT /finance/categories/{id}", protected(s.UpdateFinanceCategory))
	api.Handle("DELETE /finance/categories/{id}", protected(s.DeleteFinanceCategory))
	api.Handle("POST /finance/payment-methods", protected(s.CreateFinancePaymentMethod))
	api.Handle("PUT /finance/payment-methods/order", protected(s.ReorderFinancePaymentMethods))
	api.Handle("PUT /finance/payment-methods/{id}", protected(s.UpdateFinancePaymentMethod))
	api.Handle("DELETE /finance/payment-methods/{id}", protected(s.DeleteFinancePaymentMethod))
	api.Handle("GET /finance/transactions", protected(s.ListFinanceTransactions))
	api.Handle("POST /finance/transactions", protected(s.CreateFinanceTransaction))
	api.Handle("POST /finance/transactions/bulk", protected(s.BulkCreateFinanceTransactions))
	api.Handle("PUT /finance/transactions/{id}", protected(s.UpdateFinanceTransaction))
	api.Handle("DELETE /finance/transactions/{id}", protected(s.DeleteFinanceTransaction))
	api.Handle("GET /finance/stats", protected(s.FinanceStats))
	api.Handle("GET /finance/trend", protected(s.FinanceTrend))
	api.Handle("GET /finance/budgets", protected(s.FinanceBudgets))
	api.Handle("PUT /finance/budgets/{id}", protected(s.SetFinanceBudget))

	mux := http.NewServeMux()
	mux.Handle("/api/", http.StripPrefix("/api", api))
	mux.Handle("/", s.SPAHandler())

	return middleware.Chain(mux,
		middleware.Recover,
		middleware.Logger,
		middleware.SecurityHeaders(cfg.CookieSecure),
	)
}

// seedAdmin creates the first user on an empty database. If no password is
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
		`INSERT INTO users (username, password_hash, created_at) VALUES ($1, $2, $3)`,
		cfg.AdminUser, hash, time.Now().UTC(),
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
	}
}
