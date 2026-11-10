package api_test

import (
	"net/http"
	"strings"
	"testing"

	"gitee.com/kobeyoung81/nanoportal/server/internal/api"
	"gitee.com/kobeyoung81/nanoportal/server/internal/store"
)

// A display name is what the sidebar shows, so a duplicate within one account is
// refused before anything is written.
func TestCreateAgentRefusesADuplicateName(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "test-admin", DisplayName: "Research"})

	rec := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/agents",
		`{"display_name":"Research"}`, env.token)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409: %s", rec.Code, rec.Body.String())
	}
	if len(env.store.agents) != 1 {
		t.Fatalf("a refused create still wrote a row: %+v", env.store.agents)
	}
}

func TestCreateAgentRefusesAnUnknownGroup(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})

	rec := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/agents",
		`{"display_name":"Research","group_id":"someone-elses"}`, env.token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
	}
}

// Ownership is enforced from this service's own rows now, not from a bus lookup.
func TestUpdateAgentRefusesAForeignAgent(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "alice", DisplayName: "A"})

	rec := doRequest(t, env.handler, http.MethodPut, "/api/user/v1/agents/agent-1",
		`{"display_name":"B"}`, env.token)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if got := env.store.agents["agent-1"].DisplayName; got != "A" {
		t.Fatalf("the refused update changed the row: %q", got)
	}
}

// The wire shape must stay the one the browser consumes: session agents, the
// default agent, and an empty tools/workspaces array (not null).
func TestAgentPayloadShape(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "test-admin", TypeID: "build", DisplayName: "A"})

	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/agents/agent-1", "", env.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, want := range []string{
		`"id":"agent-1"`, `"type_id":"build"`, `"session_agents":["build","plan"]`,
		`"default_agent":"build"`, `"tools":[]`, `"workspaces":[]`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("payload is missing %s: %s", want, body)
		}
	}
}

// A pending question in the meta blob drives the sidebar's second dot; the
// parse must tolerate everything the agent may have written there.
func TestMetaHasPendingViaTheAttentionPayload(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "test-admin"})
	env.store.attention = []store.ConversationAttention{
		{AgentID: "agent-1", ChatID: "c1", SessionID: "web:c1", Meta: `{"_pending_approval":"{\"tool\":\"bash\"}"}`},
		{AgentID: "agent-1", ChatID: "c2", SessionID: "web:c2", Meta: `{`},
		{AgentID: "agent-1", ChatID: "c3", SessionID: "web:c3", Meta: `{"_pending_question":""}`},
	}

	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/agents/attention", "", env.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if strings.Count(body, `"awaiting":true`) != 1 {
		t.Fatalf("expected exactly one awaiting conversation: %s", body)
	}
	if !strings.Contains(body, `"chat_id":"c1"`) {
		t.Fatalf("the approval did not surface: %s", body)
	}
}
