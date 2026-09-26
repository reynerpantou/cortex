package handlers

import (
	"context"
	"database/sql"
	"net/http"
	"strings"

	"github.com/reynerpantou/cortex/internal/middleware"
)

// uid is the signed-in user. Every finance query is scoped by it, so each
// account only ever sees and changes its own ledger.
func uid(r *http.Request) int64 {
	id, _ := middleware.UserIDFrom(r.Context())
	return id
}

// WithFinanceUser makes sure the signed-in user has a finance settings row
// and a starter set of categories and payment methods before any finance
// handler runs — the first visit to Finance sets an account up.
func (s *Server) WithFinanceUser(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := uid(r)
		if _, ok := s.financeReady.Load(u); !ok {
			if err := s.ensureFinanceUser(r.Context(), u); err != nil {
				writeError(w, http.StatusInternalServerError, "server_error", "could not set up finance for this account")
				return
			}
			s.financeReady.Store(u, true)
		}
		h(w, r)
	}
}

var starterCategories = []struct {
	kind, name, icon string
	subs             []string
}{
	{"expense", "Food", "🍜", []string{"Breakfast", "Lunch", "Dinner", "Eating out", "Groceries", "Coffee & snacks"}},
	{"expense", "Transport", "🛵", []string{"Fuel", "Ride-hailing", "Parking & tolls", "Public transport"}},
	{"expense", "Housing", "🏠", []string{"Rent", "Electricity", "Water", "Internet"}},
	{"expense", "Bills", "🧾", []string{"Phone", "Streaming", "Software", "Insurance"}},
	{"expense", "Shopping", "🛍️", []string{"Clothing", "Electronics", "Household"}},
	{"expense", "Health", "💊", []string{"Medicine", "Doctor", "Fitness"}},
	{"expense", "Entertainment", "🎬", []string{"Movies", "Games", "Hobbies"}},
	{"expense", "Travel", "✈️", []string{"Flights", "Hotels", "Activities"}},
	{"expense", "Education", "📚", []string{"Courses", "Books"}},
	{"expense", "Personal care", "💈", nil},
	{"expense", "Gifts & giving", "🎁", []string{"Gifts", "Donations"}},
	{"expense", "Other", "📦", nil},
	{"income", "Salary", "💼", nil},
	{"income", "Bonus", "🎉", nil},
	{"income", "Freelance", "🧑‍💻", nil},
	{"income", "Investment", "📈", []string{"Dividends", "Interest", "Capital gains"}},
	{"income", "Gift", "🎁", nil},
	{"income", "Refund", "↩️", nil},
	{"income", "Other", "📦", nil},
}

var starterMethods = []struct{ name, icon string }{
	{"Cash", "💵"}, {"Bank transfer", "🏦"}, {"Debit card", "💳"}, {"Credit card", "💳"},
	{"GoPay", "📱"}, {"OVO", "📱"}, {"ShopeePay", "📱"},
}

func (s *Server) ensureFinanceUser(ctx context.Context, userID int64) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `INSERT INTO finance_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return tx.Commit() // already set up
	}
	pos := map[string]int{}
	for _, c := range starterCategories {
		var id int64
		if err := tx.QueryRowContext(ctx,
			`INSERT INTO finance_categories (user_id, kind, name, icon, position) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
			userID, c.kind, c.name, c.icon, pos[c.kind],
		).Scan(&id); err != nil {
			return err
		}
		pos[c.kind]++
		for i, sub := range c.subs {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO finance_categories (user_id, kind, parent_id, name, position) VALUES ($1, $2, $3, $4, $5)`,
				userID, c.kind, id, sub, i,
			); err != nil {
				return err
			}
		}
	}
	for i, m := range starterMethods {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO finance_payment_methods (user_id, name, icon, position) VALUES ($1, $2, $3, $4)`,
			userID, m.name, m.icon, i,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ---- note suggestions ----

type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// refreshNotes rebuilds the suggestion rows for the given notes from the
// user's transactions, so the list reflects every insert, edit and delete:
// the most-used spelling, how often and how recently it was used, and the
// type/category/payment method of its latest use. Notes are normalized in
// SQL with the same expression as the note_key column, so the two can
// never disagree.
func refreshNotes(ctx context.Context, ex execer, userID int64, notes []string) error {
	if len(notes) == 0 {
		return nil
	}
	const keys = `SELECT DISTINCT lower(regexp_replace(btrim(x), '\s+', ' ', 'g')) FROM unnest($2::text[]) AS x`
	if _, err := ex.ExecContext(ctx,
		`DELETE FROM finance_notes WHERE user_id = $1 AND note_key IN (`+keys+`)`, userID, notes); err != nil {
		return err
	}
	_, err := ex.ExecContext(ctx,
		`INSERT INTO finance_notes (user_id, note_key, note, kind, category_id, payment_method_id, use_count, last_used)
		 SELECT $1, g.note_key,
		        (SELECT t.note FROM finance_transactions t
		          WHERE t.user_id = $1 AND t.note_key = g.note_key
		          GROUP BY t.note ORDER BY COUNT(*) DESC, MAX(t.id) DESC LIMIT 1),
		        last.kind, last.category_id, last.payment_method_id, g.n, g.last_used
		 FROM (SELECT note_key, COUNT(*) AS n, MAX(occurred_on) AS last_used
		         FROM finance_transactions
		        WHERE user_id = $1 AND note_key <> '' AND note_key IN (`+keys+`)
		        GROUP BY note_key) g
		 CROSS JOIN LATERAL (
		     SELECT t.kind, t.category_id, t.payment_method_id FROM finance_transactions t
		      WHERE t.user_id = $1 AND t.note_key = g.note_key
		      ORDER BY t.occurred_on DESC, t.id DESC LIMIT 1
		 ) last`, userID, notes)
	return err
}

// noteKey mirrors the note_key generated column: case and spacing ignored.
func noteKey(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(s), " "))
}

// noteListLimit caps how many suggestions the browser gets up front. Below
// it the page filters locally (instant, no request per keystroke); past it,
// the page falls back to server search for anything not in the list.
const noteListLimit = 1500

type noteSuggestion struct {
	Note            string `json:"note"`
	Kind            string `json:"kind"`
	CategoryID      *int64 `json:"category_id"`
	PaymentMethodID *int64 `json:"payment_method_id"`
	UseCount        int    `json:"use_count"`
	LastUsed        string `json:"last_used"`
}

// FinanceNotes lists the user's most-used notes, or with ?q= searches all
// of them (substring or typo-tolerant trigram match) for the long tail.
func (s *Server) FinanceNotes(w http.ResponseWriter, r *http.Request) {
	u := uid(r)
	q := noteKey(r.URL.Query().Get("q"))
	var (
		rows *sql.Rows
		err  error
	)
	const cols = `note, kind, category_id, payment_method_id, use_count, to_char(last_used, 'YYYY-MM-DD')`
	if q == "" {
		rows, err = s.DB.QueryContext(r.Context(),
			`SELECT `+cols+` FROM finance_notes WHERE user_id = $1
			 ORDER BY use_count DESC, last_used DESC LIMIT $2`, u, noteListLimit+1)
	} else {
		rows, err = s.DB.QueryContext(r.Context(),
			`SELECT `+cols+` FROM finance_notes
			 WHERE user_id = $1 AND (strpos(note_key, $2) > 0 OR note_key % $2)
			 ORDER BY starts_with(note_key, $2) DESC, similarity(note_key, $2) DESC, use_count DESC, last_used DESC
			 LIMIT 10`, u, q)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not load notes")
		return
	}
	defer rows.Close()
	out := []noteSuggestion{}
	for rows.Next() {
		var n noteSuggestion
		if err := rows.Scan(&n.Note, &n.Kind, &n.CategoryID, &n.PaymentMethodID, &n.UseCount, &n.LastUsed); err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "could not read notes")
			return
		}
		out = append(out, n)
	}
	truncated := q == "" && len(out) > noteListLimit
	if truncated {
		out = out[:noteListLimit]
	}
	writeJSON(w, http.StatusOK, map[string]any{"notes": out, "truncated": truncated})
}
