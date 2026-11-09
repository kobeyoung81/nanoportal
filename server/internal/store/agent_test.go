package store

import "testing"

// withTier wires a fixed tier so CreateAgent's cap can be exercised without the
// account service.
func withTier(st *Store, tier string) {
	st.SetUserSources(
		func(string) (string, error) { return tier, nil },
		func(int64) (string, error) { return "user-1", nil },
	)
}

func TestAgentRoundTripAndTierCap(t *testing.T) {
	st := testStore(t)
	withTier(st, "free")

	agent := AgentRecord{ID: "agent-1", UserID: "user-1", TypeID: "build", DisplayName: "One"}
	if err := st.CreateAgent(agent); err != nil {
		t.Fatalf("create: %v", err)
	}

	got, err := st.GetAgent("agent-1")
	if err != nil || got == nil {
		t.Fatalf("get: %v %v", got, err)
	}
	if got.UserID != "user-1" || got.TypeID != "build" || got.Status != "provisioning" {
		t.Fatalf("agent = %+v", got)
	}

	agents, err := st.ListAgents("user-1")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(agents) != 1 || agents[0].ID != "agent-1" {
		t.Fatalf("list = %+v", agents)
	}

	// The tier cap is a real limit, not a log line: free allows five agents.
	for i := 2; i <= 5; i++ {
		if err := st.CreateAgent(AgentRecord{ID: "agent-" + string(rune('0'+i)), UserID: "user-1", TypeID: "build"}); err != nil {
			t.Fatalf("agent %d within the cap: %v", i, err)
		}
	}
	if err := st.CreateAgent(AgentRecord{ID: "agent-6", UserID: "user-1", TypeID: "build"}); err == nil {
		t.Fatal("the free tier cap was not enforced")
	}
}

// Without the account lookup the store must refuse rather than skip the cap:
// "cannot tell the tier" must not become "unlimited agents".
func TestCreateAgentFailsClosedWithoutTierSource(t *testing.T) {
	st := testStore(t)
	if err := st.CreateAgent(AgentRecord{ID: "a", UserID: "u", TypeID: "build"}); err == nil {
		t.Fatal("a create without a tier source was accepted")
	}
}
