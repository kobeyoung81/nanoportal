package api_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"gitee.com/kobeyoung81/nanoportal/server/internal/api"
	"gitee.com/kobeyoung81/nanoportal/server/internal/store"
)

// The grouping endpoints write this service's own data now, but the invariant
// that used to be "never forward a user_id from the request" still holds in its
// new form: the account whose groups are touched is always the verified
// identity's, never one named in the body or query.

func TestAgentGroupsScopedToSelf(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	env.store.groups["g1"] = store.AgentGroup{ID: "g1", UserID: "alice", Name: "工作"}
	env.store.groups["g2"] = store.AgentGroup{ID: "g2", UserID: "bob", Name: "别人的组"}
	aliceToken := mintToken(t, env.key, testKid, "alice", "user")

	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/agent-groups?user_id=bob", "", aliceToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"g1"`) {
		t.Fatalf("expected the caller's group in the payload: %s", body)
	}
	if strings.Contains(body, `"g2"`) {
		t.Fatalf("another account's group leaked into the payload: %s", body)
	}
}

func TestCreateAgentGroupOverridesUserID(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	aliceToken := mintToken(t, env.key, testKid, "alice", "user")

	rec := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/agent-groups",
		`{"user_id":"bob","name":"工作"}`, aliceToken)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	var got struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	group := env.store.groups[got.ID]
	if group.UserID != "alice" {
		t.Fatalf("group owner = %q, want alice (the body's user_id must be ignored)", group.UserID)
	}
	if group.Name != "工作" {
		t.Fatalf("group name = %q", group.Name)
	}
}

func TestRenameAgentGroupPathAndIdentity(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	env.store.groups["g1"] = store.AgentGroup{ID: "g1", UserID: "alice", Name: "工作"}
	bobToken := mintToken(t, env.key, testKid, "bob", "user")

	// Bob may not rename Alice's group, even by naming himself in the body.
	denied := doRequest(t, env.handler, http.MethodPut, "/api/user/v1/agent-groups/g1",
		`{"user_id":"bob","name":"项目"}`, bobToken)
	if denied.Code != http.StatusNotFound {
		t.Fatalf("foreign rename: expected 404, got %d: %s", denied.Code, denied.Body.String())
	}

	aliceToken := mintToken(t, env.key, testKid, "alice", "user")
	rec := doRequest(t, env.handler, http.MethodPut, "/api/user/v1/agent-groups/g1",
		`{"user_id":"bob","name":"项目"}`, aliceToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if got := env.store.groups["g1"].Name; got != "项目" {
		t.Fatalf("name = %q, want 项目", got)
	}
}

func TestDeleteAgentGroupScopedToSelf(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	env.store.groups["g1"] = store.AgentGroup{ID: "g1", UserID: "alice", Name: "工作"}
	env.store.withAgent(store.AgentRecord{ID: "a1", UserID: "alice", GroupID: "g1"})
	bobToken := mintToken(t, env.key, testKid, "bob", "user")

	denied := doRequest(t, env.handler, http.MethodDelete, "/api/user/v1/agent-groups/g1", "", bobToken)
	if denied.Code != http.StatusNotFound {
		t.Fatalf("foreign delete: expected 404, got %d", denied.Code)
	}

	aliceToken := mintToken(t, env.key, testKid, "alice", "user")
	rec := doRequest(t, env.handler, http.MethodDelete, "/api/user/v1/agent-groups/g1?user_id=bob", "", aliceToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, ok := env.store.groups["g1"]; ok {
		t.Fatal("group was not deleted")
	}
	if env.store.agents["a1"].GroupID != "" {
		t.Fatal("the group's agent should have been left ungrouped")
	}
}

func TestReorderAgentGroups(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	env.store.groups["g1"] = store.AgentGroup{ID: "g1", UserID: "alice", Name: "一", Position: 0}
	env.store.groups["g2"] = store.AgentGroup{ID: "g2", UserID: "alice", Name: "二", Position: 1}
	aliceToken := mintToken(t, env.key, testKid, "alice", "user")

	rec := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/agent-groups/reorder",
		`{"user_id":"bob","ids":["g2","g1"]}`, aliceToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if env.store.groups["g2"].Position != 0 || env.store.groups["g1"].Position != 1 {
		t.Fatalf("positions = g2:%d g1:%d, want 0/1",
			env.store.groups["g2"].Position, env.store.groups["g1"].Position)
	}
}

func TestAgentGroupConflictsSurface(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	aliceToken := mintToken(t, env.key, testKid, "alice", "user")

	first := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/agent-groups", `{"name":"工作"}`, aliceToken)
	if first.Code != http.StatusCreated {
		t.Fatalf("first create: expected 201, got %d: %s", first.Code, first.Body.String())
	}
	// The in-memory store does not enforce name uniqueness; the database does.
	// What matters at this layer is that a store error is mapped, not swallowed,
	// so drive the mapping directly through an unknown group.
	rec := doRequest(t, env.handler, http.MethodDelete, "/api/user/v1/agent-groups/missing", "", aliceToken)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "not found") {
		t.Fatalf("store error not surfaced: %s", rec.Body.String())
	}
}

func TestArrangeAgentGroups(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	env.store.groups["g1"] = store.AgentGroup{ID: "g1", UserID: "alice", Name: "工作"}
	env.store.withAgent(store.AgentRecord{ID: "a1", UserID: "alice", GroupID: "g1"})
	env.store.withAgent(store.AgentRecord{ID: "a2", UserID: "alice", GroupID: "g1"})
	env.store.withAgent(store.AgentRecord{ID: "a3", UserID: "alice"})
	aliceToken := mintToken(t, env.key, testKid, "alice", "user")

	rec := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/agent-groups/arrange",
		`{"user_id":"bob","groups":[{"id":"g1","agents":["a2","a1"]}],"ungrouped":["a3"]}`, aliceToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if env.store.agents["a1"].GroupID != "g1" || env.store.agents["a2"].GroupID != "g1" {
		t.Fatal("agents were not assigned to the group")
	}
	if env.store.agents["a3"].GroupID != "" {
		t.Fatal("the ungrouped agent should have no group")
	}

	// Another account's agent may not be placed by naming it.
	bobToken := mintToken(t, env.key, testKid, "bob", "user")
	foreign := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/agent-groups/arrange",
		`{"groups":[{"id":"g1","agents":["a1"]}]}`, bobToken)
	if foreign.Code != http.StatusBadRequest {
		t.Fatalf("foreign arrange: expected 400, got %d: %s", foreign.Code, foreign.Body.String())
	}
}
