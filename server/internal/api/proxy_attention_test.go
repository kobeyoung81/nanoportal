package api_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"gitee.com/kobeyoung81/nanoportal/server/internal/api"
	"gitee.com/kobeyoung81/nanoportal/server/internal/store"
)

// TestAgentAttentionIsScopedToTheCaller pins the scoping of the attention
// snapshot. The path carries no agent id, so the user the snapshot is built for
// must come from the verified identity and never from the request — otherwise a
// caller could read another account's running and waiting conversations.
func TestAgentAttentionIsScopedToTheCaller(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "test-admin"})
	env.store.withAgent(store.AgentRecord{ID: "agent-2", UserID: "someone-else"})
	env.store.attention = []store.ConversationAttention{
		{AgentID: "agent-1", ChatID: "chat-1", SessionID: "web:chat-1", TurnRunning: true, TurnUpdatedAt: time.Now(), UpdatedAt: time.Now()},
		{AgentID: "agent-2", ChatID: "chat-9", SessionID: "web:chat-9", Meta: `{"_pending_question":"x"}`},
	}

	// A user_id in the request must be ignored: the identity decides.
	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/agents/attention?user_id=someone-else", "", env.token)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"session_id":"web:chat-1"`) {
		t.Fatalf("own conversation missing from the snapshot: %q", body)
	}
	if strings.Contains(body, "web:chat-9") {
		t.Fatalf("another account's conversation leaked into the snapshot: %q", body)
	}
	if !strings.Contains(body, `"running":true`) {
		t.Fatalf("running flag missing: %q", body)
	}
}

// A running flag is only believed while it is fresh: an agent that died
// mid-turn leaves it set, and a dot that never clears is worse than no dot.
func TestAgentAttentionAgesOutAStaleTurn(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "test-admin"})
	env.store.attention = []store.ConversationAttention{
		{AgentID: "agent-1", ChatID: "chat-1", SessionID: "web:chat-1", TurnRunning: true,
			TurnUpdatedAt: time.Now().Add(-time.Minute)},
	}

	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/agents/attention", "", env.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if body := rec.Body.String(); strings.Contains(body, `"running":true`) {
		t.Fatalf("a turn last written a minute ago must not read as running: %s", body)
	}
}

// An unanswered question is not aged out: waiting for the user may legitimately
// last for hours without the conversation being written.
func TestAgentAttentionKeepsALongPendingQuestion(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	env.store.withAgent(store.AgentRecord{ID: "agent-1", UserID: "test-admin"})
	env.store.attention = []store.ConversationAttention{{
		AgentID: "agent-1", ChatID: "chat-1", SessionID: "web:chat-1",
		UpdatedAt: time.Now().Add(-6 * time.Hour),
		Meta:      fmt.Sprintf(`{"_pending_question":%q}`, "继续吗？"),
	}}

	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/agents/attention", "", env.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if body := rec.Body.String(); !strings.Contains(body, `"awaiting":true`) {
		t.Fatalf("a pending question must survive any age: %s", body)
	}
}
