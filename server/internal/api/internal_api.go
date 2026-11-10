package api

import (
	"crypto/subtle"
	"encoding/json"
	"log/slog"
	"net/http"

	"gitee.com/kobeyoung81/nanoportal/server/internal/bustoken"
)

// newInternalMux serves the calls other platform components make to this
// service. They are not user traffic: there is no JWT, and the caller is a
// service holding the deployment's shared token.
//
// The paths sit under /internal/ on purpose: /api/v1/ belongs to the gateway and
// /api/user/ belongs to the authenticated browser API, so reusing either would
// blur who may call what.
func (server *Server) newInternalMux() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /internal/v1/agents/{agentID}/status", server.internalSetAgentStatus)
	mux.HandleFunc("POST /internal/v1/agent-types/{typeID}/clear-refs", server.internalClearTypeRefs)
	return server.requireInternalToken(mux)
}

// requireInternalToken refuses every internal call unless it carries the shared
// token. An unconfigured token fails closed: without one the deployment cannot
// tell its own components from anyone else, so the endpoints answer 503 rather
// than open up.
func (server *Server) requireInternalToken(next http.Handler) http.Handler {
	expected := bustoken.Token()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if expected == "" {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "internal token is not configured"})
			return
		}
		presented := r.Header.Get("Authorization")
		const prefix = "Bearer "
		if len(presented) <= len(prefix) || presented[:len(prefix)] != prefix ||
			subtle.ConstantTimeCompare([]byte(presented[len(prefix):]), []byte(expected)) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// internalSetAgentStatus records a runtime status report from an agent's
// supervisor. The agent rows are this service's, so the write happens here even
// though the reporting process talks to the bus.
func (server *Server) internalSetAgentStatus(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if body.Status == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "status is required"})
		return
	}
	if err := server.store.SetAgentStatus(agentID, body.Status); err != nil {
		slog.Error("update agent status", "agent_id", agentID, "status", body.Status, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": agentID, "status": body.Status})
}

// internalClearTypeRefs answers the admin module's "I am about to delete this
// type" call by clearing the reference on the agents that point at it. Deleting
// a type without this would leave agents pointing at a definition nobody can
// resolve — they would silently fall back to no type at all.
func (server *Server) internalClearTypeRefs(w http.ResponseWriter, r *http.Request) {
	typeID := r.PathValue("typeID")
	if typeID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "type id is required"})
		return
	}
	cleared, err := server.store.ClearAgentsTypeRef(typeID)
	if err != nil {
		slog.Error("clear agent type references", "type_id", typeID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"type_id": typeID, "cleared": cleared})
}
