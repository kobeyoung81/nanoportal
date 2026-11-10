package api_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"gitee.com/kobeyoung81/nanoportal/server/internal/api"
	"gitee.com/kobeyoung81/nanoportal/server/internal/bustoken"
)

// The binding's default agent is read by the gateway on every inbound channel
// message; the endpoint is internal and token-guarded like the rest.
func TestInternalBindingAgentRoutes(t *testing.T) {
	t.Setenv(bustoken.EnvVar, "shared-token")
	env := newTestEnv(t, "user", api.Backends{})
	env.store.bindings[42] = "agent-1"

	rec := doRequest(t, env.handler, http.MethodGet, "/internal/v1/bindings/42/agent", "", "shared-token")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	var out struct {
		BindingID int64  `json:"binding_id"`
		AgentID   string `json:"agent_id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.BindingID != 42 || out.AgentID != "agent-1" {
		t.Fatalf("payload = %+v", out)
	}

	// Pin another agent, then clear it.
	rec = doRequest(t, env.handler, http.MethodPut, "/internal/v1/bindings/42/agent", `{"agent_id":"agent-2"}`, "shared-token")
	if rec.Code != http.StatusOK {
		t.Fatalf("put: status = %d (%s)", rec.Code, rec.Body.String())
	}
	if env.store.bindings[42] != "agent-2" {
		t.Fatalf("preference = %q", env.store.bindings[42])
	}
	rec = doRequest(t, env.handler, http.MethodPut, "/internal/v1/bindings/42/agent", `{"agent_id":""}`, "shared-token")
	if rec.Code != http.StatusOK {
		t.Fatalf("clear: status = %d", rec.Code)
	}
	if _, ok := env.store.bindings[42]; ok {
		t.Fatal("an empty agent id must clear the preference")
	}
}

// A malformed binding id is a client error, and no JWT is accepted here.
func TestInternalBindingAgentGuards(t *testing.T) {
	t.Setenv(bustoken.EnvVar, "shared-token")
	env := newTestEnv(t, "user", api.Backends{})

	rec := doRequest(t, env.handler, http.MethodGet, "/internal/v1/bindings/not-a-number/agent", "", "shared-token")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad id: status = %d, want 400", rec.Code)
	}

	rec = doRequest(t, env.handler, http.MethodGet, "/internal/v1/bindings/42/agent", "", env.token)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("jwt: status = %d, want 401", rec.Code)
	}
}
