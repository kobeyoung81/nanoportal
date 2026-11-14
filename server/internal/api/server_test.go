package api_test

import (
	"context"
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
	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
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
	// repo is the same repository the handler uses; audit assertions read it
	// directly now that the console's audit route belongs to the admin module.
	repo repository.Repository
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
	return &testEnv{handler: handler, token: token, key: key, store: st, repo: repo}
}

// auditEntries reads the trail from the repository. The console's HTTP read for
// it belongs to the admin module now; what these tests assert is that the portal
// recorded the action.
func auditEntries(t *testing.T, env *testEnv) []model.AuditEntry {
	t.Helper()
	entries, err := env.repo.ListAudit(context.Background(), model.AuditQuery{})
	if err != nil {
		t.Fatalf("list audit: %v", err)
	}
	return entries
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

	write := doRequest(t, env.handler, http.MethodDelete, "/api/admin/v1/users/alice", "", env.token)
	if write.Code != http.StatusForbidden {
		t.Fatalf("user delete account: expected 403, got %d", write.Code)
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

	// DevOps (operator) can read the infrastructure section (the catalogues
	// themselves answered by the admin module; nginx routes them there).
	runners := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/runners", "", env.token)
	if runners.Code != http.StatusOK {
		t.Fatalf("devops GET /runners: expected 200, got %d", runners.Code)
	}

	// DevOps may not manage users or read the audit section.
	users := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/users", "", env.token)
	if users.Code != http.StatusForbidden {
		t.Fatalf("devops GET /users: expected 403, got %d", users.Code)
	}
	audit := doRequest(t, env.handler, http.MethodGet, "/api/admin/v1/conversations", "", env.token)
	if audit.Code != http.StatusForbidden {
		t.Fatalf("devops GET /conversations: expected 403, got %d", audit.Code)
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

// TestModuleRoutesAreNotServedHere keeps the split from drifting back: the
// console's configuration/catalogue/audit routes belong to the admin module and
// identity belongs to nanoauth, all reached through nginx. A route that
// reappeared here would be a second implementation behind the same URL.
func TestModuleRoutesAreNotServedHere(t *testing.T) {
	env := newTestEnv(t, "admin", api.Backends{})
	adminToken := mintToken(t, env.key, testKid, "root", "admin")

	paths := []struct{ method, path string }{
		{http.MethodGet, "/api/admin/v1/configs"},
		{http.MethodGet, "/api/admin/v1/configs/agent"},
		{http.MethodGet, "/api/admin/v1/agent-types"},
		{http.MethodGet, "/api/admin/v1/models"},
		{http.MethodGet, "/api/admin/v1/capabilities/builtin"},
		{http.MethodGet, "/api/admin/v1/audit"},
		{http.MethodGet, "/api/admin/v1/alert-rules"},
		{http.MethodGet, "/api/admin/v1/directory/effective"},
		{http.MethodPost, "/api/user/v1/auth/login"},
		{http.MethodGet, "/api/user/v1/files/agent-1"},
		{http.MethodPut, "/api/user/v1/files/agent-1/content?path=x"},
		{http.MethodGet, "/api/user/v1/git/agent-1/status"},
	}
	for _, tc := range paths {
		rec := doRequest(t, env.handler, tc.method, tc.path, "{}", adminToken)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s %s = %d, want 404: the module that owns it serves it", tc.method, tc.path, rec.Code)
		}
	}
}

// TestMetricsIsPublic: a scraper carries no token, and the exposition has no user
// data. The console and user namespaces still refuse one.
func TestMetricsIsPublic(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	rec := doRequest(t, env.handler, http.MethodGet, "/metrics", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "portal_http_requests_total") {
		t.Fatalf("the exposition has no portal metric: %.200s", rec.Body.String())
	}
}
