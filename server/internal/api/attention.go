package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"gitee.com/kobeyoung81/nanoportal/server/internal/auth"
)

// turnRunningStaleAfter is how long a stored `turn_running` flag is believed.
//
// The agent rewrites the flag while a turn is in flight (a snapshot every couple
// of seconds). A process that dies mid-turn leaves the flag set with an old
// timestamp, and believing it forever would show a dot that never goes away. The
// window must stay comfortably above the agent's write interval; raising the
// agent's session sync interval above ~10s would need this raised with it.
const turnRunningStaleAfter = 15 * time.Second

// turnRunning reports whether a stored turn flag is recent enough to believe.
func turnRunning(running bool, updatedAt time.Time) bool {
	if !running {
		return false
	}
	if updatedAt.IsZero() {
		return true
	}
	return time.Since(updatedAt) < turnRunningStaleAfter
}

// handleAgentAttention reports the two things the sidebar draws as dots — a
// running turn and an unanswered question/approval — for every conversation of
// the caller's agents.
//
// `awaiting` is deliberately not aged out: a conversation may legitimately wait
// for an answer for hours without writing anything, and a time-based rule would
// hide exactly the state the user has to act on.
func (server *Server) handleAgentAttention(w http.ResponseWriter, r *http.Request) {
	identity := auth.FromContext(r.Context())

	conversations, err := server.store.ListConversationAttention(identity.UserID)
	if err != nil {
		slog.Error("list conversation attention", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	type attentionEntry struct {
		AgentID   string `json:"agent_id"`
		ChatID    string `json:"chat_id"`
		SessionID string `json:"session_id"`
		Running   bool   `json:"running"`
		Awaiting  bool   `json:"awaiting"`
		// UpdatedAt is the server timestamp of the newest segment, RFC3339Nano.
		// Empty when the row predates the field; the browser then reports no
		// unread rather than inventing one from its own clock.
		UpdatedAt string `json:"updated_at"`
	}

	result := make([]attentionEntry, 0, len(conversations))
	for _, conversation := range conversations {
		result = append(result, attentionEntry{
			AgentID:   conversation.AgentID,
			ChatID:    conversation.ChatID,
			SessionID: conversation.SessionID,
			Running:   turnRunning(conversation.TurnRunning, conversation.TurnUpdatedAt),
			Awaiting:  metaHasPending(conversation.Meta),
			UpdatedAt: formatAttentionTime(conversation.UpdatedAt),
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"conversations": result})
}

// formatAttentionTime renders a server timestamp in the same shape the rest of
// the API uses, and an empty string for a zero time.
func formatAttentionTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}

// metaHasPending reports whether a stored meta blob carries an unanswered
// question or approval. The blob maps keys to JSON-encoded strings, and an empty
// string is what the agent writes when a prompt is resolved; a missing key or a
// malformed blob simply has none.
func metaHasPending(meta string) bool {
	if meta == "" {
		return false
	}
	var fields map[string]string
	if json.Unmarshal([]byte(meta), &fields) != nil {
		return false
	}
	return fields["_pending_question"] != "" || fields["_pending_approval"] != ""
}
