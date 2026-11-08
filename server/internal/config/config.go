package config

import "os"

// Config is the console's whole configuration: where the bus is. It used to
// carry a MySQL DSN for the two tables the portal read itself; those live in the
// bus now, so there is no database connection left to configure.
type Config struct {
	BusURL  string
	JWKSURL string
}

func Load() Config {
	cfg := Config{
		BusURL: envOr("NANO_PORTAL_BUS_URL", "http://127.0.0.1:9000"),
	}
	cfg.JWKSURL = envOr("NANO_PORTAL_JWKS_URL", cfg.BusURL+"/auth/v1/.well-known/jwks")
	return cfg
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
