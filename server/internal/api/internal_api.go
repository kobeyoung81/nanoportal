package api

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"gitee.com/kobeyoung81/nanoportal/server/internal/bustoken"
	"gitee.com/kobeyoung81/nanoportal/server/internal/store"
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
	mux.HandleFunc("POST /internal/v1/users/{userID}/agents/ensure", server.internalEnsureAgent)
	mux.HandleFunc("POST /internal/v1/agent-types/{typeID}/clear-refs", server.internalClearTypeRefs)
	mux.HandleFunc("GET /internal/v1/agents", server.internalListAgents)
	mux.HandleFunc("GET /internal/v1/agents/{agentID}", server.internalGetAgent)
	mux.HandleFunc("GET /internal/v1/sessions/{sessionID}", server.internalGetSession)
	mux.HandleFunc("GET /internal/v1/bindings/{bindingID}/agent", server.internalGetBindingAgent)
	mux.HandleFunc("PUT /internal/v1/bindings/{bindingID}/agent", server.internalSetBindingAgent)
	mux.HandleFunc("POST /internal/v1/sessions", server.internalSaveSession)
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

// internalEnsureAgent makes sure an account has an agent. Channel onboarding
// creates the account and the container request but no agent, so without this a
// brand-new user would have a running container and nobody to answer. It is
// idempotent: an existing agent is returned untouched.
func (server *Server) internalEnsureAgent(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("userID")
	if userID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user id is required"})
		return
	}
	agentID, created, err := server.store.EnsureDefaultAgent(userID, defaultAgentTypeID, "My Agent")
	if err != nil {
		slog.Error("ensure the account's agent", "user_id", userID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if created {
		// The supervisor reads the agent rows and spawns a child per agent; telling
		// it now means the first message does not wait for the next reconcile.
		server.notifyAgentsChanged(userID, "create", agentID)
	}
	writeJSON(w, http.StatusOK, map[string]any{"agent_id": agentID, "created": created})
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

// internalSaveSession applies one snapshot from the agent that owns a
// conversation. It is the session projection's only write path: the agent keeps
// its JSONL copy as the authoritative one and sends a suffix once the stored
// prefix is acknowledged, so the payload stops being the whole conversation.
func (server *Server) internalSaveSession(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SessionID       string `json:"session_id"`
		AgentID         string `json:"agent_id"`
		AccountID       string `json:"account_id"`
		Channel         string `json:"channel"`
		ChatID          string `json:"chat_id"`
		Messages        string `json:"messages"`
		Summary         string `json:"summary"`
		Title           string `json:"title"`
		Meta            string `json:"meta"`
		Status          string `json:"status"`
		TurnRunning     bool   `json:"turn_running"`
		MessagesOmitted bool   `json:"messages_omitted"`
		FromIndex       int    `json:"from_index"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if body.SessionID == "" || body.AgentID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "session_id and agent_id are required"})
		return
	}

	rec := store.SessionRecord{
		ID:              body.SessionID,
		AgentID:         body.AgentID,
		AccountID:       body.AccountID,
		Channel:         body.Channel,
		ChatID:          body.ChatID,
		Messages:        body.Messages,
		Summary:         body.Summary,
		Title:           body.Title,
		Meta:            body.Meta,
		Status:          body.Status,
		TurnRunning:     body.TurnRunning,
		MessagesOmitted: body.MessagesOmitted,
		FromIndex:       body.FromIndex,
	}
	if err := server.store.SaveSession(rec); err != nil {
		if errors.Is(err, store.ErrSessionResync) {
			// The delta followed a prefix the store does not hold: the sender's
			// recovery is the whole conversation, so this is a distinct answer
			// rather than a generic failure.
			writeJSON(w, http.StatusConflict, map[string]string{"error": "resync"})
			return
		}
		slog.Error("save session", "session_id", body.SessionID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	saved, err := server.store.GetSessionMeta(body.SessionID)
	if err != nil || saved == nil {
		writeJSON(w, http.StatusOK, map[string]string{"session_id": body.SessionID})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"session_id":     saved.ID,
		"message_count":  saved.MessageCount,
		"messages_bytes": saved.MessagesBytes,
	})
}

// internalListAgents answers the supervisor's and the gateway's "which agents
// does this user have" with the three fields they read. It never carries the
// settings, model or history a management view needs: this is the runtime's
// list, not the console's.
func (server *Server) internalListAgents(w http.ResponseWriter, r *http.Request) {
	userID := strings.TrimSpace(r.URL.Query().Get("user_id"))
	if userID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id is required"})
		return
	}
	agents, err := server.store.ListAgentsFiltered(userID, true)
	if err != nil {
		slog.Error("list agents", "user_id", userID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	// The gateway serves this list to the browser, so it carries the same shape
	// the user API does — without the model display name, which needs the admin
	// catalogue and is only shown on the account page.
	out := make([]agentInfo, 0, len(agents))
	for _, a := range agents {
		out = append(out, server.infoFromRecord(a))
	}
	writeJSON(w, http.StatusOK, map[string]any{"agents": out})
}

// internalGetAgent answers "who owns this agent". The workspace service serves
// file and git requests by agent id and has no database; this is the one fact it
// needs, and the portal is where the row lives.
func (server *Server) internalGetAgent(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	agent, err := server.store.GetAgent(agentID)
	if err != nil {
		slog.Error("get agent", "agent_id", agentID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if agent == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
		return
	}
	// The full row, not just the identity: the workspace asks "who owns this
	// agent", and the bus asks "what is this agent" when it assembles a start
	// snapshot. One shape serves both, and the fields a caller does not read cost
	// it nothing.
	writeJSON(w, http.StatusOK, map[string]any{"agent": server.infoFromRecord(*agent)})
}

// internalGetSession answers the gateway's resume check: metadata only, never
// the history blob. The gateway has already validated the browser's token and
// only needs identity and ownership of the conversation.
func (server *Server) internalGetSession(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("sessionID")
	if sessionID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "session id is required"})
		return
	}
	rec, err := server.store.GetSessionMeta(sessionID)
	if err != nil {
		slog.Error("get session meta", "session_id", sessionID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if rec == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
		return
	}
	writeJSON(w, http.StatusOK, sessionResponse(rec))
}

// internalGetBindingAgent answers the gateway's "which agent does this channel
// binding talk to" — an explicit preference, else the owner's first active agent.
// The answer may be empty: a binding whose owner has no agent yet.
func (server *Server) internalGetBindingAgent(w http.ResponseWriter, r *http.Request) {
	bindingID, ok := bindingIDOf(w, r)
	if !ok {
		return
	}
	agentID, err := server.store.GetBindingAgent(bindingID)
	if err != nil {
		slog.Error("get binding agent", "binding_id", bindingID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"binding_id": bindingID, "agent_id": agentID})
}

// internalSetBindingAgent assigns (or, with an empty id, clears) a binding's
// default agent. No caller wires it up yet; it exists so the binding surface has
// one owner rather than a read here and a write somewhere else.
func (server *Server) internalSetBindingAgent(w http.ResponseWriter, r *http.Request) {
	bindingID, ok := bindingIDOf(w, r)
	if !ok {
		return
	}
	var body struct {
		AgentID string `json:"agent_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if err := server.store.SetBindingAgent(bindingID, body.AgentID); err != nil {
		slog.Error("set binding agent", "binding_id", bindingID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"binding_id": bindingID, "agent_id": body.AgentID})
}

// bindingIDOf parses the path's binding id, answering 400 itself when it is not
// a number.
func bindingIDOf(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("bindingID"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "binding id must be a positive number"})
		return 0, false
	}
	return id, true
}
