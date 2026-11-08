package repository

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"gitee.com/kobeyoung81/nanoportal/server/internal/bustoken"
	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
)

// identityClient is the console's side of the three surfaces that used to be
// tables two other services read: the git browser's starred paths, and the
// directory (OAuth) links that decide whether an account signs in through LDAP.
//
// Both moved into the bus when it became the only service with a database
// connection. The console keeps its own screen behaviour — "who signs in through
// the directory", "star this path", "delete this star" — and gets the data over
// the same REST surface as everything else.
type identityClient struct {
	base string
	http *http.Client
}

func newIdentityClient(busURL string) *identityClient {
	return &identityClient{
		base: busURL,
		http: &http.Client{Timeout: 15 * time.Second, Transport: bustoken.Transport(nil)},
	}
}

// shortcutPayload is one starred path as the bus sends it. The id is the row's
// own number — the console deletes by it and shows nothing else.
type shortcutPayload struct {
	ID      int64  `json:"id"`
	UserID  string `json:"user_id"`
	AgentID string `json:"agent_id"`
	Path    string `json:"path"`
	Label   string `json:"label"`
}

func (p shortcutPayload) shortcut() model.GitShortcut {
	return model.GitShortcut{
		ID: p.ID, UserID: p.UserID, AgentID: p.AgentID, Path: p.Path, Label: p.Label,
	}
}

// directoryLinkedUsers is the set of accounts that sign in through the directory,
// for a whole page of the user list in one call.
func (c *identityClient) directoryLinkedUsers(ctx context.Context) (map[string]bool, error) {
	var payload struct {
		UserIDs []string `json:"user_ids"`
	}
	path := "/api/v1/oauth-links?provider=" + url.QueryEscape("ldap")
	if err := busDo(ctx, c.http, c.base, http.MethodGet, path, nil, &payload); err != nil {
		return nil, err
	}
	out := make(map[string]bool, len(payload.UserIDs))
	for _, id := range payload.UserIDs {
		out[id] = true
	}
	return out, nil
}

// isDirectoryAccount answers the same question for one account, using the flag the
// account shape carries.
func (c *identityClient) isDirectoryAccount(ctx context.Context, userID string) (bool, error) {
	var payload struct {
		LDAP bool `json:"ldap"`
	}
	path := "/api/v1/user-accounts/" + url.PathEscape(userID)
	if err := busDo(ctx, c.http, c.base, http.MethodGet, path, nil, &payload); err != nil {
		return false, err
	}
	return payload.LDAP, nil
}

// gitShortcuts lists a user's stars, optionally narrowed to one agent.
func (c *identityClient) gitShortcuts(ctx context.Context, userID, agentID string) ([]model.GitShortcut, error) {
	path := "/api/v1/users/" + url.PathEscape(userID) + "/git-shortcuts"
	if agentID != "" {
		path += "?agent_id=" + url.QueryEscape(agentID)
	}
	var payload struct {
		Shortcuts []shortcutPayload `json:"shortcuts"`
	}
	if err := busDo(ctx, c.http, c.base, http.MethodGet, path, nil, &payload); err != nil {
		return nil, err
	}
	out := make([]model.GitShortcut, 0, len(payload.Shortcuts))
	for _, s := range payload.Shortcuts {
		out = append(out, s.shortcut())
	}
	return out, nil
}

// addGitShortcut stars a path (or re-labels an existing star) and returns the row.
func (c *identityClient) addGitShortcut(ctx context.Context, userID, agentID, path, label string) (model.GitShortcut, error) {
	body := map[string]string{"agent_id": agentID, "path": path, "label": label}
	var payload shortcutPayload
	reqPath := "/api/v1/users/" + url.PathEscape(userID) + "/git-shortcuts"
	if err := busDo(ctx, c.http, c.base, http.MethodPost, reqPath, body, &payload); err != nil {
		return model.GitShortcut{}, err
	}
	return payload.shortcut(), nil
}

// deleteGitShortcut removes one star. The bus answers 404 when there is nothing
// to delete, which the console turns into "not found" rather than silence.
func (c *identityClient) deleteGitShortcut(ctx context.Context, userID string, id int64) error {
	path := fmt.Sprintf("/api/v1/users/%s/git-shortcuts/%d", url.PathEscape(userID), id)
	return busDo(ctx, c.http, c.base, http.MethodDelete, path, nil, nil)
}
