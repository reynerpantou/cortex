package handlers

import (
	"context"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Sign-in limits live in the database, keyed by who and where the attempt
// came from — never by anything the browser holds — so closing the tab,
// an incognito window, another browser or a server restart doesn't reset
// them. Three counters, each with its own threshold:
//
//	ui: this username from this IP   (the normal "5 wrong tries" case)
//	ip: this IP, across any usernames (one address guessing many accounts)
//	u:  this username, from any IP    (many addresses guessing one account)
//
// Reaching a threshold starts a cooldown; each repeat cooldown doubles, up
// to a day. During a cooldown the password isn't even checked, so a correct
// guess made while locked still fails.
type throttleRule struct {
	kind string
	max  int
	base time.Duration
}

const (
	failureWindow = time.Hour      // failures older than this start over
	lockMemory    = 24 * time.Hour // a quiet day resets the doubling
	maxLock       = 24 * time.Hour
)

func (s *Server) throttleRules() []throttleRule {
	n, base := s.Cfg.LoginMaxAttempts, s.Cfg.LoginLockout
	return []throttleRule{
		{"ui", n, base},
		{"ip", n * 4, base},
		{"u", n * 6, 2 * base},
	}
}

func throttleKey(kind, username, ip string) string {
	u := strings.ToLower(strings.TrimSpace(username))
	switch kind {
	case "ui":
		return "ui:" + u + "|" + ip
	case "ip":
		return "ip:" + ip
	default:
		return "u:" + u
	}
}

// loginLockedFor reports how long until every active cooldown for this
// attempt has expired (0 means sign-in may proceed).
func (s *Server) loginLockedFor(ctx context.Context, username, ip string) (time.Duration, error) {
	keys := make([]string, 0, 3)
	for _, r := range s.throttleRules() {
		keys = append(keys, throttleKey(r.kind, username, ip))
	}
	var until *time.Time
	err := s.DB.QueryRowContext(ctx,
		`SELECT MAX(locked_until) FROM login_throttle WHERE key = ANY($1) AND locked_until > now()`, keys,
	).Scan(&until)
	if err != nil || until == nil {
		return 0, err
	}
	return time.Until(*until), nil
}

// recordLoginFailure counts a failed attempt against every key. It returns
// how many tries are left before this username+IP locks, and the cooldown
// just started (0 if none).
func (s *Server) recordLoginFailure(ctx context.Context, username, ip string) (int, time.Duration, error) {
	remaining := 0
	var locked time.Duration
	for _, rule := range s.throttleRules() {
		key := throttleKey(rule.kind, username, ip)
		var failures, lockCount int
		err := s.DB.QueryRowContext(ctx,
			`INSERT INTO login_throttle (key, failures, updated_at) VALUES ($1, 1, now())
			 ON CONFLICT (key) DO UPDATE SET
			   failures = CASE WHEN login_throttle.updated_at < now() - make_interval(secs => $2)
			                   THEN 1 ELSE login_throttle.failures + 1 END,
			   lock_count = CASE WHEN login_throttle.updated_at < now() - make_interval(secs => $3)
			                     THEN 0 ELSE login_throttle.lock_count END,
			   updated_at = now()
			 RETURNING failures, lock_count`,
			key, failureWindow.Seconds(), lockMemory.Seconds(),
		).Scan(&failures, &lockCount)
		if err != nil {
			return 0, 0, err
		}
		if failures >= rule.max {
			d := time.Duration(float64(rule.base) * math.Pow(2, float64(lockCount)))
			if d > maxLock || d <= 0 {
				d = maxLock
			}
			if _, err := s.DB.ExecContext(ctx,
				`UPDATE login_throttle SET failures = 0, lock_count = lock_count + 1,
				        locked_until = now() + make_interval(secs => $2) WHERE key = $1`,
				key, d.Seconds(),
			); err != nil {
				return 0, 0, err
			}
			if d > locked {
				locked = d
			}
		} else if rule.kind == "ui" {
			remaining = rule.max - failures
		}
	}
	return remaining, locked, nil
}

// clearLoginFailures resets the username's counters after a successful
// sign-in. The IP counter is left alone: other accounts guessed from the
// same address still count.
func (s *Server) clearLoginFailures(ctx context.Context, username, ip string) {
	_, _ = s.DB.ExecContext(ctx, `DELETE FROM login_throttle WHERE key = ANY($1)`,
		[]string{throttleKey("ui", username, ip), throttleKey("u", username, ip)})
}

func writeLocked(w http.ResponseWriter, wait time.Duration) {
	secs := int(math.Ceil(wait.Seconds()))
	if secs < 1 {
		secs = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(secs))
	writeJSON(w, http.StatusTooManyRequests, map[string]any{
		"code":        "locked",
		"message":     "too many failed sign-in attempts — try again later",
		"retry_after": secs,
	})
}
