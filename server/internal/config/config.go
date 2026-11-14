package config

import "os"

// Config is the console's configuration.
//
// The portal owns user-facing data now — agents, their groups and preferences,
// the session projection — so it carries its own database URI, alongside the bus
// (accounts, audit, conversations still being moved) and the admin module
// (catalogues and configuration).
type Config struct {
	BusURL string
	// AdminURL is the admin module: configuration lives there, not on the bus.
	AdminURL string
	// AuthURL is the identity module: accounts, their links and their language.
	// The console asks it directly — the bus used to forward these calls straight
	// back to it.
	AuthURL string
	// MongoURI names the platform database; the portal writes only its portal_
	// prefix (agents, groups, binding preferences, sessions).
	MongoURI string
	JWKSURL  string
}

func Load() Config {
	cfg := Config{
		BusURL:   envOr("NANO_PORTAL_BUS_URL", "http://127.0.0.1:9000"),
		AdminURL: envOr("NANOSEC_ADMIN_URL", "http://nanoadmin:8080"),
		AuthURL:  envOr("NANO_PORTAL_AUTH_URL", "http://nanoauth:8081"),
		// Falling back to the platform URI keeps a deployment with one credential
		// working without a second variable; the prefix is what separates writers.
		MongoURI: firstNonEmpty(os.Getenv("NANOPORTAL_MONGO_URI"), os.Getenv("NANOSEC_BUS_DATABASE_URI")),
	}
	// nanoauth directly: token validation used to be routed through the bus,
	// which made every request in the console depend on the bus being up.
	cfg.JWKSURL = envOr("NANO_PORTAL_JWKS_URL", "http://nanoauth:8081/auth/v1/.well-known/jwks")
	return cfg
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
