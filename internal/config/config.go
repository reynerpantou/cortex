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
	AnthropicAPIKey string        // used by the (future) AI layer; empty = AI disabled
	FXBaseURL       string        // Frankfurter-compatible exchange-rate API (ECB daily reference rates)

	// TrustedProxies are the reverse proxies (IPs or CIDRs) whose
	// X-Forwarded-For header is believed when working out a visitor's IP.
	// Empty means no proxy: the connection's own address is used, and a
	// client-supplied X-Forwarded-For is ignored (it could be forged).
	TrustedProxies []netip.Prefix

	// PublicURL is where people open Cortex (https://cortex.example.com).
	// Google and Apple send people back to PublicURL/api/auth/<provider>/callback.
	PublicURL string

	GoogleClientID     string
	GoogleClientSecret string
	AppleClientID      string // the Services ID, e.g. com.example.cortex.web
	AppleTeamID        string
	AppleKeyID         string
	ApplePrivateKey    string // contents of the .p8 key

	// Test-only: point a provider at a fake server. Empty in production.
	GoogleTestBase string
	AppleTestBase  string
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
		AnthropicAPIKey: env("ANTHROPIC_API_KEY", ""),
		FXBaseURL:       env("CORTEX_FX_URL", "https://api.frankfurter.dev/v1"),

		TrustedProxies: envPrefixes("CORTEX_TRUSTED_PROXIES"),

		PublicURL:          strings.TrimRight(env("CORTEX_PUBLIC_URL", "http://localhost:8080"), "/"),
		GoogleClientID:     env("CORTEX_GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret: env("CORTEX_GOOGLE_CLIENT_SECRET", ""),
		AppleClientID:      env("CORTEX_APPLE_CLIENT_ID", ""),
		AppleTeamID:        env("CORTEX_APPLE_TEAM_ID", ""),
		AppleKeyID:         env("CORTEX_APPLE_KEY_ID", ""),
		ApplePrivateKey:    envOrFile("CORTEX_APPLE_PRIVATE_KEY"),
		GoogleTestBase:     env("CORTEX_GOOGLE_TEST_BASE", ""),
		AppleTestBase:      env("CORTEX_APPLE_TEST_BASE", ""),
	}
}

// envOrFile reads K, or the file named by K_FILE (for keys mounted as files).
func envOrFile(k string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	if path := os.Getenv(k + "_FILE"); path != "" {
		b, err := os.ReadFile(path)
		if err != nil {
			log.Fatalf("%s_FILE: %v", k, err)
		}
		return string(b)
	}
	return ""
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
