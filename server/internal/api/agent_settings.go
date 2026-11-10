package api

import (
	"net/http"

	"gitee.com/kobeyoung81/nanoportal/server/internal/auth"
)

// userReadableAgentSettings are the per-agent settings a user may read back.
// The map is API key → the key used in agents.settings and in the config plane;
// it is deliberately narrow: the read must never be a way to see deployment
// configuration (the `agent` component carries secrets such as the media ones).
var userReadableAgentSettings = map[string]string{
	"scheduled_task_mode": "scheduledTaskMode",
}

// platformDefaultFor returns the config-plane keys that decide the platform
// default for one agent setting, most specific first: the per-agent key, the
// agent.default. key, then the direct key. A key the config plane does not
// carry simply resolves to "" and the caller applies its own default.
func platformDefaultKeys(agentID, configSuffix string) []string {
	return []string{
		"agent." + agentID + "." + configSuffix,
		"agent.default." + configSuffix,
		"agent." + configSuffix,
	}
}

// validTaskMode reports whether a value names a mode a task may run in.
func validTaskMode(value string) bool {
	return value == "build" || value == "plan"
}

// resolveTaskMode picks the mode that actually applies to an agent's scheduled
// tasks, and where it came from. The agent's own setting wins; otherwise the
// platform default (most specific config-plane key first); the last resort is
// build, matching cron.TaskMode on the agent side. This is a display-only copy
// of that rule — the agent is authoritative, and the UI is verified against its
// behaviour.
func resolveTaskMode(agentValue string, platform map[string]string, agentID string) (string, string) {
	if validTaskMode(agentValue) {
		return agentValue, "agent"
	}
	for _, key := range platformDefaultKeys(agentID, userReadableAgentSettings["scheduled_task_mode"]) {
		if value := platform[key]; validTaskMode(value) {
			return value, "platform"
		}
	}
	return "build", "platform"
}

// handleAgentSetting reports the effective value of one per-agent setting for
// one agent, plus where it comes from, so the agent form can show what
// "inherit" currently means instead of an opaque word.
func (server *Server) handleAgentSetting(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	key := r.PathValue("key")

	configSuffix, ok := userReadableAgentSettings[key]
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unsupported setting"})
		return
	}

	agent, err := server.store.GetAgent(agentID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if agent == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
		return
	}
	identity := auth.FromContext(r.Context())
	if !identity.CanManageUsers() && agent.UserID != identity.UserID {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not the agent owner"})
		return
	}

	platform, err := server.repo.GetConfigValues(r.Context(), "agent", platformDefaultKeys(agentID, configSuffix))
	if err != nil {
		// The setting still has a usable default; a config read failure must not
		// break the form.
		platform = map[string]string{}
	}

	agentValue := agent.Settings[key]
	effective, source := resolveTaskMode(agentValue, platform, agentID)

	writeJSON(w, http.StatusOK, map[string]any{
		"key":              key,
		"agent_value":      agentValue,
		"platform_default": platformDefaultValue(platform, agentID, configSuffix),
		"effective":        effective,
		"source":           source,
	})
}

// platformDefaultValue is the platform default on its own (ignoring the agent's
// value), so the form can label the "inherit" option with what it means.
func platformDefaultValue(platform map[string]string, agentID, configSuffix string) string {
	for _, key := range platformDefaultKeys(agentID, configSuffix) {
		if value := platform[key]; validTaskMode(value) {
			return value
		}
	}
	return "build"
}
