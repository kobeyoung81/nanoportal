package api_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"gitee.com/kobeyoung81/nanoportal/server/internal/api"
)

// The bus endpoint takes user_id as a query parameter and trusts its caller, so
// the portal has to add it: the proxy rebuilds the upstream request and carries
// no query string of its own, which is why this endpoint answered
// "user_id is required" for every request the browser made.
func TestPromptBlocksForwardsTheCallersIdentity(t *testing.T) {
	var gotPath, gotQuery string
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"agent_id":"agent-1","head":null,"head_source":"platform","mode_notes":{}}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "support", api.Backends{BusURL: bus.URL})

	// The browser still sends its own user_id (older builds did); it must not be
	// what reaches the bus.
	req := httptest.NewRequest(http.MethodGet, "/api/user/v1/agents/agent-1/prompt-blocks?user_id=someone-else", nil)
	req.Header.Set("Authorization", "Bearer "+env.token)
	rec := httptest.NewRecorder()
	env.handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if gotPath != "/api/v1/user/agents/agent-1/prompt-blocks" {
		t.Fatalf("upstream path = %q", gotPath)
	}
	if gotQuery != "user_id=test-admin" {
		t.Fatalf("upstream query = %q, want the authenticated identity (user_id=test-admin)", gotQuery)
	}
}
