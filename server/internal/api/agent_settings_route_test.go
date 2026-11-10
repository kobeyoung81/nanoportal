package api_test

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"gitee.com/kobeyoung81/nanoportal/server/internal/api"
	"gitee.com/kobeyoung81/nanoportal/server/internal/repository"
	"gitee.com/kobeyoung81/nanoportal/server/internal/store"
)

// stubRepo serves the config-plane lookups the echo makes, so a platform
// default can be put in place without a database. Embedded interface: only
// GetConfigValues is exercised on this path.
type stubRepo struct {
	repository.Repository
	values map[string]string
}

func (s stubRepo) GetConfigValues(context.Context, string, []string) (map[string]string, error) {
	return s.values, nil
}

// A platform default set on the per-agent config key is what the agent applies,
// so it is what the form must show for "inherit".
func TestAgentSetting_PlatformPerAgentKeyWins(t *testing.T) {
	repo := stubRepo{values: map[string]string{
		"agent.agent-1.scheduledTaskMode": "plan",
		"agent.scheduledTaskMode":         "build",
	}}
	env := newTestEnvWithRepo(t, "user", api.Backends{}, repo)
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "test-admin", DisplayName: "A"})

	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/agents/agent-1/settings/scheduled_task_mode", "", env.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, want := range []string{`"platform_default":"plan"`, `"effective":"plan"`, `"source":"platform"`} {
		if !strings.Contains(body, want) {
			t.Errorf("body %s is missing %s", body, want)
		}
	}
}

// The read is owner-scoped and key-whitelisted; it must never become a way to
// read deployment configuration (the agent component holds secrets).
func TestAgentSetting_Guards(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "alice", DisplayName: "A"})

	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/agents/agent-1/settings/scheduled_task_mode", "", env.token)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("foreign agent: status = %d, want 403", rec.Code)
	}

	env.store.withAgent(store.AgentRecord{ID: "agent-2", UserID: "test-admin", DisplayName: "B"})
	rec = doRequest(t, env.handler, http.MethodGet, "/api/user/v1/agents/agent-2/settings/media.corpSecret", "", env.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown key: status = %d, want 400", rec.Code)
	}
}

// The happy path reports the agent's own value and its source, which is what
// the form shows next to "inherit".
func TestAgentSetting_ReportsValueAndSource(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	env.store.withAgent(store.AgentRecord{
		ID: "agent-1", UserID: "test-admin", DisplayName: "A",
		Settings: map[string]string{"scheduled_task_mode": "plan"},
	})

	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/agents/agent-1/settings/scheduled_task_mode", "", env.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, want := range []string{`"agent_value":"plan"`, `"effective":"plan"`, `"source":"agent"`, `"platform_default":"build"`} {
		if !strings.Contains(body, want) {
			t.Errorf("body %s is missing %s", body, want)
		}
	}
}
