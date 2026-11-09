package api

import (
	"net/http"
	"net/url"

	"gitee.com/kobeyoung81/nanoportal/server/internal/auth"
)

// The session agents' prompt blocks: the shared head prompt (one value for build
// and plan, so the cached request prefix survives a mode switch) and the per-mode
// switch notes, which live on the agent type prompt.

func (server *Server) handleAdminPromptBlocks(w http.ResponseWriter, r *http.Request) {
	server.proxy.forwardGET(w, r, server.adminURL()+"/api/v1/prompt-blocks", nil)
}

func (server *Server) handleAdminPromptBlockSave(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := readJSONBody(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	_ = server.proxy.forwardJSON(w, r, server.adminURL()+"/api/v1/prompt-blocks", body)
}

// handleUserPromptBlocks resolves what one agent runs with. Read-only: the user
// plane never writes a prompt.
//
// The user id comes from the verified identity, never from the request: the
// proxy rebuilds the upstream request and only carries the conditional-read
// header, so a query string handed in by the browser never reaches the bus —
// which takes user_id as a query parameter and trusts its caller (the same
// contract handleMyPreferences relies on).
func (server *Server) handleUserPromptBlocks(w http.ResponseWriter, r *http.Request) {
	identity := auth.FromContext(r.Context())
	if identity.UserID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	agentID := r.PathValue("agentID")
	// The user-facing view still needs the agent's owner, and agents are the
	// bus's data until they move to this service.
	target := server.busURL() + "/api/v1/user/agents/" + url.PathEscape(agentID) +
		"/prompt-blocks?user_id=" + url.QueryEscape(identity.UserID)
	server.proxy.forwardGET(w, r, target, nil)
}
