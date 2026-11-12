package api_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"gitee.com/kobeyoung81/nanoportal/server/internal/api"
	"gitee.com/kobeyoung81/nanoportal/server/internal/bustoken"
	"gitee.com/kobeyoung81/nanoportal/server/internal/store"
)

// The onboarding path asks the portal to make sure a brand-new account has an
// agent. It is idempotent, and it reports whether it created anything so the
// caller can tell a no-op from a first creation.
func TestInternalEnsureAgentCreatesThenReuses(t *testing.T) {
	t.Setenv(bustoken.EnvVar, "shared-token")
	env := newTestEnv(t, "user", api.Backends{})

	rec := doRequest(t, env.handler, http.MethodPost, "/internal/v1/users/alice/agents/ensure", `{}`, "shared-token")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var first struct {
		AgentID string `json:"agent_id"`
		Created bool   `json:"created"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &first); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if first.AgentID != "alice-default" || !first.Created {
		t.Fatalf("first ensure = %+v, want alice-default created", first)
	}

	rec = doRequest(t, env.handler, http.MethodPost, "/internal/v1/users/alice/agents/ensure", `{}`, "shared-token")
	var second struct {
		AgentID string `json:"agent_id"`
		Created bool   `json:"created"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &second); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if second.AgentID != first.AgentID || second.Created {
		t.Fatalf("second ensure = %+v, want the same agent and created=false", second)
	}

	// The row really exists in the store the handlers write to.
	got, err := env.store.GetAgent(first.AgentID)
	if err != nil || got == nil {
		t.Fatalf("get agent: %v %v", got, err)
	}
	if got.UserID != "alice" || got.Status == "deleted" {
		t.Fatalf("agent = %+v", got)
	}
}

// An existing agent of the account wins; the endpoint must not add a second one.
func TestInternalEnsureAgentKeepsAnExistingAgent(t *testing.T) {
	t.Setenv(bustoken.EnvVar, "shared-token")
	env := newTestEnv(t, "user", api.Backends{})
	env.store.withAgent(store.AgentRecord{ID: "mine", UserID: "alice", TypeID: "plan", Status: "ready"})

	rec := doRequest(t, env.handler, http.MethodPost, "/internal/v1/users/alice/agents/ensure", `{}`, "shared-token")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var out struct {
		AgentID string `json:"agent_id"`
		Created bool   `json:"created"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.AgentID != "mine" || out.Created {
		t.Fatalf("ensure = %+v, want (mine, false)", out)
	}
}

// The route is internal: it needs the shared token, not a user token.
func TestInternalEnsureAgentRequiresTheSharedToken(t *testing.T) {
	t.Setenv(bustoken.EnvVar, "shared-token")
	env := newTestEnv(t, "admin", api.Backends{})

	// A real user JWT is not enough.
	rec := doRequest(t, env.handler, http.MethodPost, "/internal/v1/users/alice/agents/ensure", `{}`, env.token)
	if rec.Code == http.StatusOK {
		t.Fatalf("a user token was accepted for an internal call (%s)", rec.Body.String())
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}
