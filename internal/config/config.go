package config

import (
	"log"
	"net/netip"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds all runtime configuration, sourced from environment variables so
// the same binary runs locally and in the cloud with no code changes.
type Config struct {
	Addr            string
	DatabaseURL     string        // Postgres connection string
	CookieSecure    bool          // true when served over HTTPS
	SessionTTL      time.Duration // how long a login lasts
	AdminUser       string        // seeded on first boot if no users exist
	AdminPassword   string        // seeded on first boot if no users exist
	AnthropicAPIKey string        // used by the (future) AI layer; empty = AI disabled
	FXBaseURL       string        // Frankfurter-compatible exchange-rate API (ECB daily reference rates)

	// TrustedProxies are the reverse proxies (IPs or CIDRs) whose
	// X-Forwarded-For header is believed when working out a visitor's IP.
	// Empty means no proxy: the connection's own address is used, and a
	// client-supplied X-Forwarded-For is ignored (it could be forged).
	TrustedProxies []netip.Prefix

	LoginMaxAttempts int           // failed sign-ins before a cooldown
	LoginLockout     time.Duration // first cooldown; repeats double it (max 24h)
}

func Load() Config {
	return Config{
		Addr:        env("CORTEX_ADDR", ":8080"),
		DatabaseURL: env("CORTEX_DATABASE_URL", "postgres://cortex:cortex@localhost:5432/cortex?sslmode=disable"),
		// Secure by default: cookies only travel over HTTPS. Browsers treat
		// http://localhost as secure too, so local development still works;
		// set false only when serving plain HTTP on another host.
		CookieSecure:    envBool("CORTEX_COOKIE_SECURE", true),
		SessionTTL:      time.Duration(envInt("CORTEX_SESSION_TTL_HOURS", 168)) * time.Hour,
		AdminUser:       env("CORTEX_ADMIN_USER", "admin"),
		AdminPassword:   env("CORTEX_ADMIN_PASSWORD", ""),
		AnthropicAPIKey: env("ANTHROPIC_API_KEY", ""),
		FXBaseURL:       env("CORTEX_FX_URL", "https://api.frankfurter.dev/v1"),

		TrustedProxies:   envPrefixes("CORTEX_TRUSTED_PROXIES"),
		LoginMaxAttempts: envInt("CORTEX_LOGIN_MAX_ATTEMPTS", 5),
		LoginLockout:     time.Duration(envInt("CORTEX_LOGIN_LOCKOUT_MINUTES", 15)) * time.Minute,
	}
}

// envPrefixes parses a comma-separated list of IPs and CIDRs.
func envPrefixes(k string) []netip.Prefix {
	var out []netip.Prefix
	for _, part := range strings.Split(os.Getenv(k), ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if p, err := netip.ParsePrefix(part); err == nil {
			out = append(out, p.Masked())
		} else if a, err := netip.ParseAddr(part); err == nil {
			out = append(out, netip.PrefixFrom(a, a.BitLen()))
		} else {
			log.Fatalf("%s: %q is not an IP or CIDR", k, part)
		}
	}
	return out
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
