package api

import "testing"

// The rule the UI displays: the agent's own value wins, then the most specific
// platform key, and build is the last resort — the same order the agent applies
// when it resolves a task's mode.
func TestResolveTaskMode(t *testing.T) {
	keys := platformDefaultKeys("agent-1", "scheduledTaskMode")

	cases := []struct {
		name       string
		agentValue string
		platform   map[string]string
		wantMode   string
		wantSource string
	}{
		{"agent value wins", "plan", map[string]string{keys[0]: "build"}, "plan", "agent"},
		{"platform per-agent key", "", map[string]string{keys[0]: "plan"}, "plan", "platform"},
		{"agent.default key", "", map[string]string{keys[1]: "plan"}, "plan", "platform"},
		{"direct key", "", map[string]string{keys[2]: "plan"}, "plan", "platform"},
		{"per-agent beats direct", "", map[string]string{keys[0]: "build", keys[2]: "plan"}, "build", "platform"},
		{"invalid agent value falls through", "turbo", map[string]string{keys[2]: "plan"}, "plan", "platform"},
		{"invalid platform value falls back to build", "", map[string]string{keys[2]: "turbo"}, "build", "platform"},
		{"nothing configured", "", nil, "build", "platform"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mode, source := resolveTaskMode(tc.agentValue, tc.platform, "agent-1")
			if mode != tc.wantMode || source != tc.wantSource {
				t.Fatalf("resolveTaskMode = (%q, %q), want (%q, %q)", mode, source, tc.wantMode, tc.wantSource)
			}
		})
	}
}

func TestUserReadableAgentSettings_ExcludesDeploymentSecrets(t *testing.T) {
	for key := range userReadableAgentSettings {
		switch key {
		case "scheduled_task_mode":
		default:
			t.Errorf("the read whitelist gained %q; secrets live in the agent component", key)
		}
	}
}
