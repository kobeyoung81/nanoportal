package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gitee.com/kobeyoung81/nanoportal/server/internal/api"
	"gitee.com/kobeyoung81/nanoportal/server/internal/bustoken"
	"gitee.com/kobeyoung81/nanoportal/server/internal/store"
)

// The internal endpoints are service-to-service calls, not user traffic: no JWT,
// one shared token. The guard must fail closed in every direction.
func TestInternalEndpointsRequireTheSharedToken(t *testing.T) {
	t.Setenv(bustoken.EnvVar, "shared-token")
	env := newTestEnv(t, "user", api.Backends{})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "alice"})

	cases := []struct {
		name  string
		token string
		want  int
	}{
		{"no token", "", http.StatusUnauthorized},
		{"wrong token", "nope", http.StatusUnauthorized},
		{"right token", "shared-token", http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := doRequest(t, env.handler, http.MethodPost, "/internal/v1/agents/agent-1/status", `{"status":"running"}`, tc.token)
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d (%s)", rec.Code, tc.want, rec.Body.String())
			}
		})
	}

	// A non-bearer scheme is refused too: the header's shape is part of the check.
	req := httptest.NewRequest(http.MethodPost, "/internal/v1/agents/agent-1/status", strings.NewReader(`{"status":"running"}`))
	req.Header.Set("Authorization", "Basic shared-token")
	rec := httptest.NewRecorder()
	env.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("basic scheme: status = %d, want 401", rec.Code)
	}
}

// An unconfigured token must refuse every internal call instead of opening up.
func TestInternalEndpointsFailClosedWithoutAToken(t *testing.T) {
	t.Setenv(bustoken.EnvVar, "")
	env := newTestEnv(t, "user", api.Backends{})

	rec := doRequest(t, env.handler, http.MethodPost, "/internal/v1/agent-types/build/clear-refs", `{}`, "")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}

// The two internal writes map onto the store the rest of the agent surface uses.
func TestInternalEndpointsWriteTheAgentStore(t *testing.T) {
	t.Setenv(bustoken.EnvVar, "shared-token")
	env := newTestEnv(t, "user", api.Backends{})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "alice", TypeID: "build"})

	rec := doRequest(t, env.handler, http.MethodPost, "/internal/v1/agents/agent-1/status", `{"status":"running"}`, "shared-token")
	if rec.Code != http.StatusOK {
		t.Fatalf("status update: %d %s", rec.Code, rec.Body.String())
	}
	if got := env.store.agents["agent-1"].Status; got != "running" {
		t.Fatalf("stored status = %q, want running", got)
	}

	rec = doRequest(t, env.handler, http.MethodPost, "/internal/v1/agent-types/build/clear-refs", `{}`, "shared-token")
	if rec.Code != http.StatusOK {
		t.Fatalf("clear refs: %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"cleared":1`) {
		t.Fatalf("expected one cleared reference: %s", rec.Body.String())
	}
	if got := env.store.agents["agent-1"].TypeID; got != "" {
		t.Fatalf("type_id = %q, want cleared", got)
	}
}

// A user JWT must not be accepted where the shared token is required.
func TestInternalEndpointsRejectAUserJWT(t *testing.T) {
	t.Setenv(bustoken.EnvVar, "shared-token")
	env := newTestEnv(t, "user", api.Backends{})

	rec := doRequest(t, env.handler, http.MethodPost, "/internal/v1/agents/agent-1/status", `{"status":"running"}`, env.token)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

// TestInternalGetAgentAnswersOwnership: the workspace service serves files by
// agent id and has no database; this endpoint is the one fact it needs.
func TestInternalGetAgentAnswersOwnership(t *testing.T) {
	t.Setenv(bustoken.EnvVar, "shared-token")
	env := newTestEnv(t, "user", api.Backends{})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "alice"})

	rec := doRequest(t, env.handler, http.MethodGet, "/internal/v1/agents/agent-1", "", "shared-token")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); !strings.Contains(got, `"user_id":"alice"`) || !strings.Contains(got, `"id":"agent-1"`) {
		t.Fatalf("payload = %s", got)
	}

	missing := doRequest(t, env.handler, http.MethodGet, "/internal/v1/agents/agent-404", "", "shared-token")
	if missing.Code != http.StatusNotFound {
		t.Fatalf("unknown agent: status = %d, want 404", missing.Code)
	}

	// It is an internal endpoint like the others: no token, no answer.
	if unauth := doRequest(t, env.handler, http.MethodGet, "/internal/v1/agents/agent-1", "", ""); unauth.Code != http.StatusUnauthorized {
		t.Fatalf("no token: status = %d, want 401", unauth.Code)
	}
}

// The browser's agent list must not carry rows the user deleted. The supervisor
// shares this endpoint and asks for them explicitly: it has to know a deleted row
// exists so it never resurrects it.
func TestInternalListAgentsHidesDeletedUnlessAsked(t *testing.T) {
	t.Setenv(bustoken.EnvVar, "shared-token")
	env := newTestEnv(t, "user", api.Backends{})
	env.store.
		withAgent(store.AgentRecord{ID: "agent-live", UserID: "alice", DisplayName: "Live"}).
		withAgent(store.AgentRecord{ID: "agent-gone", UserID: "alice", DisplayName: "Gone", Status: "deleted"})

	count := func(path string) int {
		t.Helper()
		rec := doRequest(t, env.handler, http.MethodGet, path, "", "shared-token")
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status = %d, want 200", path, rec.Code)
		}
		var body struct {
			Agents []map[string]any `json:"agents"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("%s: decode: %v", path, err)
		}
		return len(body.Agents)
	}

	if got := count("/internal/v1/agents?user_id=alice"); got != 1 {
		t.Fatalf("default list has %d agents, want 1 (the deleted row must stay hidden)", got)
	}
	if got := count("/internal/v1/agents?user_id=alice&include_deleted=1"); got != 2 {
		t.Fatalf("include_deleted list has %d agents, want 2", got)
	}
}
