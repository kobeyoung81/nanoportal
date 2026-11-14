package repository

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gitee.com/kobeyoung81/nanoportal/server/internal/bustoken"
)

// TestUserAccountClient_ReadsAndWritesThroughTheBus pins the three things that
// would break account administration silently: the payload shapes, the token the
// identity module demands (a request without it is refused, which reads as "no
// such account"), and the fact that a 404 has to be distinguishable from a failure
// — the console turns the first into "user not found" and the second into
// "something is wrong".
func TestUserAccountClient_ReadsAndWritesThroughTheBus(t *testing.T) {
	t.Setenv(bustoken.EnvVar, "test-token")

	type request struct {
		method string
		path   string
		body   string
		auth   string
	}
	var requests []request
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := readAll(r)
		requests = append(requests, request{r.Method, r.URL.String(), body, r.Header.Get("Authorization")})
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/internal/v1/accounts/counts":
			_, _ = w.Write([]byte(`{"active":3,"admins":1}`))
		case r.URL.Path == "/internal/v1/accounts" && r.Method == http.MethodGet:
			// The identity module answers with `accounts` and composes the directory
			// flag itself; the console used to fetch a separate roster for it.
			_, _ = w.Write([]byte(`{"accounts":[` +
				`{"user_id":"u-1","display_name":"Ada","status":"active","tier":"pro","role":"admin","channels":["telegram"],"ldap":true},` +
				`{"user_id":"u-2","display_name":"","status":"deleted","tier":"free","role":"user","channels":[],"ldap":false}]}`))
		case r.URL.Path == "/internal/v1/accounts/u-1" && r.Method == http.MethodGet:
			_, _ = w.Write([]byte(`{"user_id":"u-1","display_name":"Ada","status":"active","tier":"pro","role":"admin","channels":["telegram"]}`))
		case r.URL.Path == "/internal/v1/accounts/ghost" && r.Method == http.MethodGet:
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"user not found"}`))
		case r.URL.Path == "/internal/v1/accounts/u-1/password":
			_, _ = w.Write([]byte(`{"user_id":"u-1","password_hash":"bcrypt-hash"}`))
		case r.URL.Path == "/internal/v1/accounts/ghost/password":
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"user not found"}`))
		case r.Method == http.MethodPatch:
			_, _ = w.Write([]byte(`{"user_id":"u-1","status":"updated"}`))
		case r.Method == http.MethodPut:
			_, _ = w.Write([]byte(`{"user_id":"u-1","status":"updated"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := newUserAccountClient(srv.URL)
	ctx := context.Background()

	accounts, err := c.accounts(ctx, true, 0)
	if err != nil {
		t.Fatalf("accounts: %v", err)
	}
	if len(accounts) != 2 {
		t.Fatalf("expected 2 accounts, got %+v", accounts)
	}
	if accounts[0].UserID != "u-1" || accounts[0].DisplayName != "Ada" || accounts[0].Role != "admin" ||
		accounts[0].Tier != "pro" || accounts[0].Status != "active" {
		t.Fatalf("unexpected account: %+v", accounts[0])
	}
	if len(accounts[0].Channels) != 1 || accounts[0].Channels[0] != "telegram" {
		t.Fatalf("channels missing: %+v", accounts[0])
	}
	if !accounts[0].LDAP || accounts[1].LDAP {
		t.Fatalf("the directory flag was dropped: %+v %+v", accounts[0], accounts[1])
	}
	// include_deleted travelled with the request.
	if !strings.Contains(requests[0].path, "include_deleted=1") {
		t.Fatalf("the listing dropped its filter: %s", requests[0].path)
	}

	active, admins, err := c.counts(ctx)
	if err != nil {
		t.Fatalf("counts: %v", err)
	}
	if active != 3 || admins != 1 {
		t.Fatalf("counts = %d/%d", active, admins)
	}

	account, err := c.account(ctx, "u-1")
	if err != nil {
		t.Fatalf("account: %v", err)
	}
	if account.DisplayName != "Ada" {
		t.Fatalf("unexpected account: %+v", account)
	}

	// A missing account is recognisable, not just "some error".
	if _, err := c.account(ctx, "ghost"); !isNotFound(err) {
		t.Fatalf("expected a not-found error, got %v", err)
	}
	if _, err := c.passwordHash(ctx, "ghost"); !isNotFound(err) {
		t.Fatalf("expected a not-found error, got %v", err)
	}

	hash, err := c.passwordHash(ctx, "u-1")
	if err != nil {
		t.Fatalf("passwordHash: %v", err)
	}
	if hash != "bcrypt-hash" {
		t.Fatalf("hash = %q", hash)
	}

	// The writes carry exactly the fields they name.
	if err := c.update(ctx, "u-1", map[string]string{"status": "suspended"}); err != nil {
		t.Fatalf("update: %v", err)
	}
	if err := c.setPassword(ctx, "u-1", "new-hash", true); err != nil {
		t.Fatalf("setPassword: %v", err)
	}

	var patch, put *request
	for i := range requests {
		switch requests[i].method {
		case http.MethodPatch:
			patch = &requests[i]
		case http.MethodPut:
			put = &requests[i]
		}
	}
	if patch == nil || patch.body != `{"status":"suspended"}` {
		t.Fatalf("unexpected PATCH body: %+v", patch)
	}
	var putBody map[string]any
	if put == nil || json.Unmarshal([]byte(put.body), &putBody) != nil {
		t.Fatalf("unexpected PUT body: %+v", put)
	}
	if putBody["password_hash"] != "new-hash" || putBody["must_change_password"] != true {
		t.Fatalf("the password write lost a field: %+v", putBody)
	}

	// Every request carried the bus token.
	for i, req := range requests {
		if req.auth == "" {
			t.Fatalf("request %d (%s %s) went out without the bus token", i, req.method, req.path)
		}
	}
}

// TestUserAccountClient_UpdateOnAMissingAccount keeps the console's answer honest:
// editing somebody who is not there is "not found", not a silent success.
func TestUserAccountClient_UpdateOnAMissingAccount(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"user not found"}`))
	}))
	defer srv.Close()

	c := newUserAccountClient(srv.URL)
	err := c.update(context.Background(), "ghost", map[string]string{"role": "admin"})
	if err == nil {
		t.Fatal("expected an error for a missing account")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Fatalf("unexpected error: %v", err)
	}
}

// readAll is the test's own body reader; the handler only needs the bytes.
func readAll(r *http.Request) (string, error) {
	if r.Body == nil {
		return "", nil
	}
	body, err := io.ReadAll(r.Body)
	return string(body), err
}
