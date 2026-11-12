package api

import (
	"encoding/json"
	"net/http"
	"net/url"

	"gitee.com/kobeyoung81/nanoportal/server/internal/auth"
)

func readJSONBody(r *http.Request, out any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(out)
}

// mergeLibraryJSON combines the bus's /library/mcp and /library/skills
// responses into a single { servers, skills } payload for the client.
func mergeLibraryJSON(mcpBody, skillsBody []byte) ([]byte, error) {
	var mcp struct {
		Servers json.RawMessage `json:"servers"`
	}
	var skills struct {
		Skills json.RawMessage `json:"skills"`
	}
	if err := json.Unmarshal(mcpBody, &mcp); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(skillsBody, &skills); err != nil {
		return nil, err
	}
	return json.Marshal(map[string]json.RawMessage{
		"servers": mcp.Servers,
		"skills":  skills.Skills,
	})
}

// ======== admin: capability catalog ========
// These proxy to the bus catalog endpoints. The bus resolves catalog scope and
// enforced by the operator+ gate on the mux; global-catalog ops need no
// per-user scoping.

// capabilityBase names the module that owns one capability kind: the skill
// catalogue lives at admin, the MCP servers are still the bus's.
// handleAdminCapabilitiesState proxies the catalog's default/locked toggle.
//
// The bus has had PUT /api/v1/capabilities/{kind}/{id}/state all along, but the
// portal never exposed a route for it: the client's toggle request fell through
// to the mux and returned 404, for MCP servers and skills alike.
// handleAdminMcpTest proxies an MCP connection test (global catalog).
// handleMyMcpTest proxies an MCP connection test for the caller's own library.
func (server *Server) handleMyMcpTest(w http.ResponseWriter, r *http.Request) {
	userID := server.requireUserID(w, r)
	if userID == "" {
		return
	}
	target := server.busURL() + "/api/v1/user/capabilities/library/mcp/test?user_id=" + url.QueryEscape(userID)
	server.forwardTestBody(w, r, target)
}

// forwardTestBody forwards a JSON body to a bus test endpoint.
func (server *Server) forwardTestBody(w http.ResponseWriter, r *http.Request, target string) {
	var body map[string]any
	if err := readJSONBody(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	_ = server.proxy.forwardPOSTJSON(w, r, target, body)
}

// ======== user: library ========

func (server *Server) handleMyLibrary(w http.ResponseWriter, r *http.Request) {
	userID := server.requireUserID(w, r)
	if userID == "" {
		return
	}
	mcpTarget := server.busURL() + "/api/v1/user/capabilities/library/mcp?user_id=" + url.QueryEscape(userID)
	skillTarget := server.adminURL() + "/api/v1/user/capabilities/library/skills?user_id=" + url.QueryEscape(userID)
	server.proxy.forwardGET(w, r, mcpTarget, func(mcpBody []byte) ([]byte, error) {
		skillsBody, err := server.proxy.getJSON(r, skillTarget)
		if err != nil {
			return nil, err
		}
		return mergeLibraryJSON(mcpBody, skillsBody)
	})
}

func (server *Server) handleMyLibraryCreate(w http.ResponseWriter, r *http.Request, kind string) {
	userID := server.requireUserID(w, r)
	if userID == "" {
		return
	}
	var body map[string]any
	if err := readJSONBody(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	target := server.busURL() + "/api/v1/user/capabilities/library/" + kind + "?user_id=" + url.QueryEscape(userID)
	_ = server.proxy.forwardPOSTJSON(w, r, target, body)
}

func (server *Server) handleMyLibraryUpdate(w http.ResponseWriter, r *http.Request, kind string) {
	userID := server.requireUserID(w, r)
	if userID == "" {
		return
	}
	id := r.PathValue("id")
	var body map[string]any
	if err := readJSONBody(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	target := server.busURL() + "/api/v1/user/capabilities/library/" + kind + "/" + url.PathEscape(id) +
		"?user_id=" + url.QueryEscape(userID)
	_ = server.proxy.forwardJSON(w, r, target, body)
}

func (server *Server) handleMyLibraryDelete(w http.ResponseWriter, r *http.Request, kind string) {
	userID := server.requireUserID(w, r)
	if userID == "" {
		return
	}
	id := r.PathValue("id")
	target := server.busURL() + "/api/v1/user/capabilities/library/" + kind + "/" + url.PathEscape(id) +
		"?user_id=" + url.QueryEscape(userID)
	_ = server.proxy.forwardDELETE(w, r, target)
}

// ======== user: per-agent capabilities ========

func (server *Server) handleAgentCapabilities(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	userID := server.requireUserID(w, r)
	if userID == "" {
		return
	}
	target := server.busURL() + "/api/v1/user/capabilities/agents/" + url.PathEscape(agentID) +
		"?user_id=" + url.QueryEscape(userID)
	if tid := r.URL.Query().Get("type_id"); tid != "" {
		target += "&type_id=" + url.QueryEscape(tid)
	}
	server.proxy.forwardGET(w, r, target, nil)
}

// handleGetAgentMode returns one (agent, mode)'s baseline type + user override.
func (server *Server) handleGetAgentMode(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	typeID := r.PathValue("typeID")
	userID := server.requireUserID(w, r)
	if userID == "" {
		return
	}
	target := server.busURL() + "/api/v1/user/agents/" + url.PathEscape(agentID) +
		"/modes/" + url.PathEscape(typeID) + "?user_id=" + url.QueryEscape(userID)
	server.proxy.forwardGET(w, r, target, nil)
}

// handleSetAgentMode upserts one (agent, mode)'s scalar override.
func (server *Server) handleSetAgentMode(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	typeID := r.PathValue("typeID")
	userID := server.requireUserID(w, r)
	if userID == "" {
		return
	}
	var body map[string]any
	if err := readJSONBody(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	target := server.busURL() + "/api/v1/user/agents/" + url.PathEscape(agentID) +
		"/modes/" + url.PathEscape(typeID) + "?user_id=" + url.QueryEscape(userID)
	_ = server.proxy.forwardJSON(w, r, target, body)
}

// handleSetAgentPermissions replaces an agent's instance permission overrides.
func (server *Server) handleSetAgentPermissions(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	userID := server.requireUserID(w, r)
	if userID == "" {
		return
	}
	var body map[string]any
	if err := readJSONBody(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	target := server.busURL() + "/api/v1/user/capabilities/agents/" + url.PathEscape(agentID) +
		"/permissions?user_id=" + url.QueryEscape(userID)
	_ = server.proxy.forwardJSON(w, r, target, body)
}

func (server *Server) handleSetAgentCapability(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	userID := server.requireUserID(w, r)
	if userID == "" {
		return
	}
	var body map[string]any
	if err := readJSONBody(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	target := server.busURL() + "/api/v1/user/capabilities/agents/" + url.PathEscape(agentID) +
		"?user_id=" + url.QueryEscape(userID)
	_ = server.proxy.forwardJSON(w, r, target, body)
}

func (server *Server) handleDeleteAgentCapability(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	userID := server.requireUserID(w, r)
	if userID == "" {
		return
	}
	kind, ref := r.URL.Query().Get("kind"), r.URL.Query().Get("ref")
	target := server.busURL() + "/api/v1/user/capabilities/agents/" + url.PathEscape(agentID) +
		"?user_id=" + url.QueryEscape(userID) + "&kind=" + url.QueryEscape(kind) + "&ref=" + url.QueryEscape(ref)
	if tid := r.URL.Query().Get("type_id"); tid != "" {
		target += "&type_id=" + url.QueryEscape(tid)
	}
	_ = server.proxy.forwardDELETE(w, r, target)
}

// requireUserID returns the authenticated user id, or "". Callers must not
// preserve any client-supplied identity: ownership flows from the session.
func (server *Server) requireUserID(w http.ResponseWriter, r *http.Request) string {
	identity := auth.FromContext(r.Context())
	if identity.UserID == "" || identity.UserID == "anonymous" {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return ""
	}
	return identity.UserID
}
