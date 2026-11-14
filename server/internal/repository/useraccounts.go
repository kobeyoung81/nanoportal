package repository

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"gitee.com/kobeyoung81/nanoportal/server/internal/bustoken"
	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
)

// userAccountClient administers accounts through the bus's REST API.
//
// The portal used to read and write `users` straight out of MySQL — the same
// table the bus read for its own fields. Once the bus owned the storage, those two
// halves could disagree about one account, so the console asks the bus now. See
// busconfig.go for the same argument applied to configuration.
//
// The credential is the one thing that stays here: the bus stores a bcrypt hash
// and hands it back, and the verification (a comparison, not a service) happens
// where the login form is.
type userAccountClient struct {
	base string
	http *http.Client
}

func newUserAccountClient(authURL string) *userAccountClient {
	return &userAccountClient{
		base: authURL,
		http: &http.Client{Timeout: 15 * time.Second, Transport: bustoken.Transport(nil)},
	}
}

// accounts lists the accounts the console shows, newest first.
func (c *userAccountClient) accounts(ctx context.Context, includeDeleted bool, limit int) ([]model.UserSummary, error) {
	path := "/internal/v1/accounts"
	query := url.Values{}
	if includeDeleted {
		query.Set("include_deleted", "1")
	}
	if limit > 0 {
		query.Set("limit", fmt.Sprint(limit))
	}
	if encoded := query.Encode(); encoded != "" {
		path += "?" + encoded
	}

	var payload struct {
		Users []accountPayload `json:"accounts"`
	}
	if err := busDo(ctx, c.http, c.base, http.MethodGet, path, nil, &payload); err != nil {
		return nil, err
	}
	out := make([]model.UserSummary, 0, len(payload.Users))
	for _, u := range payload.Users {
		out = append(out, u.summary())
	}
	return out, nil
}

// account fetches one account. A missing account is reported the way the SQL read
// did — as an error naming the user, because every caller here is in the middle of
// an administrative action on somebody who is supposed to exist.
func (c *userAccountClient) account(ctx context.Context, userID string) (model.UserSummary, error) {
	var payload accountPayload
	// A missing account comes back as the bus's 404, which the caller can tell
	// apart from a failure (see isNotFound).
	if err := busDo(ctx, c.http, c.base, http.MethodGet, "/internal/v1/accounts/"+url.PathEscape(userID), nil, &payload); err != nil {
		return model.UserSummary{}, err
	}
	return payload.summary(), nil
}

// counts returns the two numbers the overview shows.
func (c *userAccountClient) counts(ctx context.Context) (active, admins int, err error) {
	var payload struct {
		Active int `json:"active"`
		Admins int `json:"admins"`
	}
	if err := busDo(ctx, c.http, c.base, http.MethodGet, "/internal/v1/accounts/counts", nil, &payload); err != nil {
		return 0, 0, err
	}
	return payload.Active, payload.Admins, nil
}

// tierCounts returns the per-tier breakdown the console draws as columns. All
// three tiers are present, zero included, so a column is never mistaken for a
// missing measurement.
func (c *userAccountClient) tierCounts(ctx context.Context) (map[string]int, error) {
	var payload struct {
		Tiers map[string]int `json:"tiers"`
	}
	if err := busDo(ctx, c.http, c.base, http.MethodGet, "/internal/v1/accounts/counts", nil, &payload); err != nil {
		return nil, err
	}
	if payload.Tiers == nil {
		payload.Tiers = map[string]int{"free": 0, "pro": 0, "ultra": 0}
	}
	return payload.Tiers, nil
}

// update applies a partial change to an account.
func (c *userAccountClient) update(ctx context.Context, userID string, patch map[string]string) error {
	// The 404 travels as it is: wrapping it in a fresh error would lose the type
	// the callers use to tell "not there" from "something is wrong", while its
	// message ("user not found") is what the API layer reports.
	return busDo(ctx, c.http, c.base, http.MethodPatch, "/internal/v1/accounts/"+url.PathEscape(userID), patch, nil)
}

// passwordHash reads the stored hash; a missing account is an error, as it was
// when the lookup was a SELECT that found no row.
func (c *userAccountClient) passwordHash(ctx context.Context, userID string) (string, error) {
	var payload struct {
		PasswordHash string `json:"password_hash"`
	}
	if err := busDo(ctx, c.http, c.base, http.MethodGet, "/internal/v1/accounts/"+url.PathEscape(userID)+"/password", nil, &payload); err != nil {
		return "", err
	}
	return payload.PasswordHash, nil
}

// setPassword stores a hash produced here.
func (c *userAccountClient) setPassword(ctx context.Context, userID, passwordHash string, mustChange bool) error {
	body := map[string]any{"password_hash": passwordHash, "must_change_password": mustChange}
	return busDo(ctx, c.http, c.base, http.MethodPut, "/internal/v1/accounts/"+url.PathEscape(userID)+"/password", body, nil)
}

// accountPayload is one account as the bus serves it.
type accountPayload struct {
	UserID      string   `json:"user_id"`
	DisplayName string   `json:"display_name"`
	Status      string   `json:"status"`
	Tier        string   `json:"tier"`
	Role        string   `json:"role"`
	Channels    []string `json:"channels"`
	// LDAP is whether the account signs in through the corporate directory. The
	// identity module composes it now, so the console no longer asks for a
	// separate roster and joins it by hand.
	LDAP bool `json:"ldap"`
}

func (p accountPayload) summary() model.UserSummary {
	return model.UserSummary{
		UserID:      p.UserID,
		DisplayName: p.DisplayName,
		Status:      p.Status,
		Tier:        p.Tier,
		Role:        p.Role,
		Channels:    p.Channels,
		LDAP:        p.LDAP,
	}
}
