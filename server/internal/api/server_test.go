package api_test

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gitee.com/kobeyoung81/nanoportal/server/internal/api"
	"gitee.com/kobeyoung81/nanoportal/server/internal/auth"
	"gitee.com/kobeyoung81/nanoportal/server/internal/repository"
	"gitee.com/kobeyoung81/nanoportal/server/internal/store"
	"github.com/golang-jwt/jwt/v5"
)

const testKid = "test-kid"

type testEnv struct {
	handler http.Handler
	token   string
	key     *rsa.PrivateKey
	// store is the in-memory agent data the handler wrote to. Tests that need a
	// seeded agent mutate it before making the request.
	store *fakeStore
}

// newTestEnv builds a portal handler backed by the sample repository and a
// locally-served JWKS, and mints a valid token for the given role.
func newTestEnv(t *testing.T, role string, backends api.Backends) *testEnv {
	t.Helper()
	return newTestEnvWithRepo(t, role, backends, repository.NewSampleRepository())
}

// newTestEnvWithRepo is newTestEnv with a caller-supplied repository, for the
// handlers that read something the sample data does not carry.
func newTestEnvWithRepo(t *testing.T, role string, backends api.Backends, repo repository.Repository) *testEnv {
	t.Helper()
	return newTestEnvWithStore(t, role, backends, repo, newFakeStore())
}

// newTestEnvWithStore is newTestEnv with a caller-supplied agent store, so a
// test can start from a known set of agents and groups.
func newTestEnvWithStore(t *testing.T, role string, backends api.Backends, repo repository.Repository, st *fakeStore) *testEnv {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}

	jwksDoc := map[string]any{
		"keys": []map[string]string{{
			"kty": "RSA", "kid": testKid, "alg": "RS256", "use": "sig",
			"n": base64.RawURLEncoding.EncodeToString(key.PublicKey.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(bigEndianBytes(key.PublicKey.E)),
		}},
	}
	jwksServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(jwksDoc)
	}))
	t.Cleanup(jwksServer.Close)

	validator := auth.NewJWKSValidator(jwksServer.URL)
	handler := api.New(repo, backends, st, validator)

	token := mintToken(t, key, testKid, "test-admin", role)
	return &testEnv{handler: handler, token: token, key: key, store: st}
}

func mintToken(t *testing.T, key *rsa.PrivateKey, kid, sub, role string) string {
	t.Helper()
	claims := jwt.MapClaims{
		"iss":  "nanoauth",
		"sub":  sub,
		"role": role,
		"tier": "free",
		"iat":  time.Now().Unix(),
		"exp":  time.Now().Add(time.Hour).Unix(),
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = kid
	signed, err := tok.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return signed
}

func bigEndianBytes(n int) []byte {
	if n == 0 {
		return []byte{0}
	}
	var result []byte
	for n > 0 {
		result = append([]byte{byte(n % 256)}, result...)
		n /= 256
	}
	return result
}

func doRequest(t *testing.T, handler http.Handler, method, path string, body string, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	return recorder
}

func TestHealthzIsPublic(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	rec := doRequest(t, env.handler, http.MethodGet, "/healthz", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestProtectedEndpointRequiresToken(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	rec := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/overview", "", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without token, got %d", rec.Code)
	}
}

func TestOverviewEndpointRequiresValidToken(t *testing.T) {
	env := newTestEnv(t, "auditor", api.Backends{})
	rec := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/overview", "", env.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestNormalUserDeniedFromAdminConsole(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})

	read := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/overview", "", env.token)
	if read.Code != http.StatusForbidden {
		t.Fatalf("user read overview: expected 403, got %d", read.Code)
	}

	write := doRequest(t, env.handler, http.MethodPut, "/api/admin/v1/configs/agent/model", `{"value":"gpt-4o"}`, env.token)
	if write.Code != http.StatusForbidden {
		t.Fatalf("user write config: expected 403, got %d", write.Code)
	}
}

// Configuration is saved to the admin module, which owns the collection; the
// bus is not in this path any more.
func TestConfigWriteProxiesToAdminAndRecordsAudit(t *testing.T) {
	admin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/config/agent/model" {
			t.Errorf("unexpected upstream path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"component_type":"agent","key":"model","value":"gpt-4o"}`))
	}))
	defer admin.Close()

	env := newTestEnv(t, "operator", api.Backends{AdminURL: admin.URL})

	rec := doRequest(t, env.handler, http.MethodPut, "/api/admin/v1/configs/agent/model", `{"value":"gpt-4o"}`, env.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	auditRec := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/audit", "", mintToken(t, env.key, testKid, "root", "admin"))
	var entries []map[string]any
	if err := json.Unmarshal(auditRec.Body.Bytes(), &entries); err != nil {
		t.Fatalf("unmarshal audit: %v", err)
	}
	var found bool
	for _, entry := range entries {
		if entry["action"] == "config.update" && entry["resource_id"] == "agent/model" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected a config.update audit entry for agent/model")
	}
}

func TestAdminUserAgentsAreServedFromThePortalStore(t *testing.T) {
	env := newTestEnv(t, "operator", api.Backends{})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "alice", DisplayName: "Alice's agent"})

	// Operations (support) may list another user's agents.
	token := mintToken(t, env.key, testKid, "alice", "support")
	rec := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/users/alice/agents", "", token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	body := strings.TrimSpace(rec.Body.String())
	if !strings.HasPrefix(body, "[") {
		t.Fatalf("expected bare array, got: %s", body)
	}
	if !strings.Contains(body, "agent-1") {
		t.Fatalf("expected agent in payload: %s", body)
	}
}

func TestFilesProxyForwardsToBus(t *testing.T) {
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/files/agent-1" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.URL.Query().Get("path") != "logs" {
			t.Errorf("expected path=logs, got %q", r.URL.Query().Get("path"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"agent_id":"agent-1","path":"logs","entries":[{"name":"app.log","is_dir":false,"size":42}]}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "support", api.Backends{BusURL: bus.URL})

	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/files/agent-1?path=logs", "", env.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "app.log") {
		t.Fatalf("expected file entries in payload: %s", rec.Body.String())
	}
}

func TestProxyReturnsBadGatewayWhenUpstreamDown(t *testing.T) {
	env := newTestEnv(t, "operator", api.Backends{BusURL: "http://127.0.0.1:1"})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "test-admin"})

	// Agent rows are local now; the files tunnel is still a proxy, so a dead bus
	// must surface as a gateway error rather than a 404.
	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/files/agent-1", "", env.token)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d", rec.Code)
	}
}

func TestDisposeContainerProxiesToBusAndRecordsAudit(t *testing.T) {
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/api/v1/containers/alice/dispose" {
			t.Errorf("unexpected upstream path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"disposing"}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "support", api.Backends{BusURL: bus.URL})

	rec := doRequest(t, env.handler, http.MethodPost, "/api/admin/v1/containers/alice/dispose", "", env.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	auditRec := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/audit", "", mintToken(t, env.key, testKid, "root", "admin"))
	var entries []map[string]any
	if err := json.Unmarshal(auditRec.Body.Bytes(), &entries); err != nil {
		t.Fatalf("unmarshal audit: %v", err)
	}
	var found bool
	for _, entry := range entries {
		if entry["action"] == "container.dispose" && entry["resource_id"] == "alice" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected a container.dispose audit entry for alice")
	}
}

func TestReprovisionContainerProxiesToBusAndRecordsAudit(t *testing.T) {
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/api/v1/containers/alice/reprovision" {
			t.Errorf("unexpected upstream path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"pending"}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "support", api.Backends{BusURL: bus.URL})

	rec := doRequest(t, env.handler, http.MethodPost, "/api/admin/v1/containers/alice/reprovision", "", env.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	auditRec := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/audit", "", mintToken(t, env.key, testKid, "root", "admin"))
	var entries []map[string]any
	if err := json.Unmarshal(auditRec.Body.Bytes(), &entries); err != nil {
		t.Fatalf("unmarshal audit: %v", err)
	}
	var found bool
	for _, entry := range entries {
		if entry["action"] == "container.reprovision" && entry["resource_id"] == "alice" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected a container.reprovision audit entry for alice")
	}
}

func TestFileCopyProxyOwnerOnly(t *testing.T) {
	var copyQuery string
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/v1/agents/agent-1" && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"user_id":"alice"}`))
		case r.URL.Path == "/api/v1/files/agent-1/copy" && r.Method == http.MethodPost:
			copyQuery = r.URL.RawQuery
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		default:
			t.Errorf("unexpected upstream: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer bus.Close()

	env := newTestEnv(t, "user", api.Backends{BusURL: bus.URL})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "alice"})
	aliceToken := mintToken(t, env.key, testKid, "alice", "user")
	bobToken := mintToken(t, env.key, testKid, "bob", "user")

	ok := doRequest(t, env.handler, http.MethodPost,
		"/api/user/v1/files/agent-1/copy?path=notes.md&to=notes-copy.md", "", aliceToken)
	if ok.Code != http.StatusOK {
		t.Fatalf("owner copy: expected 200, got %d: %s", ok.Code, ok.Body.String())
	}
	if copyQuery != "path=notes.md&to=notes-copy.md" {
		t.Fatalf("expected copy forwarded with source and target, got %q", copyQuery)
	}

	denied := doRequest(t, env.handler, http.MethodPost,
		"/api/user/v1/files/agent-1/copy?path=notes.md&to=notes-copy.md", "", bobToken)
	if denied.Code != http.StatusForbidden {
		t.Fatalf("non-owner copy: expected 403, got %d", denied.Code)
	}
}

func TestLoginProxyForwardsToNanoauth(t *testing.T) {
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/v1/token" {
			t.Errorf("unexpected upstream path: %s", r.URL.Path)
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["email"] != "admin@example.com" {
			t.Errorf("expected email, got %v", body["email"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"tok","user_id":"u1","role":"operator","token_type":"Bearer","expires_in":3600}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "user", api.Backends{BusURL: bus.URL})

	rec := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/auth/login",
		`{"email":"admin@example.com","password":"secret"}`, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal login response: %v", err)
	}
	if payload["access_token"] != "tok" {
		t.Fatalf("expected access_token, got %v", payload["access_token"])
	}
}

func TestRegisterProxyForwardsToNanoauth(t *testing.T) {
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/v1/register" {
			t.Errorf("unexpected upstream path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"tok","user_id":"u1","role":"user","token_type":"Bearer","expires_in":3600}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "user", api.Backends{BusURL: bus.URL})

	rec := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/auth/register",
		`{"email":"a@b.com","password":"password123","display_name":"Alice"}`, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestMeDetailScopedToSelf(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	aliceToken := mintToken(t, env.key, testKid, "alice", "user")

	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/me/detail", "", aliceToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("me/detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "alice") {
		t.Fatalf("me/detail: expected own account data, got: %s", rec.Body.String())
	}

	// The same user must not be able to read arbitrary users via the admin API.
	adminRec := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/users/alice", "", aliceToken)
	if adminRec.Code != http.StatusForbidden {
		t.Fatalf("user reading /api/admin/v1/users/alice: expected 403, got %d", adminRec.Code)
	}
}

func TestMeAgentsScopedToSelf(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "alice"})
	env.store.withAgent(store.AgentRecord{ID: "agent-2", UserID: "bob"})
	aliceToken := mintToken(t, env.key, testKid, "alice", "user")

	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/me/agents", "", aliceToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, "agent-1") {
		t.Fatalf("expected own agents in payload: %s", body)
	}
	if strings.Contains(body, "agent-2") {
		t.Fatalf("another account's agent leaked into the payload: %s", body)
	}
}

func TestMeContainerRestartProxiesToBusAndRecordsAudit(t *testing.T) {
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/api/v1/containers/alice/restart" {
			t.Errorf("unexpected upstream path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"restarting"}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "user", api.Backends{BusURL: bus.URL})
	aliceToken := mintToken(t, env.key, testKid, "alice", "user")

	rec := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/me/container/restart", "", aliceToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	auditRec := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/audit", "", aliceToken)
	if auditRec.Code == http.StatusForbidden {
		// audit is admin/auditor; mint an admin token to inspect it.
		adminToken := mintToken(t, env.key, testKid, "root", "admin")
		auditRec = doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/audit", "", adminToken)
	}
	var entries []map[string]any
	if err := json.Unmarshal(auditRec.Body.Bytes(), &entries); err != nil {
		t.Fatalf("unmarshal audit: %v", err)
	}
	var found bool
	for _, entry := range entries {
		if entry["action"] == "container.restart" && entry["resource_id"] == "alice" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected a container.restart audit entry for alice")
	}
}

func TestFilesBrowseRequiresOwnership(t *testing.T) {
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/agents/agent-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"user_id":"alice"}`))
		case "/api/v1/files/agent-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"agent_id":"agent-1","entries":[{"name":"AGENT.md","is_dir":false,"size":10}]}`))
		default:
			t.Errorf("unexpected upstream path: %s", r.URL.Path)
		}
	}))
	defer bus.Close()

	env := newTestEnv(t, "user", api.Backends{BusURL: bus.URL})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "alice"})

	// Owner can browse.
	aliceToken := mintToken(t, env.key, testKid, "alice", "user")
	ownerRec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/files/agent-1", "", aliceToken)
	if ownerRec.Code != http.StatusOK {
		t.Fatalf("owner browse: expected 200, got %d: %s", ownerRec.Code, ownerRec.Body.String())
	}

	// Non-owner is denied.
	bobToken := mintToken(t, env.key, testKid, "bob", "user")
	deniedRec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/files/agent-1", "", bobToken)
	if deniedRec.Code != http.StatusForbidden {
		t.Fatalf("non-owner browse: expected 403, got %d", deniedRec.Code)
	}
}

func TestFileContentUploadOwnerOnly(t *testing.T) {
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/v1/agents/agent-1" && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"user_id":"alice"}`))
		case r.URL.Path == "/api/v1/files/agent-1/content" && r.Method == http.MethodPut:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		default:
			t.Errorf("unexpected upstream: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer bus.Close()

	env := newTestEnv(t, "user", api.Backends{BusURL: bus.URL})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "alice"})

	// Owner upload succeeds.
	aliceToken := mintToken(t, env.key, testKid, "alice", "user")
	ok := doRequest(t, env.handler, http.MethodPut, "/api/user/v1/files/agent-1/content?path=notes.md", "hello", aliceToken)
	if ok.Code != http.StatusOK {
		t.Fatalf("owner upload: expected 200, got %d: %s", ok.Code, ok.Body.String())
	}

	// Non-owner user upload is denied.
	bobToken := mintToken(t, env.key, testKid, "bob", "user")
	denied := doRequest(t, env.handler, http.MethodPut, "/api/user/v1/files/agent-1/content?path=notes.md", "hello", bobToken)
	if denied.Code != http.StatusForbidden {
		t.Fatalf("non-owner upload: expected 403, got %d", denied.Code)
	}

	// Operators may not mutate another user's files (owner-only writes).
	opToken := mintToken(t, env.key, testKid, "test-admin", "operator")
	opDenied := doRequest(t, env.handler, http.MethodPut, "/api/user/v1/files/agent-1/content?path=notes.md", "hello", opToken)
	if opDenied.Code != http.StatusForbidden {
		t.Fatalf("operator upload to another user's files: expected 403, got %d", opDenied.Code)
	}
}

func TestFileContentDeleteOwnerOnly(t *testing.T) {
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/v1/agents/agent-1" && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"user_id":"alice"}`))
		case r.URL.Path == "/api/v1/files/agent-1/content" && r.Method == http.MethodDelete:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		default:
			t.Errorf("unexpected upstream: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer bus.Close()

	env := newTestEnv(t, "user", api.Backends{BusURL: bus.URL})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "alice"})

	// Owner delete succeeds.
	aliceToken := mintToken(t, env.key, testKid, "alice", "user")
	ok := doRequest(t, env.handler, http.MethodDelete, "/api/user/v1/files/agent-1/content?path=notes.md", "", aliceToken)
	if ok.Code != http.StatusOK {
		t.Fatalf("owner delete: expected 200, got %d: %s", ok.Code, ok.Body.String())
	}

	// Non-owner user delete is denied.
	bobToken := mintToken(t, env.key, testKid, "bob", "user")
	denied := doRequest(t, env.handler, http.MethodDelete, "/api/user/v1/files/agent-1/content?path=notes.md", "", bobToken)
	if denied.Code != http.StatusForbidden {
		t.Fatalf("non-owner delete: expected 403, got %d", denied.Code)
	}

	// Operators may not delete another user's files files (owner-only).
	opToken := mintToken(t, env.key, testKid, "test-admin", "operator")
	opDenied := doRequest(t, env.handler, http.MethodDelete, "/api/user/v1/files/agent-1/content?path=notes.md", "", opToken)
	if opDenied.Code != http.StatusForbidden {
		t.Fatalf("operator delete to another user's files: expected 403, got %d", opDenied.Code)
	}
}

func TestFilesProxyRetriesTransientFailure(t *testing.T) {
	calls := 0
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls < 2 {
			http.Error(w, `{"error":"hypervisor tunnel not registered"}`, http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"agent_id":"agent-1","entries":[{"name":"notes.md","is_dir":false,"size":10}]}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "support", api.Backends{BusURL: bus.URL})

	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/files/agent-1", "", env.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 after retry, got %d: %s", rec.Code, rec.Body.String())
	}
	if calls < 2 {
		t.Fatalf("expected at least 2 upstream calls, got %d", calls)
	}
	if !strings.Contains(rec.Body.String(), "notes.md") {
		t.Fatalf("expected file entries in payload: %s", rec.Body.String())
	}
}

func TestFilesProxyNoRetryOnNotFound(t *testing.T) {
	calls := 0
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		http.Error(w, `{"error":"file not found"}`, http.StatusNotFound)
	}))
	defer bus.Close()

	env := newTestEnv(t, "support", api.Backends{BusURL: bus.URL})

	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/files/agent-1/content?path=missing.md", "", env.token)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
	if calls != 1 {
		t.Fatalf("expected exactly 1 upstream call for a 404, got %d", calls)
	}
}

// TestCreateAgentDefaultsUserIDToSelf verifies operator/admin self-service
// creation works without an explicit user_id: the caller's identity is used.
func TestCreateAgentDefaultsUserIDToSelf(t *testing.T) {
	var calls []string
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "operator", api.Backends{BusURL: bus.URL})

	rec := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/agents",
		`{"display_name":"Research Assistant"}`, env.token)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	// The row is this service's, so it is written here, under the caller's
	// identity — not forwarded as a create request to the bus.
	var created store.AgentRecord
	for _, a := range env.store.agents {
		created = a
	}
	if created.UserID != "test-admin" {
		t.Fatalf("expected user_id defaulted to caller identity, got %q", created.UserID)
	}
	if created.TypeID != "build" {
		t.Fatalf("expected the default type, got %q", created.TypeID)
	}

	// The bus still owns the container queue and the SSE broadcast.
	want := []string{"POST /api/v1/internal/container-requests", "POST /api/v1/internal/agents-changed"}
	for _, w := range want {
		found := false
		for _, c := range calls {
			if c == w {
				found = true
			}
		}
		if !found {
			t.Fatalf("expected %s, got %v", w, calls)
		}
	}
}

// TestFileMkdirAndRenameProxyOwnerOnly verifies the mkdir/rename proxy
// endpoints forward to the bus and are owner-only writes.
func TestFileMkdirAndRenameProxyOwnerOnly(t *testing.T) {
	var mkdirPath, renamePath string
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/v1/agents/agent-1" && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"user_id":"alice"}`))
		case r.URL.Path == "/api/v1/files/agent-1/mkdir" && r.Method == http.MethodPost:
			mkdirPath = r.URL.RawQuery
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		case r.URL.Path == "/api/v1/files/agent-1/rename" && r.Method == http.MethodPost:
			renamePath = r.URL.RawQuery
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		default:
			t.Errorf("unexpected upstream: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer bus.Close()

	env := newTestEnv(t, "user", api.Backends{BusURL: bus.URL})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "alice"})
	aliceToken := mintToken(t, env.key, testKid, "alice", "user")
	bobToken := mintToken(t, env.key, testKid, "bob", "user")

	// Owner can create a folder and rename.
	mkdir := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/files/agent-1/mkdir?path=folder", "", aliceToken)
	if mkdir.Code != http.StatusOK {
		t.Fatalf("owner mkdir: expected 200, got %d: %s", mkdir.Code, mkdir.Body.String())
	}
	if mkdirPath != "path=folder" {
		t.Fatalf("expected mkdir forwarded with path=folder, got %q", mkdirPath)
	}

	rename := doRequest(t, env.handler, http.MethodPost,
		"/api/user/v1/files/agent-1/rename?path=folder%2Fnotes.md&to=folder%2Frenamed.md", "", aliceToken)
	if rename.Code != http.StatusOK {
		t.Fatalf("owner rename: expected 200, got %d: %s", rename.Code, rename.Body.String())
	}
	if renamePath != "path=folder%2Fnotes.md&to=folder%2Frenamed.md" {
		t.Fatalf("expected rename forwarded with source and target, got %q", renamePath)
	}

	// Non-owner user is denied.
	denied := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/files/agent-1/mkdir?path=folder", "", bobToken)
	if denied.Code != http.StatusForbidden {
		t.Fatalf("non-owner mkdir: expected 403, got %d", denied.Code)
	}

	// Operators may not mutate another user's files.
	opToken := mintToken(t, env.key, testKid, "test-admin", "operator")
	opDenied := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/files/agent-1/mkdir?path=folder", "", opToken)
	if opDenied.Code != http.StatusForbidden {
		t.Fatalf("operator mkdir on another user's files: expected 403, got %d", opDenied.Code)
	}
}

func TestShortcutsCRUDRoundTrip(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	do := func(method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+env.token)
		rec := httptest.NewRecorder()
		env.handler.ServeHTTP(rec, req)
		return rec
	}

	// Add a shortcut.
	add := do(http.MethodPost, "/api/user/v1/me/shortcuts", `{"agent_id":"agent-1","path":"agents/Alice","label":"Home"}`)
	if add.Code != http.StatusCreated {
		t.Fatalf("add: expected 201, got %d: %s", add.Code, add.Body.String())
	}

	// List returns it scoped to the caller.
	list := do(http.MethodGet, "/api/user/v1/me/shortcuts?agentID=agent-1", "")
	if list.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d", list.Code)
	}
	if !strings.Contains(list.Body.String(), "agents/Alice") {
		t.Fatalf("expected shortcut in list, got: %s", list.Body.String())
	}

	var resp struct {
		Shortcuts []map[string]any `json:"shortcuts"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	id := int64(resp.Shortcuts[0]["id"].(float64))

	// Delete it.
	del := do(http.MethodDelete, "/api/user/v1/me/shortcuts/"+fmt.Sprintf("%d", id), "")
	if del.Code != http.StatusOK {
		t.Fatalf("delete: expected 200, got %d: %s", del.Code, del.Body.String())
	}

	list2 := do(http.MethodGet, "/api/user/v1/me/shortcuts?agentID=agent-1", "")
	if strings.Contains(list2.Body.String(), "agents/Alice") {
		t.Fatalf("expected shortcut removed, got: %s", list2.Body.String())
	}
}

func TestGitProxyForwardsToBus(t *testing.T) {
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/agents/agent-1" {
			// Owner lookup for access control ("test-admin" is the JWT sub).
			_, _ = w.Write([]byte(`{"user_id":"test-admin"}`))
			return
		}
		if r.URL.Path != "/api/v1/git/agent-1/status" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.URL.Query().Get("path") != "work/proj" {
			t.Errorf("unexpected query: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"branch":"main","repo_root":"/home/user/work/proj"}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "user", api.Backends{BusURL: bus.URL})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "test-admin"})
	req := httptest.NewRequest(http.MethodGet, "/api/user/v1/git/agent-1/status?path=work/proj", nil)
	req.SetPathValue("agentID", "agent-1")
	req.SetPathValue("rest", "status")
	req.Header.Set("Authorization", "Bearer "+env.token)
	rec := httptest.NewRecorder()
	env.handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "main") {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

func TestGitProxyMutationOwnerOnly(t *testing.T) {
	// Operators may not mutate another user's git working tree.
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"user_id":"someone-else"}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "operator", api.Backends{BusURL: bus.URL})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "someone-else"})
	req := httptest.NewRequest(http.MethodPost, "/api/user/v1/git/agent-1/commit", strings.NewReader(`{"path":"work/proj","message":"x"}`))
	req.SetPathValue("agentID", "agent-1")
	req.SetPathValue("rest", "commit")
	req.Header.Set("Authorization", "Bearer "+env.token)
	rec := httptest.NewRecorder()
	env.handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for cross-user mutation, got %d", rec.Code)
	}
}

func TestUserManagementSectionGating(t *testing.T) {
	env := newTestEnv(t, "operator", api.Backends{})
	rec := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/users", "", env.token)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("devops (operator) must not access user management: got %d", rec.Code)
	}

	auditor := newTestEnv(t, "auditor", api.Backends{})
	arec := doRequest(t, auditor.handler, http.MethodGet, "/api/admin/v1/users", "", auditor.token)
	if arec.Code != http.StatusForbidden {
		t.Fatalf("audit must not access user management: got %d", arec.Code)
	}
}

func TestUserManagementLifecycle(t *testing.T) {
	env := newTestEnv(t, "support", api.Backends{BusURL: "http://127.0.0.1:1"})

	// List includes role and excludes deleted by default.
	list := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/users", "", env.token)
	if list.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d", list.Code)
	}
	if !strings.Contains(list.Body.String(), `"role":"support"`) {
		t.Fatalf("list must include role: %s", list.Body.String())
	}

	// Operations may change a non-admin role.
	role := doRequest(t, env.handler, http.MethodPatch, "/api/admin/v1/users/carol/role", `{"role":"auditor"}`, env.token)
	if role.Code != http.StatusOK {
		t.Fatalf("role change: expected 200, got %d: %s", role.Code, role.Body.String())
	}

	// Operations may freeze, delete and restore a non-admin.
	freeze := doRequest(t, env.handler, http.MethodPost, "/api/admin/v1/users/carol/freeze", "", env.token)
	if freeze.Code != http.StatusOK {
		t.Fatalf("freeze: expected 200, got %d: %s", freeze.Code, freeze.Body.String())
	}
	del := doRequest(t, env.handler, http.MethodDelete, "/api/admin/v1/users/carol", "", env.token)
	if del.Code != http.StatusOK {
		t.Fatalf("delete: expected 200, got %d: %s", del.Code, del.Body.String())
	}
	hidden := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/users", "", env.token)
	if strings.Contains(hidden.Body.String(), "carol") {
		t.Fatalf("deleted user must be hidden by default: %s", hidden.Body.String())
	}
	shown := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/users?include_deleted=true", "", env.token)
	if !strings.Contains(shown.Body.String(), "carol") {
		t.Fatalf("deleted user must appear with include_deleted: %s", shown.Body.String())
	}
	restore := doRequest(t, env.handler, http.MethodPost, "/api/admin/v1/users/carol/restore", "", env.token)
	if restore.Code != http.StatusOK {
		t.Fatalf("restore: expected 200, got %d: %s", restore.Code, restore.Body.String())
	}

	// Reset password returns a one-time temporary password.
	reset := doRequest(t, env.handler, http.MethodPost, "/api/admin/v1/users/carol/reset-password", "", env.token)
	if reset.Code != http.StatusOK {
		t.Fatalf("reset: expected 200, got %d: %s", reset.Code, reset.Body.String())
	}
	if !strings.Contains(reset.Body.String(), "temp_password") {
		t.Fatalf("reset must return a temp password: %s", reset.Body.String())
	}
}

func TestOperationsCannotManageAdmins(t *testing.T) {
	env := newTestEnv(t, "support", api.Backends{})

	role := doRequest(t, env.handler, http.MethodPatch, "/api/admin/v1/users/alice/role", `{"role":"user"}`, env.token)
	if role.Code != http.StatusForbidden {
		t.Fatalf("operations editing admin: expected 403, got %d", role.Code)
	}
	grant := doRequest(t, env.handler, http.MethodPatch, "/api/admin/v1/users/carol/role", `{"role":"admin"}`, env.token)
	if grant.Code != http.StatusForbidden {
		t.Fatalf("operations granting admin: expected 403, got %d", grant.Code)
	}
	freeze := doRequest(t, env.handler, http.MethodPost, "/api/admin/v1/users/alice/freeze", "", env.token)
	if freeze.Code != http.StatusForbidden {
		t.Fatalf("operations freezing admin: expected 403, got %d", freeze.Code)
	}
}

func TestLastAdminProtectionAndSelfMutation(t *testing.T) {
	env := newTestEnv(t, "admin", api.Backends{})

	// alice is the only admin in the sample repository.
	demote := doRequest(t, env.handler, http.MethodPatch, "/api/admin/v1/users/alice/role", `{"role":"user"}`, env.token)
	if demote.Code != http.StatusConflict {
		t.Fatalf("demoting last admin: expected 409, got %d: %s", demote.Code, demote.Body.String())
	}

	// Self freeze is blocked (token subject is test-admin; use bob as self).
	selfEnv := newTestEnv(t, "support", api.Backends{})
	selfToken := mintToken(t, selfEnv.key, testKid, "bob", "support")
	selfFreeze := doRequest(t, selfEnv.handler, http.MethodPost, "/api/admin/v1/users/bob/freeze", "", selfToken)
	if selfFreeze.Code != http.StatusBadRequest {
		t.Fatalf("self freeze: expected 400, got %d", selfFreeze.Code)
	}
}

func TestAdminCanManageUsers(t *testing.T) {
	env := newTestEnv(t, "admin", api.Backends{})
	// Admin may assign the admin role.
	grant := doRequest(t, env.handler, http.MethodPatch, "/api/admin/v1/users/carol/role", `{"role":"admin"}`, env.token)
	if grant.Code != http.StatusOK {
		t.Fatalf("admin grant: expected 200, got %d: %s", grant.Code, grant.Body.String())
	}
	tier := doRequest(t, env.handler, http.MethodPatch, "/api/admin/v1/users/carol/tier", `{"tier":"ultra"}`, env.token)
	if tier.Code != http.StatusOK {
		t.Fatalf("admin tier: expected 200, got %d: %s", tier.Code, tier.Body.String())
	}
}

// Directory-managed accounts must not be given a platform password: writing one
// would create a second, working credential next to the directory login.
func TestDirectoryAccountPasswordIsRefused(t *testing.T) {
	env := newTestEnv(t, "support", api.Backends{})

	reset := doRequest(t, env.handler, http.MethodPost, "/api/admin/v1/users/dave/reset-password", "", env.token)
	if reset.Code != http.StatusConflict {
		t.Fatalf("reset for a directory account: expected 409, got %d: %s", reset.Code, reset.Body.String())
	}

	// The account itself may not rotate it either.
	own := mintToken(t, env.key, testKid, "dave", "user")
	change := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/me/password",
		`{"current_password":"whatever","new_password":"newpassword123"}`, own)
	if change.Code != http.StatusConflict {
		t.Fatalf("own password change for a directory account: expected 409, got %d: %s", change.Code, change.Body.String())
	}

	// A local account is unaffected by the guard.
	local := doRequest(t, env.handler, http.MethodPost, "/api/admin/v1/users/bob/reset-password", "", env.token)
	if local.Code != http.StatusOK {
		t.Fatalf("reset for a local account: expected 200, got %d: %s", local.Code, local.Body.String())
	}
}

// The user list tells the console which accounts sign in through the directory.
func TestUserListReportsDirectoryAccounts(t *testing.T) {
	env := newTestEnv(t, "support", api.Backends{})

	list := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/users", "", env.token)
	if list.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d", list.Code)
	}
	if !strings.Contains(list.Body.String(), `"auth_source":"ldap"`) {
		t.Fatalf("the list must mark directory accounts: %s", list.Body.String())
	}
	if !strings.Contains(list.Body.String(), `"auth_source":""`) {
		t.Fatalf("local accounts must carry an empty auth_source: %s", list.Body.String())
	}
}

func TestChangeOwnPassword(t *testing.T) {
	env := newTestEnv(t, "support", api.Backends{})
	token := mintToken(t, env.key, testKid, "bob", "support")

	ok := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/me/password",
		`{"current_password":"oldpassword","new_password":"newpassword123"}`, token)
	if ok.Code != http.StatusOK {
		t.Fatalf("change password: expected 200, got %d: %s", ok.Code, ok.Body.String())
	}

	bad := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/me/password",
		`{"current_password":"wrong","new_password":"newpassword123"}`, token)
	if bad.Code != http.StatusUnauthorized {
		t.Fatalf("wrong current password: expected 401, got %d", bad.Code)
	}

	short := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/me/password",
		`{"current_password":"oldpassword","new_password":"short"}`, token)
	if short.Code != http.StatusBadRequest {
		t.Fatalf("short password: expected 400, got %d", short.Code)
	}
}

func TestAuditSectionAccess(t *testing.T) {
	env := newTestEnv(t, "auditor", api.Backends{})

	for _, path := range []string{
		"/api/admin/v1/audit",
		"/api/admin/v1/conversations",
		"/api/admin/v1/runtime",
	} {
		rec := doRequest(t, env.handler, http.MethodGet, path, "", env.token)
		if rec.Code != http.StatusOK {
			t.Fatalf("audit role GET %s: expected 200, got %d: %s", path, rec.Code, rec.Body.String())
		}
	}

	// Audit role may not manage users.
	users := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/users", "", env.token)
	if users.Code != http.StatusForbidden {
		t.Fatalf("audit role GET /users: expected 403, got %d", users.Code)
	}
}

func TestManagementSectionAccess(t *testing.T) {
	env := newTestEnv(t, "operator", api.Backends{})

	// DevOps (operator) can read the platform catalog.
	configs := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/configs", "", env.token)
	if configs.Code != http.StatusOK {
		t.Fatalf("devops GET /configs: expected 200, got %d", configs.Code)
	}

	// DevOps may not manage users or read the audit section.
	users := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/users", "", env.token)
	if users.Code != http.StatusForbidden {
		t.Fatalf("devops GET /users: expected 403, got %d", users.Code)
	}
	audit := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/audit", "", env.token)
	if audit.Code != http.StatusForbidden {
		t.Fatalf("devops GET /audit: expected 403, got %d", audit.Code)
	}
}

func TestConversationAndRuntimePayloads(t *testing.T) {
	env := newTestEnv(t, "admin", api.Backends{})
	seedRecord(env, store.SessionRecord{
		ID: "agent-1:cli:demo:v1", AgentID: "agent-1", AccountID: "alice",
		Channel: "cli", ChatID: "demo", Messages: `[{"role":"user","content":"hi"}]`,
		MessageCount: 1, MessagesBytes: 32,
	})

	conversations := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/conversations", "", env.token)
	if conversations.Code != http.StatusOK || !strings.Contains(conversations.Body.String(), "agent-1:cli:demo:v1") {
		t.Fatalf("conversations: expected sample session, got %d: %s", conversations.Code, conversations.Body.String())
	}

	detail := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/conversations/agent-1:cli:demo:v1", "", env.token)
	if detail.Code != http.StatusOK || !strings.Contains(detail.Body.String(), "messages") {
		t.Fatalf("conversation detail: expected messages, got %d: %s", detail.Code, detail.Body.String())
	}

	runtime := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/runtime", "", env.token)
	if runtime.Code != http.StatusOK || !strings.Contains(runtime.Body.String(), "runner-primary") {
		t.Fatalf("runtime: expected snapshot, got %d: %s", runtime.Code, runtime.Body.String())
	}
}

// The metadata-only read is the resume check's shape: `?meta=1` answers without
// the history blob, so a finished turn is reconciled for a few hundred bytes
// rather than a multi-MiB transcript.
func TestSessionGetMetaReadIsCheap(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	seedRecord(env, store.SessionRecord{
		ID: "web:c1:v2", AgentID: "agent-1", AccountID: "test-admin",
		Messages: `[{"role":"user","content":"full history"}]`, MessageCount: 1,
	})

	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/sessions/web:c1:v2?meta=1", "", env.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "full history") {
		t.Fatalf("the meta read carried the messages: %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"session_id":"web:c1:v2"`) {
		t.Fatalf("unexpected payload: %s", rec.Body.String())
	}
}

// The bus refuses its internal endpoints to anonymous callers, and everything
// the portal forwards travels over one proxy client, so that client has to
// carry the shared token.
func TestProxiedBusRequestCarriesTheInternalToken(t *testing.T) {
	t.Setenv("NANOSEC_BUS_INTERNAL_TOKEN", "s3cret")

	var got string
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"agent_id":"agent-1","path":"","entries":[]}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "support", api.Backends{BusURL: bus.URL})

	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/files/agent-1", "", env.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if got != "Bearer s3cret" {
		t.Fatalf("bus saw Authorization = %q, want the configured token", got)
	}
}
