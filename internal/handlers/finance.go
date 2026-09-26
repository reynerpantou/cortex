package handlers

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/reynerpantou/cortex/internal/models"
)

const dateLayout = "2006-01-02"

var currencyRe = regexp.MustCompile(`^[A-Z]{3}$`)

func (s *Server) baseCurrency(ctx context.Context) (string, error) {
	var base string
	err := s.DB.QueryRowContext(ctx, `SELECT base_currency FROM finance_settings WHERE id = 1`).Scan(&base)
	return base, err
}

func (s *Server) loadCategories(ctx context.Context) ([]models.FinanceCategory, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, kind, parent_id, name, icon, position, archived FROM finance_categories
		 ORDER BY kind, parent_id NULLS FIRST, position, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.FinanceCategory{}
	for rows.Next() {
		var c models.FinanceCategory
		if err := rows.Scan(&c.ID, &c.Kind, &c.ParentID, &c.Name, &c.Icon, &c.Position, &c.Archived); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Server) loadPaymentMethods(ctx context.Context) ([]models.FinancePaymentMethod, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, name, icon, position, archived FROM finance_payment_methods ORDER BY position, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.FinancePaymentMethod{}
	for rows.Next() {
		var p models.FinancePaymentMethod
		if err := rows.Scan(&p.ID, &p.Name, &p.Icon, &p.Position, &p.Archived); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// FinanceMeta returns everything the Finance pickers need in one call:
// base currency, supported currencies, categories (flat; parent_id links
// subcategories) and payment methods — archived ones included so history
// can still show their names.
func (s *Server) FinanceMeta(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	base, err := s.baseCurrency(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not load settings")
		return
	}
	cats, err := s.loadCategories(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not load categories")
		return
	}
	pms, err := s.loadPaymentMethods(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not load payment methods")
		return
	}
	var txCount int
	_ = s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM finance_transactions`).Scan(&txCount)
	writeJSON(w, http.StatusOK, map[string]any{
		"base_currency":    base,
		"currencies":       fxCurrencies,
		"categories":       cats,
		"payment_methods":  pms,
		"has_transactions": txCount > 0,
	})
}

func (s *Server) UpdateFinanceSettings(w http.ResponseWriter, r *http.Request) {
	var in struct {
		BaseCurrency string `json:"base_currency"`
	}
	if err := decode(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "could not read settings")
		return
	}
	in.BaseCurrency = strings.ToUpper(strings.TrimSpace(in.BaseCurrency))
	if !currencyRe.MatchString(in.BaseCurrency) {
		writeError(w, http.StatusBadRequest, "validation_error", "invalid currency")
		return
	}
	var txCount int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM finance_transactions`).Scan(&txCount); err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save settings")
		return
	}
	current, _ := s.baseCurrency(r.Context())
	if txCount > 0 && current != in.BaseCurrency {
		writeError(w, http.StatusConflict, "ledger_not_empty", "base currency can only change while there are no transactions")
		return
	}
	if _, err := s.DB.Exec(`UPDATE finance_settings SET base_currency = $1 WHERE id = 1`, in.BaseCurrency); err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save settings")
		return
	}
	s.FinanceMeta(w, r)
}

// ---- categories ----

type categoryInput struct {
	Kind     models.FinanceKind `json:"kind"`
	ParentID *int64             `json:"parent_id"`
	Name     string             `json:"name"`
	Icon     string             `json:"icon"`
}

func (s *Server) CreateFinanceCategory(w http.ResponseWriter, r *http.Request) {
	var in categoryInput
	if err := decode(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "could not read the category")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Icon = strings.TrimSpace(in.Icon)
	if in.Name == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "name is required")
		return
	}
	if in.ParentID != nil {
		var parentKind models.FinanceKind
		var grandparent *int64
		err := s.DB.QueryRow(`SELECT kind, parent_id FROM finance_categories WHERE id = $1`, *in.ParentID).Scan(&parentKind, &grandparent)
		if err == sql.ErrNoRows || grandparent != nil {
			writeError(w, http.StatusBadRequest, "validation_error", "subcategories can only sit under a top-level category")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "could not save the category")
			return
		}
		in.Kind = parentKind
	}
	if !in.Kind.Valid() {
		writeError(w, http.StatusBadRequest, "validation_error", "kind must be 'income' or 'expense'")
		return
	}
	var c models.FinanceCategory
	err := s.DB.QueryRow(
		`INSERT INTO finance_categories (kind, parent_id, name, icon, position)
		 VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(position) + 1, 0) FROM finance_categories
		                          WHERE kind = $1 AND parent_id IS NOT DISTINCT FROM $2))
		 RETURNING id, kind, parent_id, name, icon, position, archived`,
		in.Kind, in.ParentID, in.Name, in.Icon,
	).Scan(&c.ID, &c.Kind, &c.ParentID, &c.Name, &c.Icon, &c.Position, &c.Archived)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save the category")
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

type renameInput struct {
	Name     string `json:"name"`
	Icon     string `json:"icon"`
	Archived bool   `json:"archived"`
}

func (s *Server) UpdateFinanceCategory(w http.ResponseWriter, r *http.Request) {
	s.renameRow(w, r, "finance_categories", "category")
}

func (s *Server) UpdateFinancePaymentMethod(w http.ResponseWriter, r *http.Request) {
	s.renameRow(w, r, "finance_payment_methods", "payment method")
}

// renameRow updates the user-editable label fields shared by categories and
// payment methods. table is always one of two constants, never user input.
func (s *Server) renameRow(w http.ResponseWriter, r *http.Request, table, noun string) {
	id, ok := pathID(r, "id")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid id")
		return
	}
	var in renameInput
	if err := decode(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "could not read the "+noun)
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Icon = strings.TrimSpace(in.Icon)
	if in.Name == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "name is required")
		return
	}
	res, err := s.DB.Exec(`UPDATE `+table+` SET name = $1, icon = $2, archived = $3 WHERE id = $4`, in.Name, in.Icon, in.Archived, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save the "+noun)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "not_found", noun+" not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteFinanceCategory deletes a category (and its subcategories) outright
// when nothing references it; otherwise it archives them, so past
// transactions keep their label but the category leaves every picker.
func (s *Server) DeleteFinanceCategory(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid id")
		return
	}
	var used int
	err := s.DB.QueryRow(
		`SELECT COUNT(*) FROM finance_transactions WHERE category_id IN
		   (SELECT id FROM finance_categories WHERE id = $1 OR parent_id = $1)`, id,
	).Scan(&used)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not remove the category")
		return
	}
	var res sql.Result
	if used > 0 {
		res, err = s.DB.Exec(`UPDATE finance_categories SET archived = true WHERE id = $1 OR parent_id = $1`, id)
	} else {
		res, err = s.DB.Exec(`DELETE FROM finance_categories WHERE id = $1`, id)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not remove the category")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "not_found", "category not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"archived": used > 0})
}

type reorderInput struct {
	IDs []int64 `json:"ids"`
}

func (s *Server) ReorderFinanceCategories(w http.ResponseWriter, r *http.Request) {
	s.reorder(w, r, "finance_categories")
}

func (s *Server) ReorderFinancePaymentMethods(w http.ResponseWriter, r *http.Request) {
	s.reorder(w, r, "finance_payment_methods")
}

// reorder sets position to each id's index in the given list. table is
// always one of two constants, never user input.
func (s *Server) reorder(w http.ResponseWriter, r *http.Request, table string) {
	var in reorderInput
	if err := decode(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "could not read the order")
		return
	}
	tx, err := s.DB.Begin()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save the order")
		return
	}
	defer tx.Rollback()
	for i, id := range in.IDs {
		if _, err := tx.Exec(`UPDATE `+table+` SET position = $1 WHERE id = $2`, i, id); err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "could not save the order")
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save the order")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- payment methods ----

func (s *Server) CreateFinancePaymentMethod(w http.ResponseWriter, r *http.Request) {
	var in renameInput
	if err := decode(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "could not read the payment method")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Icon = strings.TrimSpace(in.Icon)
	if in.Name == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "name is required")
		return
	}
	var p models.FinancePaymentMethod
	err := s.DB.QueryRow(
		`INSERT INTO finance_payment_methods (name, icon, position)
		 VALUES ($1, $2, (SELECT COALESCE(MAX(position) + 1, 0) FROM finance_payment_methods))
		 RETURNING id, name, icon, position, archived`,
		in.Name, in.Icon,
	).Scan(&p.ID, &p.Name, &p.Icon, &p.Position, &p.Archived)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save the payment method")
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) DeleteFinancePaymentMethod(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid id")
		return
	}
	var used int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM finance_transactions WHERE payment_method_id = $1`, id).Scan(&used); err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not remove the payment method")
		return
	}
	var res sql.Result
	var err error
	if used > 0 {
		res, err = s.DB.Exec(`UPDATE finance_payment_methods SET archived = true WHERE id = $1`, id)
	} else {
		res, err = s.DB.Exec(`DELETE FROM finance_payment_methods WHERE id = $1`, id)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not remove the payment method")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "not_found", "payment method not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"archived": used > 0})
}

// ---- transactions ----

const txColumns = `id, kind, to_char(occurred_on, 'YYYY-MM-DD'), amount, currency, rate, base_amount,
	category_id, payment_method_id, note, source, external_id`

func scanTx(row rowScanner) (models.FinanceTransaction, error) {
	var t models.FinanceTransaction
	err := row.Scan(&t.ID, &t.Kind, &t.OccurredOn, &t.Amount, &t.Currency, &t.Rate, &t.BaseAmount,
		&t.CategoryID, &t.PaymentMethodID, &t.Note, &t.Source, &t.ExternalID)
	return t, err
}

type txInput struct {
	Kind            models.FinanceKind   `json:"kind"`
	OccurredOn      string               `json:"occurred_on"`
	Amount          float64              `json:"amount"`
	Currency        string               `json:"currency"`
	Rate            float64              `json:"rate"`
	CategoryID      *int64               `json:"category_id"`
	PaymentMethodID *int64               `json:"payment_method_id"`
	Note            string               `json:"note"`
	Source          models.FinanceSource `json:"source"`
	ExternalID      *string              `json:"external_id"`

	baseAmount float64
}

// txRefs is the lookup data validation needs, loaded once per request so a
// bulk save of hundreds of rows doesn't query per row.
type txRefs struct {
	base       string
	categories map[int64]models.FinanceKind
	methods    map[int64]bool
}

func (s *Server) loadTxRefs(ctx context.Context) (txRefs, error) {
	refs := txRefs{categories: map[int64]models.FinanceKind{}, methods: map[int64]bool{}}
	var err error
	if refs.base, err = s.baseCurrency(ctx); err != nil {
		return refs, err
	}
	cats, err := s.loadCategories(ctx)
	if err != nil {
		return refs, err
	}
	for _, c := range cats {
		refs.categories[c.ID] = c.Kind
	}
	pms, err := s.loadPaymentMethods(ctx)
	if err != nil {
		return refs, err
	}
	for _, p := range pms {
		refs.methods[p.ID] = true
	}
	return refs, nil
}

// prepare normalizes and validates one transaction, resolving a missing
// exchange rate from the daily reference rate, and computes its base amount.
func (s *Server) prepareTx(ctx context.Context, in *txInput, refs txRefs) string {
	in.Currency = strings.ToUpper(strings.TrimSpace(in.Currency))
	if in.Currency == "" {
		in.Currency = refs.base
	}
	in.Note = strings.TrimSpace(in.Note)
	if in.Source == "" {
		in.Source = models.FinanceSourceManual
	}
	if in.ExternalID != nil {
		if v := strings.TrimSpace(*in.ExternalID); v == "" {
			in.ExternalID = nil
		} else {
			in.ExternalID = &v
		}
	}
	day, err := time.Parse(dateLayout, in.OccurredOn)
	switch {
	case !in.Kind.Valid():
		return "type must be income or expense"
	case err != nil:
		return "date must be YYYY-MM-DD"
	case !(in.Amount > 0) || in.Amount >= 1e14:
		return "amount must be greater than zero"
	case !currencyRe.MatchString(in.Currency):
		return "currency must be a 3-letter code"
	case !in.Source.Valid():
		return "invalid source"
	case len(in.Note) > 2000:
		return "note is too long"
	}
	if in.CategoryID != nil {
		kind, ok := refs.categories[*in.CategoryID]
		if !ok {
			return "unknown category"
		}
		if kind != in.Kind {
			return "category doesn't match the transaction type"
		}
	}
	if in.PaymentMethodID != nil && !refs.methods[*in.PaymentMethodID] {
		return "unknown payment method"
	}
	switch {
	case in.Currency == refs.base:
		in.Rate = 1
	case in.Rate > 0:
	default:
		rate, _, err := s.fxRate(ctx, in.Currency, refs.base, day)
		if err != nil {
			return fmt.Sprintf("no exchange rate available for %s — enter one manually", in.Currency)
		}
		in.Rate = rate
	}
	in.baseAmount = math.Round(in.Amount*in.Rate*100) / 100
	return ""
}

func (s *Server) ListFinanceTransactions(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from, to, ok := dateRange(q.Get("from"), q.Get("to"))
	if !ok {
		writeError(w, http.StatusBadRequest, "validation_error", "from/to must be YYYY-MM-DD")
		return
	}
	args := []any{from, to}
	param := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	where := []string{"occurred_on BETWEEN $1 AND $2"}
	if v := q.Get("kind"); v != "" {
		where = append(where, "kind = "+param(v))
	}
	if v := q.Get("category_id"); v != "" {
		id, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "validation_error", "invalid category_id")
			return
		}
		p := param(id)
		where = append(where, "category_id IN (SELECT id FROM finance_categories WHERE id = "+p+" OR parent_id = "+p+")")
	}
	if v := q.Get("payment_method_id"); v != "" {
		id, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "validation_error", "invalid payment_method_id")
			return
		}
		where = append(where, "payment_method_id = "+param(id))
	}
	if v := strings.TrimSpace(q.Get("q")); v != "" {
		where = append(where, "note ILIKE "+param("%"+v+"%"))
	}
	rows, err := s.DB.QueryContext(r.Context(),
		`SELECT `+txColumns+` FROM finance_transactions WHERE `+strings.Join(where, " AND ")+
			` ORDER BY occurred_on DESC, id DESC`, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not load transactions")
		return
	}
	defer rows.Close()
	out := []models.FinanceTransaction{}
	for rows.Next() {
		t, err := scanTx(rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "could not read transactions")
			return
		}
		out = append(out, t)
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) CreateFinanceTransaction(w http.ResponseWriter, r *http.Request) {
	var in txInput
	if err := decode(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "could not read the transaction")
		return
	}
	refs, err := s.loadTxRefs(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save the transaction")
		return
	}
	if msg := s.prepareTx(r.Context(), &in, refs); msg != "" {
		writeError(w, http.StatusBadRequest, "validation_error", msg)
		return
	}
	t, err := scanTx(s.DB.QueryRow(
		`INSERT INTO finance_transactions (kind, occurred_on, amount, currency, rate, base_amount, category_id, payment_method_id, note, source, external_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING `+txColumns,
		in.Kind, in.OccurredOn, in.Amount, in.Currency, in.Rate, in.baseAmount, in.CategoryID, in.PaymentMethodID, in.Note, in.Source, in.ExternalID,
	))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save the transaction")
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

type rowError struct {
	Index   int    `json:"index"`
	Message string `json:"message"`
}

// BulkCreateFinanceTransactions saves many rows at once (the bulk grid and
// CSV import both use it). It's all-or-nothing: every row is validated
// first, and any failure returns per-row errors with nothing saved. Rows
// whose (source, external_id) already exist are skipped, not duplicated.
func (s *Server) BulkCreateFinanceTransactions(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Transactions []txInput `json:"transactions"`
	}
	dec := decodeLarge(r, &in)
	if dec != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "could not read the transactions")
		return
	}
	if len(in.Transactions) == 0 || len(in.Transactions) > 2000 {
		writeError(w, http.StatusBadRequest, "validation_error", "send between 1 and 2000 transactions")
		return
	}
	refs, err := s.loadTxRefs(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save the transactions")
		return
	}
	var rowErrs []rowError
	for i := range in.Transactions {
		if msg := s.prepareTx(r.Context(), &in.Transactions[i], refs); msg != "" {
			rowErrs = append(rowErrs, rowError{Index: i, Message: msg})
		}
	}
	if len(rowErrs) > 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"code":       "validation_error",
			"message":    fmt.Sprintf("%d row(s) need fixing", len(rowErrs)),
			"row_errors": rowErrs,
		})
		return
	}

	tx, err := s.DB.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save the transactions")
		return
	}
	defer tx.Rollback()
	created := 0
	for _, t := range in.Transactions {
		res, err := tx.Exec(
			`INSERT INTO finance_transactions (kind, occurred_on, amount, currency, rate, base_amount, category_id, payment_method_id, note, source, external_id)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			 ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL DO NOTHING`,
			t.Kind, t.OccurredOn, t.Amount, t.Currency, t.Rate, t.baseAmount, t.CategoryID, t.PaymentMethodID, t.Note, t.Source, t.ExternalID,
		)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "could not save the transactions")
			return
		}
		n, _ := res.RowsAffected()
		created += int(n)
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save the transactions")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]int{"created": created, "skipped": len(in.Transactions) - created})
}

func (s *Server) UpdateFinanceTransaction(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid id")
		return
	}
	var in txInput
	if err := decode(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "could not read the transaction")
		return
	}
	refs, err := s.loadTxRefs(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save the transaction")
		return
	}
	if msg := s.prepareTx(r.Context(), &in, refs); msg != "" {
		writeError(w, http.StatusBadRequest, "validation_error", msg)
		return
	}
	t, err := scanTx(s.DB.QueryRow(
		`UPDATE finance_transactions SET kind=$1, occurred_on=$2, amount=$3, currency=$4, rate=$5, base_amount=$6,
		 category_id=$7, payment_method_id=$8, note=$9, updated_at=now()
		 WHERE id=$10 RETURNING `+txColumns,
		in.Kind, in.OccurredOn, in.Amount, in.Currency, in.Rate, in.baseAmount, in.CategoryID, in.PaymentMethodID, in.Note, id,
	))
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "not_found", "transaction not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save the transaction")
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) DeleteFinanceTransaction(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid id")
		return
	}
	res, err := s.DB.Exec(`DELETE FROM finance_transactions WHERE id = $1`, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not delete the transaction")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "not_found", "transaction not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- stats, trend, budgets ----

type categoryTotal struct {
	ID       *int64          `json:"id"` // nil = uncategorized, or (in children) "the parent itself, no subcategory"
	Kind     string          `json:"kind"`
	Total    float64         `json:"total"`
	Children []categoryTotal `json:"children,omitempty"`
}

// FinanceStats totals a date range by type and by top-level category, each
// with its subcategory split, for the Stats donut and its drill-down.
func (s *Server) FinanceStats(w http.ResponseWriter, r *http.Request) {
	from, to, ok := dateRange(r.URL.Query().Get("from"), r.URL.Query().Get("to"))
	if !ok {
		writeError(w, http.StatusBadRequest, "validation_error", "from/to must be YYYY-MM-DD")
		return
	}
	rows, err := s.DB.QueryContext(r.Context(),
		`SELECT t.kind, COALESCE(c.parent_id, c.id) AS top_id,
		        CASE WHEN c.parent_id IS NOT NULL THEN c.id END AS sub_id,
		        SUM(t.base_amount)
		 FROM finance_transactions t
		 LEFT JOIN finance_categories c ON c.id = t.category_id
		 WHERE t.occurred_on BETWEEN $1 AND $2
		 GROUP BY 1, 2, 3`, from, to)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not load stats")
		return
	}
	defer rows.Close()

	type key struct {
		kind string
		top  int64 // 0 = uncategorized
	}
	tops := map[key]*categoryTotal{}
	totals := map[string]float64{"income": 0, "expense": 0}
	for rows.Next() {
		var kind string
		var top, sub *int64
		var sum float64
		if err := rows.Scan(&kind, &top, &sub, &sum); err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "could not read stats")
			return
		}
		totals[kind] += sum
		k := key{kind: kind}
		if top != nil {
			k.top = *top
		}
		ct, ok := tops[k]
		if !ok {
			ct = &categoryTotal{ID: top, Kind: kind}
			tops[k] = ct
		}
		ct.Total += sum
		ct.Children = append(ct.Children, categoryTotal{ID: sub, Kind: kind, Total: sum})
	}
	out := make([]categoryTotal, 0, len(tops))
	for _, ct := range tops {
		sort.Slice(ct.Children, func(i, j int) bool { return ct.Children[i].Total > ct.Children[j].Total })
		out = append(out, *ct)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Total > out[j].Total })
	writeJSON(w, http.StatusOK, map[string]any{
		"income":     totals["income"],
		"expense":    totals["expense"],
		"categories": out,
	})
}

// FinanceTrend returns per-month income/expense for the `months` months
// ending with `end` (YYYY-MM), zero-filled so the chart has no gaps.
func (s *Server) FinanceTrend(w http.ResponseWriter, r *http.Request) {
	end, ok := parseMonth(r.URL.Query().Get("end"))
	if !ok {
		writeError(w, http.StatusBadRequest, "validation_error", "end must be YYYY-MM")
		return
	}
	months := 6
	if v := r.URL.Query().Get("months"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 36 {
			writeError(w, http.StatusBadRequest, "validation_error", "months must be 1-36")
			return
		}
		months = n
	}
	start := end.AddDate(0, -(months - 1), 0)
	rows, err := s.DB.QueryContext(r.Context(),
		`SELECT to_char(m, 'YYYY-MM'),
		        COALESCE(SUM(t.base_amount) FILTER (WHERE t.kind = 'income'), 0),
		        COALESCE(SUM(t.base_amount) FILTER (WHERE t.kind = 'expense'), 0)
		 FROM generate_series($1::date, $2::date, interval '1 month') AS m
		 LEFT JOIN finance_transactions t ON date_trunc('month', t.occurred_on) = m
		 GROUP BY m ORDER BY m`,
		start.Format(dateLayout), end.Format(dateLayout))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not load the trend")
		return
	}
	defer rows.Close()
	type point struct {
		Month   string  `json:"month"`
		Income  float64 `json:"income"`
		Expense float64 `json:"expense"`
	}
	out := []point{}
	for rows.Next() {
		var p point
		if err := rows.Scan(&p.Month, &p.Income, &p.Expense); err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "could not read the trend")
			return
		}
		out = append(out, p)
	}
	writeJSON(w, http.StatusOK, out)
}

// FinanceBudgets lists every top-level expense category with its monthly
// budget (if set) and what was spent in the given month, subcategories
// included.
func (s *Server) FinanceBudgets(w http.ResponseWriter, r *http.Request) {
	start, ok := parseMonth(r.URL.Query().Get("month"))
	if !ok {
		writeError(w, http.StatusBadRequest, "validation_error", "month must be YYYY-MM")
		return
	}
	end := start.AddDate(0, 1, -1)
	rows, err := s.DB.QueryContext(r.Context(),
		`SELECT c.id, b.amount,
		        COALESCE((SELECT SUM(t.base_amount) FROM finance_transactions t
		                  WHERE t.kind = 'expense' AND t.occurred_on BETWEEN $1 AND $2
		                    AND t.category_id IN (SELECT id FROM finance_categories WHERE id = c.id OR parent_id = c.id)), 0)
		 FROM finance_categories c
		 LEFT JOIN finance_budgets b ON b.category_id = c.id
		 WHERE c.kind = 'expense' AND c.parent_id IS NULL AND (NOT c.archived OR b.amount IS NOT NULL)
		 ORDER BY c.position, c.id`,
		start.Format(dateLayout), end.Format(dateLayout))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not load budgets")
		return
	}
	defer rows.Close()
	type budget struct {
		CategoryID int64    `json:"category_id"`
		Amount     *float64 `json:"amount"`
		Spent      float64  `json:"spent"`
	}
	out := []budget{}
	for rows.Next() {
		var b budget
		if err := rows.Scan(&b.CategoryID, &b.Amount, &b.Spent); err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "could not read budgets")
			return
		}
		out = append(out, b)
	}
	writeJSON(w, http.StatusOK, out)
}

// SetFinanceBudget sets a top-level expense category's monthly budget; an
// amount of 0 (or less) clears it.
func (s *Server) SetFinanceBudget(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid id")
		return
	}
	var in struct {
		Amount float64 `json:"amount"`
	}
	if err := decode(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "could not read the budget")
		return
	}
	var kind string
	var parent *int64
	err := s.DB.QueryRow(`SELECT kind, parent_id FROM finance_categories WHERE id = $1`, id).Scan(&kind, &parent)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && (kind != "expense" || parent != nil)) {
		writeError(w, http.StatusBadRequest, "validation_error", "budgets apply to top-level expense categories")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save the budget")
		return
	}
	if in.Amount <= 0 {
		_, err = s.DB.Exec(`DELETE FROM finance_budgets WHERE category_id = $1`, id)
	} else {
		_, err = s.DB.Exec(
			`INSERT INTO finance_budgets (category_id, amount) VALUES ($1, $2)
			 ON CONFLICT (category_id) DO UPDATE SET amount = EXCLUDED.amount`, id, in.Amount)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not save the budget")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- helpers ----

func dateRange(fromStr, toStr string) (string, string, bool) {
	from, err1 := time.Parse(dateLayout, fromStr)
	to, err2 := time.Parse(dateLayout, toStr)
	if err1 != nil || err2 != nil || to.Before(from) {
		return "", "", false
	}
	return from.Format(dateLayout), to.Format(dateLayout), true
}

// parseMonth parses YYYY-MM into the first day of that month.
func parseMonth(v string) (time.Time, bool) {
	t, err := time.Parse("2006-01", v)
	return t, err == nil
}
