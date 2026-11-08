package repository

// The console's identity client: what it asks the bus for, and how it reads the
// answers. The paths matter — they are the bus's public surface now, and a rename
// there is a silent 404 here.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIdentityClient_DirectoryLinkedUsers(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.RequestURI()
		_ = json.NewEncoder(w).Encode(map[string]any{"user_ids": []string{"u-1", "u-2"}})
	}))
	defer srv.Close()

	linked, err := newIdentityClient(srv.URL).directoryLinkedUsers(context.Background())
	if err != nil {
		t.Fatalf("directoryLinkedUsers: %v", err)
	}
	if !linked["u-1"] || !linked["u-2"] || len(linked) != 2 {
		t.Fatalf("unexpected set: %+v", linked)
	}
	if gotPath != "/api/v1/oauth-links?provider=ldap" {
		t.Fatalf("the bus was asked for %q", gotPath)
	}
}

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
	if deleted != "/api/v1/users/u-1/git-shortcuts/7" {
		t.Fatalf("delete went to %q", deleted)
	}
}

func TestIdentityClient_IsDirectoryAccount(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/user-accounts/u-1" {
			t.Errorf("asked for %q", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"user_id": "u-1", "ldap": true})
	}))
	defer srv.Close()

	linked, err := newIdentityClient(srv.URL).isDirectoryAccount(context.Background(), "u-1")
	if err != nil {
		t.Fatalf("isDirectoryAccount: %v", err)
	}
	if !linked {
		t.Fatal("the directory flag was dropped")
	}
}
