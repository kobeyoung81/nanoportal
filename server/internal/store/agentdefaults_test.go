package store

import "testing"

// EnsureDefaultAgent is what onboarding calls for a channel identity that has no
// agent: it has to be idempotent (a retried onboarding must not create a second
// agent) and it has to revive the deterministic row if it was deleted.
func TestEnsureDefaultAgentCreatesOnce(t *testing.T) {
	st := testStore(t)
	withTier(st, "free")

	id, created, err := st.EnsureDefaultAgent("user-1", "build", "My Agent")
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if !created || id != "user-1-default" {
		t.Fatalf("first ensure = (%q, %v), want (user-1-default, true)", id, created)
	}

	got, err := st.GetAgent(id)
	if err != nil || got == nil {
		t.Fatalf("get agent: %v %v", got, err)
	}
	if got.UserID != "user-1" || got.TypeID != "build" || got.Status != "provisioning" {
		t.Fatalf("agent = %+v", got)
	}
	if got.DisplayName != "My Agent" || got.MaxConcurrentMessages != 4 {
		t.Fatalf("agent defaults were not applied: %+v", got)
	}

	// A retry answers the same row and creates nothing.
	again, createdAgain, err := st.EnsureDefaultAgent("user-1", "build", "My Agent")
	if err != nil {
		t.Fatalf("second ensure: %v", err)
	}
	if createdAgain || again != id {
		t.Fatalf("second ensure = (%q, %v), want (%q, false)", again, createdAgain, id)
	}
	if agents, err := st.ListAgents("user-1"); err != nil || len(agents) != 1 {
		t.Fatalf("agents = %+v (err %v), want exactly one", agents, err)
	}
}

// An account that already created its own agent keeps it: onboarding must not add
// a second one next to it.
func TestEnsureDefaultAgentKeepsAnExistingAgent(t *testing.T) {
	st := testStore(t)
	withTier(st, "free")

	if err := st.CreateAgent(AgentRecord{ID: "custom", UserID: "user-1", TypeID: "plan", DisplayName: "Mine"}); err != nil {
		t.Fatalf("create: %v", err)
	}

	id, created, err := st.EnsureDefaultAgent("user-1", "build", "My Agent")
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if created || id != "custom" {
		t.Fatalf("ensure = (%q, %v), want (custom, false)", id, created)
	}
}

// A deleted agent is not "an agent": a tombstone means the user removed it, so
// ensure creates a usable one — reviving the deterministic row so the id stays
// predictable.
func TestEnsureDefaultAgentRevivesATombstone(t *testing.T) {
	st := testStore(t)
	withTier(st, "free")

	if _, _, err := st.EnsureDefaultAgent("user-1", "build", "My Agent"); err != nil {
		t.Fatalf("seed ensure: %v", err)
	}
	if err := st.DeleteAgent("user-1-default"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	id, created, err := st.EnsureDefaultAgent("user-1", "build", "My Agent")
	if err != nil {
		t.Fatalf("ensure after delete: %v", err)
	}
	if !created || id != "user-1-default" {
		t.Fatalf("ensure after delete = (%q, %v), want (user-1-default, true)", id, created)
	}
	got, err := st.GetAgent(id)
	if err != nil || got == nil {
		t.Fatalf("get agent: %v %v", got, err)
	}
	if got.Status == "deleted" {
		t.Fatalf("the tombstone was not revived: %+v", got)
	}
}
