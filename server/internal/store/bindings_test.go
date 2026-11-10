package store

import (
	"context"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// The binding's default agent is an explicit preference, else the owner's first
// active agent. Both halves of that read live here now.
func TestBindingAgentPreferenceAndFallback(t *testing.T) {
	st := testStore(t)
	withTier(st, "pro")
	ctx := context.Background()

	// The account owns binding 42 through the channel embedded in its document.
	if _, err := st.DB().Collection(authUsersCollection).InsertOne(ctx, bson.D{
		{Key: "_id", Value: "user-1"},
		{Key: "display_name", Value: "Alice"},
		{Key: "channels", Value: bson.A{bson.D{{Key: "channel", Value: "wecom"}, {Key: "binding_id", Value: int64(42)}}}},
	}); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	for _, id := range []string{"agent-1", "agent-2"} {
		if err := st.CreateAgent(AgentRecord{ID: id, UserID: "user-1", TypeID: "build"}); err != nil {
			t.Fatalf("create %s: %v", id, err)
		}
	}
	// A failed agent must not be picked by the fallback.
	if err := st.SetAgentStatus("agent-2", "failed"); err != nil {
		t.Fatalf("status: %v", err)
	}

	got, err := st.GetBindingAgent(42)
	if err != nil {
		t.Fatalf("fallback: %v", err)
	}
	if got != "agent-1" {
		t.Fatalf("fallback = %q, want agent-1", got)
	}

	if err := st.SetBindingAgent(42, "agent-2"); err != nil {
		t.Fatalf("pin: %v", err)
	}
	if got, _ = st.GetBindingAgent(42); got != "agent-2" {
		t.Fatalf("pinned = %q, want agent-2", got)
	}

	// Clearing the preference falls back again.
	if err := st.SetBindingAgent(42, ""); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if got, _ = st.GetBindingAgent(42); got != "agent-1" {
		t.Fatalf("after clear = %q, want agent-1", got)
	}

	// An unknown binding resolves to nothing rather than an error.
	if got, err = st.GetBindingAgent(9999); err != nil || got != "" {
		t.Fatalf("unknown binding = %q, %v", got, err)
	}
}
