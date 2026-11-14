package repository

// The console's identity client: git shortcuts, asked of the module that owns
// them. The paths matter — they are nanoauth's internal surface, and a rename
// there is a silent 404 here.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIdentityClient_GitShortcutLifecycle(t *testing.T) {
	var (
		postedBody map[string]string
		deleted    string
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet:
			if r.URL.Query().Get("agent_id") != "agent-1" {
				t.Errorf("agent filter was not passed: %s", r.URL.RequestURI())
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"shortcuts": []map[string]any{
				{"id": 7, "user_id": "u-1", "agent_id": "agent-1", "path": "src/main.go", "label": "main"},
			}})
		case r.Method == http.MethodPost:
			if err := json.NewDecoder(r.Body).Decode(&postedBody); err != nil {
				t.Errorf("decode body: %v", err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id": 7, "user_id": "u-1", "agent_id": "agent-1", "path": "src/main.go", "label": "main",
			})
		case r.Method == http.MethodDelete:
			deleted = r.URL.Path
		}
	}))
	defer srv.Close()

	client := newIdentityClient(srv.URL)
	shortcuts, err := client.gitShortcuts(context.Background(), "u-1", "agent-1")
	if err != nil {
		t.Fatalf("gitShortcuts: %v", err)
	}
	if len(shortcuts) != 1 || shortcuts[0].ID != 7 || shortcuts[0].Path != "src/main.go" {
		t.Fatalf("unexpected shortcuts: %+v", shortcuts)
	}

	added, err := client.addGitShortcut(context.Background(), "u-1", "agent-1", "src/main.go", "main")
	if err != nil {
		t.Fatalf("addGitShortcut: %v", err)
	}
	if added.ID != 7 {
		t.Fatalf("the star came back without its id: %+v", added)
	}
	if postedBody["path"] != "src/main.go" || postedBody["agent_id"] != "agent-1" {
		t.Fatalf("the body did not carry the star: %+v", postedBody)
	}

	if err := client.deleteGitShortcut(context.Background(), "u-1", 7); err != nil {
		t.Fatalf("deleteGitShortcut: %v", err)
	}
	if deleted != "/internal/v1/users/u-1/git-shortcuts/7" {
		t.Fatalf("delete went to %q", deleted)
	}
}
