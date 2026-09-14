package config

import (
	"os"
	"strconv"
	"time"
)

// Config holds all runtime configuration, sourced from environment variables so
// the same binary runs locally and in the cloud with no code changes.
type Config struct {
	Addr            string
	DBPath          string
	CookieSecure    bool          // true when served over HTTPS
	SessionTTL      time.Duration // how long a login lasts
	AdminUser       string        // seeded on first boot if no users exist
	AdminPassword   string        // seeded on first boot if no users exist
	AnthropicAPIKey string        // used by the (future) AI layer; empty = AI disabled
}

func Load() Config {
	return Config{
		Addr:            env("CORTEX_ADDR", ":8080"),
		DBPath:          env("CORTEX_DB_PATH", "cortex.db"),
		CookieSecure:    envBool("CORTEX_COOKIE_SECURE", false),
		SessionTTL:      time.Duration(envInt("CORTEX_SESSION_TTL_HOURS", 168)) * time.Hour,
		AdminUser:       env("CORTEX_ADMIN_USER", "admin"),
		AdminPassword:   env("CORTEX_ADMIN_PASSWORD", ""),
		AnthropicAPIKey: env("ANTHROPIC_API_KEY", ""),
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envBool(k string, def bool) bool {
	if v := os.Getenv(k); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}

func envInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
