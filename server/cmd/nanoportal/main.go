package main

import (
	"context"
	"log"
	"net/http"

	"gitee.com/kobeyoung81/nanoportal/server/internal/api"
	"gitee.com/kobeyoung81/nanoportal/server/internal/auth"
	"gitee.com/kobeyoung81/nanoportal/server/internal/config"
	"gitee.com/kobeyoung81/nanoportal/server/internal/repository"
	"gitee.com/kobeyoung81/nanoportal/server/internal/store"
	"gitee.com/kobeyoung81/nanoportal/server/migrations"
)

const serverAddr = "127.0.0.1:8080"

// version is stamped at build time with -X main.version.
var version = "dev"

func main() {
	cfg := config.Load()

	// The portal owns user-facing data now (agents, groups, preferences and the
	// session projection), so it opens the platform database and applies its own
	// manifests before serving. The bus and the admin module stay dependencies for
	// what they still own.
	st, err := store.Open(cfg.MongoURI)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer st.Close()
	manifests, err := migrations.Load()
	if err != nil {
		log.Fatalf("load migrations: %v", err)
	}
	if ran, err := st.Migrate(manifests); err != nil {
		log.Fatalf("migrate: %v", err)
	} else if len(ran) > 0 {
		log.Printf("applied %d migration(s)", len(ran))
	}

	repo, err := repository.NewRepository(cfg.BusURL, cfg.AdminURL, cfg.AuthURL)
	if err != nil {
		log.Fatalf("repository: %v", err)
	}
	defer repo.Close()

	// The tier source caps how many agents one account may create; it stays with
	// the account record until the auth slice moves the account itself.
	st.SetUserTier(func(userID string) (string, error) {
		user, err := repo.GetUser(context.Background(), userID)
		if err != nil {
			return "", err
		}
		return user.Tier, nil
	})

	api.Version = version
	handler := api.New(repo, api.Backends{
		BusURL:   cfg.BusURL,
		AdminURL: cfg.AdminURL,
		AuthURL:  cfg.AuthURL,
	}, st, auth.NewJWKSValidator(cfg.JWKSURL))
	log.Printf("nanoportal server listening on %s", serverAddr)
	if err := http.ListenAndServe(serverAddr, handler); err != nil {
		log.Fatal(err)
	}
}
