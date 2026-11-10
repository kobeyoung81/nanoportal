package api_test

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"gitee.com/kobeyoung81/nanoportal/server/internal/api"
	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
	"gitee.com/kobeyoung81/nanoportal/server/internal/repository"
	"gitee.com/kobeyoung81/nanoportal/server/internal/store"
)

// failingAuditRepo reports an unwritable trail. Embedded interface: only
// RecordAudit is exercised on this path.
type failingAuditRepo struct {
	repository.Repository
}

func (failingAuditRepo) RecordAudit(context.Context, model.AuditEntry) error {
	return errors.New("audit store unavailable")
}

// The trail is an operation log, not a gate. A user must not lose the group (or
// the agent) they just created because the audit store is unavailable — the bus
// has always behaved this way (warn and continue), and a user-visible "audit
// write failed" is not an acceptable failure mode for an action that already
// happened.
func TestAgentGroupCreateSurvivesAnAuditFailure(t *testing.T) {
	env := newTestEnvWithRepo(t, "user", api.Backends{}, failingAuditRepo{})

	rec := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/agent-groups", `{"name":"工作"}`, env.token)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201: %s", rec.Code, rec.Body.String())
	}
	if len(env.store.groups) != 1 {
		t.Fatalf("the group was not written: %+v", env.store.groups)
	}
}

func TestAgentUpdateSurvivesAnAuditFailure(t *testing.T) {
	env := newTestEnvWithRepo(t, "user", api.Backends{}, failingAuditRepo{})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "test-admin"})

	rec := doRequest(t, env.handler, http.MethodPut, "/api/user/v1/agents/agent-1",
		`{"display_name":"Renamed"}`, env.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if got := env.store.agents["agent-1"].DisplayName; got != "Renamed" {
		t.Fatalf("the update was not applied: %q", got)
	}
}
