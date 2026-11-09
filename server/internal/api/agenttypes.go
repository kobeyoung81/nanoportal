package api

import (
	"net/http"
	"net/url"
)

// ======== admin: agent types + permission keys ========

func (server *Server) handleAdminAgentTypesList(w http.ResponseWriter, r *http.Request) {
	server.proxy.forwardGET(w, r, server.busURL()+"/api/v1/agent-types?all=true", nil)
}

func (server *Server) handleAdminAgentTypeGet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	server.proxy.forwardGET(w, r, server.busURL()+"/api/v1/agent-types/"+url.PathEscape(id), nil)
}

func (server *Server) handleAdminAgentTypeCreate(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := readJSONBody(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	_ = server.proxy.forwardPOSTJSON(w, r, server.busURL()+"/api/v1/agent-types", body)
}

func (server *Server) handleAdminAgentTypeUpdate(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body map[string]any
	if err := readJSONBody(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	target := server.busURL() + "/api/v1/agent-types/" + url.PathEscape(id)
	_ = server.proxy.forwardJSON(w, r, target, body)
}

func (server *Server) handleAdminAgentTypeDelete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	_ = server.proxy.forwardDELETE(w, r, server.busURL()+"/api/v1/agent-types/"+url.PathEscape(id))
}

func (server *Server) handleAdminAgentTypeCapability(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body map[string]any
	if err := readJSONBody(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	target := server.busURL() + "/api/v1/agent-types/" + url.PathEscape(id) + "/capabilities"
	_ = server.proxy.forwardJSON(w, r, target, body)
}

// handleAdminAgentTypePromptStatus reports where each type's stored prompt
// stands relative to the bundle the bus ships (bundled / stale / edited / empty
// / none). The prompt text itself travels in the agent-types listing; only the
// bundle knows whether that text is still the platform's.
func (server *Server) handleAdminAgentTypePromptStatus(w http.ResponseWriter, r *http.Request) {
	server.proxy.forwardGET(w, r, server.busURL()+"/api/v1/agent-types/prompt-status", nil)
}

// handleAdminAgentTypePromptReset restores one type's prompt from the bundle.
func (server *Server) handleAdminAgentTypePromptReset(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	target := server.busURL() + "/api/v1/agent-types/" + url.PathEscape(id) + "/prompt/reset"
	_ = server.proxy.forwardPOSTJSON(w, r, target, map[string]any{})
}

func (server *Server) handleAdminPermissionKeys(w http.ResponseWriter, r *http.Request) {
	server.proxy.forwardGET(w, r, server.adminURL()+"/api/v1/permission-keys", nil)
}

// handleMyPermissionKeys exposes the shared permission-key catalog read-only to
// signed-in users so the per-agent permission editor can render tool labels.
func (server *Server) handleMyPermissionKeys(w http.ResponseWriter, r *http.Request) {
	server.proxy.forwardGET(w, r, server.adminURL()+"/api/v1/permission-keys", nil)
}

// ======== user: assignable agent types ========

func (server *Server) handleMyAgentTypes(w http.ResponseWriter, r *http.Request) {
	server.proxy.forwardGET(w, r, server.busURL()+"/api/v1/user/agent-types", nil)
}
