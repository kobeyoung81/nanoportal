package api_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gitee.com/kobeyoung81/nanoportal/server/internal/api"
)

// TestAgentAttentionIsScopedToTheCaller pins the scoping of the attention
// snapshot. The path carries no agent id, so the user the snapshot is built for
// must come from the verified identity and never from the request — otherwise a
// caller could read another account's running and waiting conversations.
func TestAgentAttentionIsScopedToTheCaller(t *testing.T) {
	var gotPath, gotQuery string
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"conversations":[{"agent_id":"agent-1","chat_id":"chat-1","session_id":"web:chat-1","running":true,"awaiting":false}]}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "user", api.Backends{BusURL: bus.URL})

	// A user_id in the request must be ignored: the identity decides.
	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/agents/attention?user_id=someone-else", "", env.token)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if gotPath != "/api/v1/agents/attention" {
		t.Fatalf("upstream path = %q, want /api/v1/agents/attention", gotPath)
	}
	if gotQuery != "user_id=test-admin" {
		t.Fatalf("upstream query = %q, want user_id=test-admin", gotQuery)
	}
	if body := rec.Body.String(); !strings.Contains(body, `"session_id":"web:chat-1"`) {
		t.Fatalf("payload not passed through: %q", body)
	}
}
