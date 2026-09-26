package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// fxCurrencies is the set the ECB publishes daily reference rates for, which
// is what the Frankfurter API serves. Anything else can still be entered with
// a manually typed rate.
var fxCurrencies = []string{
	"AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF",
	"IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN", "MYR", "NOK", "NZD", "PHP",
	"PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR",
}

var errRateUnavailable = errors.New("exchange rate unavailable")

var fxHTTP = &http.Client{Timeout: 6 * time.Second}

// fxRate returns how many units of base one unit of currency is worth on the
// given day. Rates are cached per day; a future date is clamped to today, and
// weekends/holidays resolve upstream to the last published rate.
func (s *Server) fxRate(ctx context.Context, currency, base string, day time.Time) (float64, string, error) {
	if currency == base {
		return 1, day.Format(dateLayout), nil
	}
	today := time.Now().UTC().Truncate(24 * time.Hour)
	if day.After(today) {
		day = today
	}
	dayStr := day.Format(dateLayout)

	// Past days never change, so they're cached for good. Today's entry is
	// refreshed after a few hours: the ECB publishes once per working day
	// (~16:00 CET), and a lookup made before that returns the previous
	// day's rate, which shouldn't stick until midnight.
	var cached float64
	err := s.DB.QueryRowContext(ctx,
		`SELECT rate FROM finance_fx_rates
		 WHERE base = $1 AND quote = $2 AND rate_date = $3
		   AND ($4 = false OR fetched_at > now() - interval '6 hours')`,
		currency, base, dayStr, day.Equal(today),
	).Scan(&cached)
	if err == nil {
		return cached, dayStr, nil
	}
	if err != sql.ErrNoRows {
		return 0, "", err
	}

	rate, err := s.fetchFXRate(ctx, currency, base, day, day.Equal(today))
	if err != nil {
		return 0, "", err
	}
	_, _ = s.DB.ExecContext(ctx,
		`INSERT INTO finance_fx_rates (base, quote, rate_date, rate) VALUES ($1, $2, $3, $4)
		 ON CONFLICT (base, quote, rate_date) DO UPDATE SET rate = EXCLUDED.rate, fetched_at = now()`,
		currency, base, dayStr, rate,
	)
	return rate, dayStr, nil
}

func (s *Server) fetchFXRate(ctx context.Context, currency, base string, day time.Time, latest bool) (float64, error) {
	path := day.Format(dateLayout)
	if latest {
		path = "latest"
	}
	u := fmt.Sprintf("%s/%s?base=%s&symbols=%s",
		strings.TrimRight(s.Cfg.FXBaseURL, "/"), path, url.QueryEscape(currency), url.QueryEscape(base))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return 0, err
	}
	res, err := fxHTTP.Do(req)
	if err != nil {
		return 0, errRateUnavailable
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return 0, errRateUnavailable
	}
	var body struct {
		Rates map[string]float64 `json:"rates"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(nil, res.Body, 1<<16)).Decode(&body); err != nil {
		return 0, errRateUnavailable
	}
	rate, ok := body.Rates[base]
	if !ok || rate <= 0 {
		return 0, errRateUnavailable
	}
	return rate, nil
}

// FinanceFX powers the entry form's live "≈ Rp …" conversion.
func (s *Server) FinanceFX(w http.ResponseWriter, r *http.Request) {
	currency := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("currency")))
	if !currencyRe.MatchString(currency) {
		writeError(w, http.StatusBadRequest, "validation_error", "invalid currency")
		return
	}
	day := time.Now().UTC().Truncate(24 * time.Hour)
	if v := r.URL.Query().Get("date"); v != "" {
		d, err := time.Parse(dateLayout, v)
		if err != nil {
			writeError(w, http.StatusBadRequest, "validation_error", "invalid date")
			return
		}
		day = d
	}
	base, err := s.baseCurrency(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "could not load settings")
		return
	}
	rate, rateDate, err := s.fxRate(r.Context(), currency, base, day)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "fx_unavailable", "exchange rate unavailable — enter it manually")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"currency": currency,
		"base":     base,
		"rate":     rate,
		"date":     rateDate,
	})
}
