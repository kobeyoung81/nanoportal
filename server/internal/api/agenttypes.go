package api

import (
	"net/http"
)

// ======== admin: agent types + permission keys ========

// handleAdminAgentTypePromptStatus reports where each type's stored prompt
// stands relative to the bundle the bus ships (bundled / stale / edited / empty
// / none). The prompt text itself travels in the agent-types listing; only the
// bundle knows whether that text is still the platform's.
// handleAdminAgentTypePromptReset restores one type's prompt from the bundle.
// handleMyPermissionKeys exposes the shared permission-key catalog read-only to
// signed-in users so the per-agent permission editor can render tool labels.
func (server *Server) handleMyPermissionKeys(w http.ResponseWriter, r *http.Request) {
	server.proxy.forwardGET(w, r, server.adminURL()+"/api/v1/permission-keys", nil)
}

// ======== user: assignable agent types ========

func (server *Server) handleMyAgentTypes(w http.ResponseWriter, r *http.Request) {
	server.proxy.forwardGET(w, r, server.adminURL()+"/api/v1/user/agent-types", nil)
}
