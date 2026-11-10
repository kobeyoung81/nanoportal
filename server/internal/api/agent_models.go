package api

import (
	"net/http"
)

// agentMode names the (agent, mode) pair whose model should be resolved. The
// mode id is the agent's default session agent, which this service stores; the
// catalogue that answers is the admin module's.
type agentMode struct {
	AgentID string `json:"agent_id"`
	TypeID  string `json:"type_id"`
}

// resolvedModel is the catalogue's answer for one agent.
type resolvedModel struct {
	ModelID int64  `json:"model_id"`
	Name    string `json:"name"`
}

// resolveAgentModels asks the admin module which model each agent's default mode
// ends up using. One call for the whole list: a per-agent round trip would turn
// a 40-agent sidebar into 40 requests.
//
// This is display data only. The agent runtime resolves its own model from the
// catalogue, so a failure here leaves the column blank and nothing else.
func (server *Server) resolveAgentModels(modes []agentMode) (map[string]resolvedModel, error) {
	if len(modes) == 0 {
		return map[string]resolvedModel{}, nil
	}
	var out struct {
		Models map[string]resolvedModel `json:"models"`
	}
	body := map[string]any{"agents": modes}
	if err := server.adminCall(http.MethodPost, "/api/v1/agent-types/effective-models", body, &out); err != nil {
		return nil, err
	}
	if out.Models == nil {
		out.Models = map[string]resolvedModel{}
	}
	return out.Models, nil
}
