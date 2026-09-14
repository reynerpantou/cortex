package auth

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"time"
)

var ErrInvalidSession = errors.New("auth: invalid or expired session")

// NewToken returns a URL-safe 256-bit random session token.
func NewToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// CreateSession stores a new session for userID and returns its token.
func CreateSession(db *sql.DB, userID int64, ttl time.Duration) (string, error) {
	token, err := NewToken()
	if err != nil {
		return "", err
	}
	now := time.Now().UTC()
	_, err = db.Exec(
		`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
		token, userID, now, now.Add(ttl),
	)
	if err != nil {
		return "", err
	}
	return token, nil
}

// ValidateSession returns the user ID for a live session token.
func ValidateSession(db *sql.DB, token string) (int64, error) {
	if token == "" {
		return 0, ErrInvalidSession
	}
	var userID int64
	var expires time.Time
	err := db.QueryRow(
		`SELECT user_id, expires_at FROM sessions WHERE token = ?`, token,
	).Scan(&userID, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrInvalidSession
	}
	if err != nil {
		return 0, err
	}
	if time.Now().UTC().After(expires) {
		_, _ = db.Exec(`DELETE FROM sessions WHERE token = ?`, token)
		return 0, ErrInvalidSession
	}
	return userID, nil
}

// DeleteSession removes a session (logout).
func DeleteSession(db *sql.DB, token string) error {
	_, err := db.Exec(`DELETE FROM sessions WHERE token = ?`, token)
	return err
}

// PurgeExpiredSessions deletes stale sessions; call periodically.
func PurgeExpiredSessions(db *sql.DB) error {
	_, err := db.Exec(`DELETE FROM sessions WHERE expires_at < ?`, time.Now().UTC())
	return err
}
