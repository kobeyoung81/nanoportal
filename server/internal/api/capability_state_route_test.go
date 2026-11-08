package api_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gitee.com/kobeyoung81/nanoportal/server/internal/api"
)

// The catalog toggle calls a /state endpoint. The bus has it, but the portal
// had no route for it, so the request fell through to the mux and returned 404
// — for MCP servers and skills alike. The id is URL-escaped by the client
// (mcp%3Aplatform-nanoartifacts), so this also pins that the escape survives
// the two hops.
func TestAdminCapabilityStateForwards(t *testing.T) {
	var (
		gotPath string
		gotBody string
	)
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		body, _ := io.ReadAll(r.Body)
		gotBody = string(body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"updated"}`))
	}))
	defer bus.Close()

	env := newTestEnvWithRepo(t, "admin", api.Backends{BusURL: bus.URL}, stubRepo{})
	rec := doRequest(t, env.handler, http.MethodPut,
		"/api/admin/v1/capabilities/mcp/mcp%3Aplatform-nanoartifacts/state",
		`{"default_enabled":true}`, env.token)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	if gotPath != "/api/v1/capabilities/mcp/mcp:platform-nanoartifacts/state" {
		t.Fatalf("bus path = %q", gotPath)
	}
	if !strings.Contains(gotBody, `"default_enabled":true`) {
		t.Fatalf("body forwarded = %q", gotBody)
	}
}
