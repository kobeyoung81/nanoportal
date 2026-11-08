package repository

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"gitee.com/kobeyoung81/nanoportal/server/internal/bustoken"
	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
)

// TestConversationClient_ReadsThroughTheBus pins the two things that would break
// the conversation log silently: the payload shape it decodes into the portal's
// model, and the internal token the bus demands — a request without it is refused
// by the bus, which reads in the portal as "there are no conversations".
func TestConversationClient_ReadsThroughTheBus(t *testing.T) {
	t.Setenv(bustoken.EnvVar, "test-token")

	var paths []string
	var requests []string
	var authHeaders []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		requests = append(requests, r.URL.RequestURI())
		authHeaders = append(authHeaders, r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/conversations":
			_, _ = w.Write([]byte(`{"conversations":[` +
				`{"id":"web:chat-1","agent_id":"agent-1","account_id":"user-1","channel":"web","chat_id":"chat-1",` +
				`"status":"active","message_count":12,"messages_bytes":4096,"updated_at":"2026-09-28T04:00:00Z"}]}`))
		case "/api/v1/conversations/web:chat-1":
			_, _ = w.Write([]byte(`{"id":"web:chat-1","agent_id":"agent-1","account_id":"user-1","channel":"web",` +
				`"chat_id":"chat-1","status":"active","message_count":2,"messages_bytes":64,` +
				`"updated_at":"2026-09-28T04:00:00Z","summary":"carried",` +
				`"messages":[{"role":"user","content":"a"},{"role":"assistant","content":"b"}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := newConversationClient(srv.URL)
	ctx := context.Background()

	conversations, err := c.conversations(ctx, model.ConversationQuery{
		Limit:   10,
		Session: "chat-1",
		Agent:   "ada",
		Account: "bob",
		Channel: "web",
		Status:  "active",
	})
	if err != nil {
		t.Fatalf("conversations: %v", err)
	}
	if len(conversations) != 1 {
		t.Fatalf("expected one conversation, got %+v", conversations)
	}
	first := conversations[0]
	if first.ID != "web:chat-1" || first.AgentID != "agent-1" || first.AccountID != "user-1" ||
		first.Channel != "web" || first.ChatID != "chat-1" || first.Status != "active" {
		t.Fatalf("unexpected summary: %+v", first)
	}
	if first.MessageCount != 12 || first.MessagesBytes != 4096 || first.UpdatedAt != "2026-09-28T04:00:00Z" {
		t.Fatalf("the counters or timestamp were not decoded: %+v", first)
	}

	detail, err := c.conversation(ctx, "web:chat-1")
	if err != nil {
		t.Fatalf("conversation: %v", err)
	}
	if detail.ID != "web:chat-1" || detail.Summary != "carried" {
		t.Fatalf("unexpected detail: %+v", detail)
	}
	// The messages land as raw JSON: the web UI receives the array it renders,
	// not a string it would have to parse twice.
	var messages []map[string]any
	if err := json.Unmarshal(detail.Messages, &messages); err != nil {
		t.Fatalf("messages are not a JSON array: %v (%s)", err, detail.Messages)
	}
	if len(messages) != 2 || messages[0]["content"] != "a" {
		t.Fatalf("unexpected messages: %+v", messages)
	}

	// Every call carried the token, and the listing's limit travelled with it.
	for i, header := range authHeaders {
		if header == "" {
			t.Fatalf("request %d (%s) went out without the bus token", i, paths[i])
		}
	}
	if len(paths) != 2 {
		t.Fatalf("unexpected requests: %v", paths)
	}
	// One parameter per condition, and only the non-empty ones.
	want := "/api/v1/conversations?account=bob&agent=ada&channel=web&limit=10&session=chat-1&status=active"
	if requests[0] != want {
		t.Fatalf("request = %s, want %s", requests[0], want)
	}
}

// TestConversationClient_MissingIsAnError: the portal shows an error rather than
// an empty log when the bus cannot answer.
func TestConversationClient_MissingIsAnError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"conversation not found"}`))
	}))
	defer srv.Close()

	if _, err := newConversationClient(srv.URL).conversation(context.Background(), "ghost"); err == nil {
		t.Fatal("expected an error for a missing conversation")
	}
}
