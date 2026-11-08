package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gitee.com/kobeyoung81/nanoportal/server/internal/api"
)

// The grouping endpoints are a thin proxy, but the one thing they must never do
// is trust a user_id from the request: ownership comes from the verified token.

func TestAgentGroupsScopedToSelf(t *testing.T) {
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/agent-groups" {
			t.Errorf("unexpected upstream: %s %s", r.Method, r.URL.Path)
		}
		if got := r.URL.Query().Get("user_id"); got != "alice" {
			t.Errorf("user_id = %q, want alice", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"groups":[{"id":"g1","name":"工作","position":0}],"count":1}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "user", api.Backends{BusURL: bus.URL})
	token := mintToken(t, env.key, testKid, "alice", "user")

	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/agent-groups?user_id=bob", "", token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"g1"`) {
		t.Fatalf("expected the group in the payload: %s", rec.Body.String())
	}
}

func TestCreateAgentGroupOverridesUserID(t *testing.T) {
	var got map[string]any
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/agent-groups" {
			t.Errorf("unexpected upstream: %s %s", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"g1","name":"工作","position":0}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "user", api.Backends{BusURL: bus.URL})
	token := mintToken(t, env.key, testKid, "alice", "user")

	rec := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/agent-groups",
		`{"user_id":"bob","name":"工作"}`, token)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	if got["user_id"] != "alice" {
		t.Fatalf("user_id sent upstream = %v, want alice", got["user_id"])
	}
	if got["name"] != "工作" {
		t.Fatalf("name sent upstream = %v", got["name"])
	}
}

func TestRenameAgentGroupPathAndIdentity(t *testing.T) {
	var got map[string]any
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut || r.URL.Path != "/api/v1/agent-groups/g1" {
			t.Errorf("unexpected upstream: %s %s", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"g1","status":"updated"}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "user", api.Backends{BusURL: bus.URL})
	token := mintToken(t, env.key, testKid, "alice", "user")

	rec := doRequest(t, env.handler, http.MethodPut, "/api/user/v1/agent-groups/g1",
		`{"user_id":"bob","name":"项目"}`, token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if got["user_id"] != "alice" || got["name"] != "项目" {
		t.Fatalf("upstream body = %v", got)
	}
}

func TestDeleteAgentGroupScopedToSelf(t *testing.T) {
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/api/v1/agent-groups/g1" {
			t.Errorf("unexpected upstream: %s %s", r.Method, r.URL.Path)
		}
		if got := r.URL.Query().Get("user_id"); got != "alice" {
			t.Errorf("user_id = %q, want alice", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"g1","status":"deleted","unassigned":2}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "user", api.Backends{BusURL: bus.URL})
	token := mintToken(t, env.key, testKid, "alice", "user")

	rec := doRequest(t, env.handler, http.MethodDelete, "/api/user/v1/agent-groups/g1?user_id=bob", "", token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestReorderAgentGroups(t *testing.T) {
	var got struct {
		UserID string   `json:"user_id"`
		IDs    []string `json:"ids"`
	}
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/agent-groups/reorder" {
			t.Errorf("unexpected upstream: %s %s", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"reordered"}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "user", api.Backends{BusURL: bus.URL})
	token := mintToken(t, env.key, testKid, "alice", "user")

	rec := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/agent-groups/reorder",
		`{"user_id":"bob","ids":["g2","g1"]}`, token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if got.UserID != "alice" || len(got.IDs) != 2 || got.IDs[0] != "g2" {
		t.Fatalf("upstream body = %+v", got)
	}
}

func TestAgentGroupErrorsPassThrough(t *testing.T) {
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"error":"an agent group with this name already exists"}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "user", api.Backends{BusURL: bus.URL})
	token := mintToken(t, env.key, testKid, "alice", "user")

	rec := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/agent-groups", `{"name":"工作"}`, token)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "already exists") {
		t.Fatalf("upstream error not passed through: %s", rec.Body.String())
	}
}

func TestArrangeAgentGroups(t *testing.T) {
	var got struct {
		UserID string `json:"user_id"`
		Groups []struct {
			ID     string   `json:"id"`
			Agents []string `json:"agents"`
		} `json:"groups"`
		Ungrouped []string `json:"ungrouped"`
	}
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/agent-groups/arrange" {
			t.Errorf("unexpected upstream: %s %s", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"arranged"}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "user", api.Backends{BusURL: bus.URL})
	token := mintToken(t, env.key, testKid, "alice", "user")

	rec := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/agent-groups/arrange",
		`{"user_id":"bob","groups":[{"id":"g1","agents":["a2","a1"]}],"ungrouped":["a3"]}`, token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if got.UserID != "alice" {
		t.Fatalf("user_id sent upstream = %q, want alice", got.UserID)
	}
	if len(got.Groups) != 1 || got.Groups[0].ID != "g1" || len(got.Groups[0].Agents) != 2 || got.Groups[0].Agents[0] != "a2" {
		t.Fatalf("groups sent upstream = %+v", got.Groups)
	}
	if len(got.Ungrouped) != 1 || got.Ungrouped[0] != "a3" {
		t.Fatalf("ungrouped sent upstream = %v", got.Ungrouped)
	}
}
