package main

import (
	"log"
	"net/http"

	"gitee.com/kobeyoung81/nanoportal/server/internal/api"
	"gitee.com/kobeyoung81/nanoportal/server/internal/auth"
	"gitee.com/kobeyoung81/nanoportal/server/internal/config"
	"gitee.com/kobeyoung81/nanoportal/server/internal/repository"
)

const serverAddr = "127.0.0.1:8080"

func main() {
	cfg := config.Load()

	// The portal has no database of its own: everything it shows comes from the
	// bus, which is the only service with a connection. A bus URL is therefore the
	// whole configuration, and an unreachable bus is an error rather than a
	// fallback to sample data.
	repo, err := repository.NewRepository(cfg.BusURL, cfg.AdminURL)
	if err != nil {
		log.Fatalf("repository: %v", err)
	}
	defer repo.Close()

	handler := api.New(repo, api.Backends{
		BusURL:   cfg.BusURL,
		AdminURL: cfg.AdminURL,
	}, auth.NewJWKSValidator(cfg.JWKSURL))
	log.Printf("nanoportal server listening on %s", serverAddr)
	if err := http.ListenAndServe(serverAddr, handler); err != nil {
		log.Fatal(err)
	}
}
