package api_test

import (
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
