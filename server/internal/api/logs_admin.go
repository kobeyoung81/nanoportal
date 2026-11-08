package api

import (
	"net/http"
	"strconv"

	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
)

// queryLimit reads the page's `limit`, falling back when it is absent or not a
// number. The bus applies its own ceiling.
func queryLimit(r *http.Request, fallback int) int {
	raw := r.URL.Query().Get("limit")
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return parsed
}

// handleConversations lists persisted agent sessions for the audit section. Each
// filter is its own query parameter — the console has one control per condition —
// and they are ANDed by the bus.
func (server *Server) handleConversations(w http.ResponseWriter, r *http.Request) {
	conversations, err := server.repo.ListConversations(r.Context(), model.ConversationQuery{
		Limit:   queryLimit(r, 100),
		Session: r.URL.Query().Get("session"),
		Agent:   r.URL.Query().Get("agent"),
		Account: r.URL.Query().Get("account"),
		Channel: r.URL.Query().Get("channel"),
		Status:  r.URL.Query().Get("status"),
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, conversations)
}

// handleConversation returns a single session including its full message history.
func (server *Server) handleConversation(w http.ResponseWriter, r *http.Request) {
	detail, err := server.repo.GetConversation(r.Context(), r.PathValue("sessionID"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

// handleRuntime returns a runtime status snapshot across containers, agents and
// runners. It is a status view rather than a log stream.
func (server *Server) handleRuntime(w http.ResponseWriter, r *http.Request) {
	snapshot, err := server.repo.GetRuntimeSnapshot(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}
