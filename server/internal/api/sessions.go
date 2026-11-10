package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"gitee.com/kobeyoung81/nanoportal/server/internal/auth"
	"gitee.com/kobeyoung81/nanoportal/server/internal/store"
)

// The session projection's reads. The agents write it (see the internal endpoint
// in internal_api.go); the browser reads it through these, and the console's log
// page reaches the same store from logs_admin.go.

// handleAgentSessions lists one agent's conversations, newest first. Ownership is
// checked against this service's own agent rows.
func (server *Server) handleAgentSessions(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	identity := auth.FromContext(r.Context())

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
	if !identity.CanManageUsers() && identity.UserID != agent.UserID {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not the agent owner"})
		return
	}

	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	offset := 0
	if raw := r.URL.Query().Get("offset"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			offset = parsed
		}
	}

	sessions, err := server.store.ListSessions(agentID, limit, offset)
	if err != nil {
		slog.Error("list sessions", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	type sessionMeta struct {
		ID           string `json:"id"`
		AgentID      string `json:"agent_id"`
		AccountID    string `json:"account_id"`
		Channel      string `json:"channel"`
		ChatID       string `json:"chat_id"`
		Status       string `json:"status"`
		Title        string `json:"title"`
		MessageCount int    `json:"message_count"`
		TurnRunning  bool   `json:"turn_running"`
		CreatedAt    string `json:"created_at"`
		UpdatedAt    string `json:"updated_at"`
	}

	result := make([]sessionMeta, 0, len(sessions))
	for _, session := range sessions {
		result = append(result, sessionMeta{
			ID:           session.ID,
			AgentID:      session.AgentID,
			AccountID:    session.AccountID,
			Channel:      session.Channel,
			ChatID:       session.ChatID,
			Status:       session.Status,
			Title:        session.Title,
			MessageCount: session.MessageCount,
			TurnRunning:  turnRunning(session.TurnRunning, session.TurnUpdatedAt),
			CreatedAt:    session.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
			UpdatedAt:    session.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z"),
		})
	}

	total, err := server.store.CountSessions(agentID)
	if err != nil {
		slog.Error("count sessions", "error", err)
		total = offset + len(result)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"agent_id": agentID,
		"sessions": result,
		"count":    len(result),
		"total":    total,
		"has_more": offset+len(result) < total,
	})
}

// handleSession returns one conversation.
//
//   - `?meta=1` returns metadata only, never loading the messages blob. Callers
//     that just need identity/ownership (the gateway's resume check) use it so a
//     multi-MiB conversation is not transferred on their behalf.
//   - With no `limit` it returns the full history (back-compat).
//   - With `limit` it returns a tail page of the message array, walking
//     backwards via the `before` cursor, so long conversations load
//     newest-first.
//
// Paginated responses carry an ETag derived from the stored metadata; a request
// whose If-None-Match matches it is answered 304 without reading the blob.
func (server *Server) handleSession(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("sessionID")
	if sessionID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "session id is required"})
		return
	}
	if !server.sessionAccessAllowed(w, r, sessionID) {
		return
	}

	// The metadata read answers the meta-only request and the validators below
	// without touching the (possibly multi-MiB) messages blob.
	head, err := server.store.GetSessionMeta(sessionID)
	if err != nil {
		slog.Error("get session meta", "session_id", sessionID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if head == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
		return
	}

	// Storable by the browser, but only after revalidation: with the ETag below a
	// reload of an unchanged conversation costs one conditional request and no
	// body (and the blob is never read). "private" keeps it out of shared caches,
	// because the response belongs to one user.
	w.Header().Set("Cache-Control", "private, no-cache")

	if r.URL.Query().Get("meta") == "1" {
		writeJSON(w, http.StatusOK, sessionResponse(head))
		return
	}

	etag := sessionETag(head)
	w.Header().Set("ETag", etag)
	if matchesETag(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	rec, err := server.store.GetSession(sessionID)
	if err != nil {
		slog.Error("get session", "session_id", sessionID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if rec == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
		return
	}

	resp := sessionResponse(rec)

	limit := 0
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = n
		}
	}
	if limit == 0 {
		resp["messages"] = rec.Messages
		writeJSON(w, http.StatusOK, resp)
		return
	}

	before := -1
	if raw := r.URL.Query().Get("before"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 0 {
			before = n
		}
	}
	page, total, nextBefore, hasMore := sliceMessages(rec.Messages, limit, before)
	resp["messages"] = page
	resp["total"] = total
	resp["before"] = nextBefore
	resp["has_more"] = hasMore

	writeJSON(w, http.StatusOK, resp)
}

// handleArchiveSession archives a session server-side (New Chat).
func (server *Server) handleArchiveSession(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("sessionID")
	if sessionID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "session id is required"})
		return
	}
	if !server.sessionAccessAllowed(w, r, sessionID) {
		return
	}

	if err := server.store.ArchiveSession(sessionID); err != nil {
		slog.Error("archive session", "session_id", sessionID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session_id": sessionID, "status": "archived"})
}

// sessionAccessAllowed enforces "owner or manager". Operators manage sessions
// across users, so only a normal user needs the ownership probe — and with it the
// extra metadata read.
func (server *Server) sessionAccessAllowed(w http.ResponseWriter, r *http.Request, sessionID string) bool {
	identity := auth.FromContext(r.Context())
	if identity.CanManageUsers() {
		return true
	}
	head, err := server.store.GetSessionMeta(sessionID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return false
	}
	if head == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
		return false
	}
	if head.AccountID != identity.UserID {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not the session owner"})
		return false
	}
	return true
}

// sessionResponse is the session shape shared by the metadata and history reads;
// callers add the `messages` field when they have it.
func sessionResponse(rec *store.SessionRecord) map[string]any {
	return map[string]any{
		"session_id":     rec.ID,
		"agent_id":       rec.AgentID,
		"account_id":     rec.AccountID,
		"channel":        rec.Channel,
		"chat_id":        rec.ChatID,
		"status":         rec.Status,
		"title":          rec.Title,
		"summary":        rec.Summary,
		"meta":           rec.Meta,
		"message_count":  rec.MessageCount,
		"messages_bytes": rec.MessagesBytes,
		"turn_running":   turnRunning(rec.TurnRunning, rec.TurnUpdatedAt),
		"created_at":     rec.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
		"updated_at":     rec.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z"),
	}
}

// sessionETag fingerprints a stored session so an unchanged conversation can be
// answered with 304 instead of transferring and re-parsing its messages.
func sessionETag(rec *store.SessionRecord) string {
	return fmt.Sprintf("W/\"%d-%d-%d\"", rec.MessageCount, rec.MessagesBytes, rec.UpdatedAt.Unix())
}

// matchesETag reports whether an If-None-Match header selects the given ETag.
// It accepts a comma-separated list, the `*` wildcard, and treats the weak and
// strong forms of the same value as equal.
func matchesETag(header, etag string) bool {
	header = strings.TrimSpace(header)
	if header == "" {
		return false
	}
	if header == "*" {
		return true
	}
	want := strings.TrimPrefix(etag, "W/")
	for _, part := range strings.Split(header, ",") {
		if strings.TrimPrefix(strings.TrimSpace(part), "W/") == want {
			return true
		}
	}
	return false
}

// sliceMessages returns a tail page of a persisted messages JSON array. When
// `before` is negative the page ends at the array length (newest page);
// otherwise it ends at that index. It returns the encoded page, the total
// message count, the next `before` cursor, and whether older messages remain.
func sliceMessages(raw string, limit, before int) (string, int, int, bool) {
	var messages []json.RawMessage
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &messages)
	}
	if messages == nil {
		messages = []json.RawMessage{}
	}
	total := len(messages)
	end := total
	if before >= 0 && before < total {
		end = before
	}
	start := end - limit
	if start < 0 {
		start = 0
	}
	page, err := json.Marshal(messages[start:end])
	if err != nil {
		page = []byte("[]")
	}
	return string(page), total, start, start > 0
}
