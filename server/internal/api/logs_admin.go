package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
	"gitee.com/kobeyoung81/nanoportal/server/internal/store"
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
	records, err := server.store.ListConversations(store.ConversationFilter{
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
	out := make([]model.ConversationSummary, 0, len(records))
	for i := range records {
		rec := &records[i]
		out = append(out, model.ConversationSummary{
			ID: rec.ID, AgentID: rec.AgentID, AgentName: rec.AgentName,
			AccountID: rec.AccountID, AccountName: rec.AccountName,
			Channel: rec.Channel, ChatID: rec.ChatID, Status: rec.Status,
			MessageCount: rec.MessageCount, MessagesBytes: int64(rec.MessagesBytes),
			UpdatedAt: rec.UpdatedAt.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, http.StatusOK, out)
}

// handleConversation returns a single session including its full message history.
func (server *Server) handleConversation(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("sessionID")
	rec, err := server.store.GetSession(id)
	if err != nil {
		writeError(w, err)
		return
	}
	if rec == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "conversation not found"})
		return
	}
	messages := json.RawMessage(rec.Messages)
	if len(messages) == 0 {
		messages = json.RawMessage("[]")
	}
	writeJSON(w, http.StatusOK, model.ConversationDetail{
		ConversationSummary: model.ConversationSummary{
			ID: rec.ID, AgentID: rec.AgentID, AccountID: rec.AccountID,
			Channel: rec.Channel, ChatID: rec.ChatID, Status: rec.Status,
			MessageCount: rec.MessageCount, MessagesBytes: int64(rec.MessagesBytes),
			UpdatedAt: rec.UpdatedAt.UTC().Format(time.RFC3339),
		},
		Summary:  rec.Summary,
		Messages: messages,
	})
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
