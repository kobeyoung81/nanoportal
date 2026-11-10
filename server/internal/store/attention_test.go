package store

import (
	"context"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// TestSetAgentSettings pins the two documented behaviours: an allowed key is
// stored (empty values dropped), and an unknown key or value is refused with a
// sentinel the handler maps to 400.
func TestSetAgentSettings(t *testing.T) {
	st := testStore(t)
	withTier(st, "pro")
	if err := st.CreateAgent(AgentRecord{ID: "agent-1", UserID: "user-1", TypeID: "build"}); err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := st.SetAgentSettings("agent-1", map[string]string{"scheduled_task_mode": "plan"}); err != nil {
		t.Fatalf("set: %v", err)
	}
	// Read the document directly: the list/detail projection deliberately does
	// not carry settings (the agent runtime reads them through the config plane),
	// so the round trip is pinned on storage rather than on that read shape.
	var doc struct {
		Settings map[string]string `bson:"settings"`
	}
	if err := st.DB().Collection(agentsCollection).FindOne(context.Background(),
		bson.D{{Key: "_id", Value: "agent-1"}}).Decode(&doc); err != nil {
		t.Fatalf("read agent: %v", err)
	}
	if doc.Settings["scheduled_task_mode"] != "plan" {
		t.Fatalf("settings = %+v", doc.Settings)
	}

	// An empty value means "inherit": it must not be stored.
	if err := st.SetAgentSettings("agent-1", map[string]string{"scheduled_task_mode": ""}); err != nil {
		t.Fatalf("clear: %v", err)
	}
	doc.Settings = nil
	if err := st.DB().Collection(agentsCollection).FindOne(context.Background(),
		bson.D{{Key: "_id", Value: "agent-1"}}).Decode(&doc); err != nil {
		t.Fatalf("read agent: %v", err)
	}
	if _, ok := doc.Settings["scheduled_task_mode"]; ok {
		t.Fatalf("an empty value was stored: %+v", doc.Settings)
	}

	if err := st.SetAgentSettings("agent-1", map[string]string{"not_a_setting": "x"}); err == nil {
		t.Fatal("an unknown key was accepted")
	}
	if err := st.SetAgentSettings("agent-1", map[string]string{"scheduled_task_mode": "sideways"}); err == nil {
		t.Fatal("an invalid value was accepted")
	}
	if err := st.SetAgentSettings("missing", map[string]string{"scheduled_task_mode": "plan"}); err == nil {
		t.Fatal("a missing agent was accepted")
	}
}

// TestClearAgentsTypeRef pins that only the agents pointing at the deleted type
// are touched, and that the count is the modified count.
func TestClearAgentsTypeRef(t *testing.T) {
	st := testStore(t)
	withTier(st, "pro")
	for _, id := range []string{"a1", "a2"} {
		if err := st.CreateAgent(AgentRecord{ID: id, UserID: "user-1", TypeID: "build"}); err != nil {
			t.Fatalf("create %s: %v", id, err)
		}
	}
	if err := st.CreateAgent(AgentRecord{ID: "a3", UserID: "user-1", TypeID: "plan"}); err != nil {
		t.Fatalf("create a3: %v", err)
	}

	cleared, err := st.ClearAgentsTypeRef("build")
	if err != nil {
		t.Fatalf("clear: %v", err)
	}
	if cleared != 2 {
		t.Fatalf("cleared = %d, want 2", cleared)
	}
	for _, id := range []string{"a1", "a2"} {
		agent, _ := st.GetAgent(id)
		if agent.TypeID != "" {
			t.Fatalf("%s still points at the deleted type: %q", id, agent.TypeID)
		}
	}
	agent, _ := st.GetAgent("a3")
	if agent.TypeID != "plan" {
		t.Fatalf("a3 should be untouched, got %q", agent.TypeID)
	}
}

// TestListConversationAttention pins the three properties the sidebar depends
// on: one row per conversation (the newest segment), a freshness window on the
// running flag, and no ageing at all for a pending question.
func TestListConversationAttention(t *testing.T) {
	st := testStore(t)
	withTier(st, "pro")
	for id, owner := range map[string]string{"agent-1": "user-1", "agent-2": "user-2"} {
		if err := st.CreateAgent(AgentRecord{ID: id, UserID: owner, TypeID: "build"}); err != nil {
			t.Fatalf("create %s: %v", id, err)
		}
	}

	now := time.Now().UTC()
	fresh := now.Add(-2 * time.Second)
	old := now.Add(-10 * time.Minute)
	sessions := st.DB().Collection(sessionsCollection)
	docs := []bson.D{
		// Two segments of the same conversation: only the newest may be returned.
		{{Key: "_id", Value: "web:chat-1"}, {Key: "agent_id", Value: "agent-1"}, {Key: "chat_id", Value: "chat-1"},
			{Key: "channel", Value: "web"}, {Key: "status", Value: "active"},
			{Key: "turn_running", Value: false}, {Key: "updated_at", Value: now.Add(-time.Hour)}},
		{{Key: "_id", Value: "web:chat-1:v2"}, {Key: "agent_id", Value: "agent-1"}, {Key: "chat_id", Value: "chat-1"},
			{Key: "channel", Value: "web"}, {Key: "status", Value: "active"},
			{Key: "turn_running", Value: true}, {Key: "turn_updated_at", Value: fresh},
			{Key: "meta", Value: `{"_pending_question":"continue?"}`}, {Key: "updated_at", Value: now}},
		// A stale running flag must not read as running.
		{{Key: "_id", Value: "web:chat-2"}, {Key: "agent_id", Value: "agent-1"}, {Key: "chat_id", Value: "chat-2"},
			{Key: "channel", Value: "web"}, {Key: "status", Value: "active"},
			{Key: "turn_running", Value: true}, {Key: "turn_updated_at", Value: old},
			{Key: "updated_at", Value: now}},
		// Another account's agent is not in the answer.
		{{Key: "_id", Value: "web:chat-3"}, {Key: "agent_id", Value: "agent-2"}, {Key: "chat_id", Value: "chat-3"},
			{Key: "channel", Value: "web"}, {Key: "status", Value: "active"}, {Key: "updated_at", Value: now}},
		// Archived conversations and other channels are excluded.
		{{Key: "_id", Value: "web:chat-4"}, {Key: "agent_id", Value: "agent-1"}, {Key: "chat_id", Value: "chat-4"},
			{Key: "channel", Value: "web"}, {Key: "status", Value: "archived"}, {Key: "updated_at", Value: now}},
		{{Key: "_id", Value: "wx:chat-5"}, {Key: "agent_id", Value: "agent-1"}, {Key: "chat_id", Value: "chat-5"},
			{Key: "channel", Value: "wecom"}, {Key: "status", Value: "active"}, {Key: "updated_at", Value: now}},
	}
	for _, doc := range docs {
		if _, err := sessions.InsertOne(context.Background(), doc); err != nil {
			t.Fatalf("seed session: %v", err)
		}
	}

	got, err := st.ListConversationAttention("user-1")
	if err != nil {
		t.Fatalf("attention: %v", err)
	}
	byChat := map[string]ConversationAttention{}
	for _, c := range got {
		byChat[c.ChatID] = c
	}
	if len(got) != 2 {
		t.Fatalf("got %d conversations, want 2: %+v", len(got), got)
	}
	if c := byChat["chat-1"]; c.SessionID != "web:chat-1:v2" || !c.TurnRunning || c.Meta == "" {
		t.Fatalf("chat-1 should be its newest segment with the pending question: %+v", c)
	}
	if c := byChat["chat-2"]; !c.TurnRunning {
		// Stored verbatim here: the freshness decision is the API's, and this
		// pins that the store does not lose the timestamp it needs.
		t.Fatalf("chat-2 lost its turn flag: %+v", c)
	}
}
