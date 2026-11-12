package api

import (
	"net/http"
	"net/url"
)

// ======== Model catalog proxy (portal -> bus) ========
//
// Portals enforce auth/roles; the bus stores the catalog. Admin routes manage
// global (platform) providers/models; user routes manage the caller's own
// user-scoped rows. API keys are masked by the bus in user listings.

// handleAdminModelApplyToTypes gives one platform model to every built-in agent
// type. Fill-only: a type that already has a default model keeps it.
// handleAdminModelSetDefault flags a global model as the platform default used
// when creating new agents.
// ======== connection tests ========

func (server *Server) handleMyProviderTest(w http.ResponseWriter, r *http.Request) {
	server.forwardModelBody(w, r, "POST", "/api/v1/user/models/providers/test", "user")
}
func (server *Server) handleMyModelTest(w http.ResponseWriter, r *http.Request) {
	server.forwardModelBody(w, r, "POST", "/api/v1/user/models/test", "user")
}

func (server *Server) handleMyModelsList(w http.ResponseWriter, r *http.Request) {
	userID := server.requireUserID(w, r)
	if userID == "" {
		return
	}
	target := server.adminURL() + "/api/v1/user/models?user_id=" + url.QueryEscape(userID)
	server.proxy.forwardGET(w, r, target, nil)
}
func (server *Server) handleMyProviderCreate(w http.ResponseWriter, r *http.Request) {
	server.forwardModelBody(w, r, "POST", "/api/v1/user/models/providers", "user")
}
func (server *Server) handleMyProviderUpdate(w http.ResponseWriter, r *http.Request) {
	server.forwardModelBody(w, r, "PUT", "/api/v1/user/models/providers/"+url.PathEscape(r.PathValue("id")), "user")
}
func (server *Server) handleMyProviderDelete(w http.ResponseWriter, r *http.Request) {
	userID := server.requireUserID(w, r)
	if userID == "" {
		return
	}
	target := server.adminURL() + "/api/v1/user/models/providers/" + url.PathEscape(r.PathValue("id")) +
		"?user_id=" + url.QueryEscape(userID)
	server.proxy.forwardDELETE(w, r, target)
}
func (server *Server) handleMyModelCreate(w http.ResponseWriter, r *http.Request) {
	server.forwardModelBody(w, r, "POST", "/api/v1/user/models/models", "user")
}
func (server *Server) handleMyModelUpdate(w http.ResponseWriter, r *http.Request) {
	server.forwardModelBody(w, r, "PUT", "/api/v1/user/models/models/"+url.PathEscape(r.PathValue("id")), "user")
}
func (server *Server) handleMyModelDelete(w http.ResponseWriter, r *http.Request) {
	userID := server.requireUserID(w, r)
	if userID == "" {
		return
	}
	target := server.adminURL() + "/api/v1/user/models/models/" + url.PathEscape(r.PathValue("id")) +
		"?user_id=" + url.QueryEscape(userID)
	server.proxy.forwardDELETE(w, r, target)
}

// forwardModelBody forwards a JSON body, injecting the authenticated user_id
// for user-scoped routes.
func (server *Server) forwardModelBody(w http.ResponseWriter, r *http.Request, method, path, scope string) {
	body := map[string]any{}
	if r.Body != nil {
		if err := readJSONBody(r, &body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
	}
	target := server.adminURL() + path
	if scope == "user" {
		userID := server.requireUserID(w, r)
		if userID == "" {
			return
		}
		target += "?user_id=" + url.QueryEscape(userID)
	}
	if method == "POST" {
		_ = server.proxy.forwardPOSTJSON(w, r, target, body)
		return
	}
	_ = server.proxy.forwardJSON(w, r, target, body)
}
