package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"unicode"

	"gitee.com/kobeyoung81/nanoportal/server/internal/auth"
	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
)

// agentInfo mirrors the bus agent payload shape consumed by the portal UI.
type agentInfo struct {
	ID             string   `json:"id"`
	UserID         string   `json:"user_id"`
	TypeID         string   `json:"type_id,omitempty"`
	GroupID        string   `json:"group_id,omitempty"`
	SessionAgents  []string `json:"session_agents,omitempty"`
	DefaultAgent   string   `json:"default_agent,omitempty"`
	DisplayName    string   `json:"display_name"`
	Description    string   `json:"description"`
	Model          string   `json:"model"`
	TitleModel     string   `json:"title_model,omitempty"`
	SummarizeModel string   `json:"summarize_model,omitempty"`
	SubagentModel  string   `json:"subagent_model,omitempty"`
	// Settings round-trips the per-agent runtime overrides the agent update
	// endpoint accepts (e.g. scheduled_task_mode).
	Settings   map[string]string `json:"settings,omitempty"`
	Status     string            `json:"status"`
	Tools      []string          `json:"tools"`
	Workspaces []string          `json:"workspaces"`
	CreatedAt  string            `json:"created_at"`
}

type agentWithOwner struct {
	agentInfo
	OwnerDisplayName string `json:"owner_display_name"`
}

type createAgentRequest struct {
	UserID      string `json:"user_id"`
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Description string `json:"description"`
	Model       string `json:"model"`
	GroupID     string `json:"group_id,omitempty"`
}

func (server *Server) handleCreateAgent(w http.ResponseWriter, r *http.Request) {
	var req createAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	defer r.Body.Close()

	if req.DisplayName == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "display_name is required"})
		return
	}

	identity := auth.FromContext(r.Context())
	// Non-managers may only create agents for themselves.
	if !identity.CanManageUsers() {
		req.UserID = identity.UserID
	}
	// Operators may create agents on behalf of others (user_id provided); when
	// omitted, default to the caller's own identity so self-service creation
	// works for operator/admin accounts too.
	if req.UserID == "" {
		req.UserID = identity.UserID
	}
	if req.UserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id is required"})
		return
	}
	if req.ID == "" {
		req.ID = slugify(req.DisplayName)
	}

	target := server.busURL() + "/api/v1/agents"
	if err := server.proxy.forwardPOSTJSON(w, r, target, req); err != nil {
		return
	}

	if err := server.repo.RecordAudit(r.Context(), model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "agent.create",
		ResourceType: "agent",
		ResourceID:   req.ID,
		Detail:       map[string]any{"user_id": req.UserID},
		IP:           clientIP(r),
	}); err != nil {
		return
	}
}

func (server *Server) handleUpdateAgent(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")

	agent, err := server.getAgentInfo(r, agentID)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}

	identity := auth.FromContext(r.Context())
	if !identity.CanManageUsers() && agent.UserID != identity.UserID {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not the agent owner"})
		return
	}

	var raw json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	defer r.Body.Close()

	target := server.busURL() + "/api/v1/agents/" + url.PathEscape(agentID)
	if err := server.proxy.forwardJSON(w, r, target, raw); err != nil {
		return
	}

	if err := server.repo.RecordAudit(r.Context(), model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "agent.update",
		ResourceType: "agent",
		ResourceID:   agentID,
		IP:           clientIP(r),
	}); err != nil {
		return
	}
}

func (server *Server) handleDeleteAgent(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")

	agent, err := server.getAgentInfo(r, agentID)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}

	identity := auth.FromContext(r.Context())
	if !identity.CanManageUsers() && agent.UserID != identity.UserID {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not the agent owner"})
		return
	}

	target := server.busURL() + "/api/v1/agents/" + url.PathEscape(agentID)
	if err := server.proxy.forwardDELETE(w, r, target); err != nil {
		return
	}

	if err := server.repo.RecordAudit(r.Context(), model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "agent.delete",
		ResourceType: "agent",
		ResourceID:   agentID,
		IP:           clientIP(r),
	}); err != nil {
		return
	}
}

// handleRestartAgent notifies the supervisor to restart a running agent's
// process by forwarding to the bus restart endpoint.
func (server *Server) handleRestartAgent(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")

	agent, err := server.getAgentInfo(r, agentID)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}

	identity := auth.FromContext(r.Context())
	if !identity.CanManageUsers() && agent.UserID != identity.UserID {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not the agent owner"})
		return
	}

	target := server.busURL() + "/api/v1/agents/" + url.PathEscape(agentID) + "/restart"
	if err := server.proxy.forwardPOST(w, r, target); err != nil {
		return
	}

	if err := server.repo.RecordAudit(r.Context(), model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "agent.restart",
		ResourceType: "agent",
		ResourceID:   agentID,
		IP:           clientIP(r),
	}); err != nil {
		return
	}
}

// handleProvisionAgent re-triggers provisioning for a failed agent by
// forwarding to the bus provision endpoint.
func (server *Server) handleProvisionAgent(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")

	agent, err := server.getAgentInfo(r, agentID)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}

	identity := auth.FromContext(r.Context())
	if !identity.CanManageUsers() && agent.UserID != identity.UserID {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not the agent owner"})
		return
	}

	target := server.busURL() + "/api/v1/agents/" + url.PathEscape(agentID) + "/provision"
	if err := server.proxy.forwardPOST(w, r, target); err != nil {
		return
	}

	if err := server.repo.RecordAudit(r.Context(), model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "agent.provision",
		ResourceType: "agent",
		ResourceID:   agentID,
		IP:           clientIP(r),
	}); err != nil {
		return
	}
}

// handleRestoreAgent brings a deleted agent back to provisioning on behalf of
// the owner (or an operator).
func (server *Server) handleRestoreAgent(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")

	agent, err := server.getAgentInfo(r, agentID)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}

	identity := auth.FromContext(r.Context())
	if !identity.CanManageUsers() && agent.UserID != identity.UserID {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not the agent owner"})
		return
	}

	target := server.busURL() + "/api/v1/agents/" + url.PathEscape(agentID) + "/restore"
	if err := server.proxy.forwardPOST(w, r, target); err != nil {
		return
	}

	if err := server.repo.RecordAudit(r.Context(), model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "agent.restore",
		ResourceType: "agent",
		ResourceID:   agentID,
		IP:           clientIP(r),
	}); err != nil {
		return
	}
}

// getAgentInfo fetches an agent from the bus without writing to the response.
func (server *Server) getAgentInfo(r *http.Request, agentID string) (*agentInfo, error) {
	target := server.busURL() + "/api/v1/agents/" + url.PathEscape(agentID)
	body, err := server.proxy.getJSON(r, target)
	if err != nil {
		return nil, err
	}
	var agent agentInfo
	if err := json.Unmarshal(body, &agent); err != nil {
		return nil, err
	}
	return &agent, nil
}

// slugify converts a display name into a URL-safe agent id.
func slugify(name string) string {
	var b strings.Builder
	prevDash := false
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			prevDash = false
		} else if !prevDash && b.Len() > 0 {
			b.WriteByte('-')
			prevDash = true
		}
	}
	slug := strings.Trim(b.String(), "-")
	if slug == "" {
		slug = "agent"
	}
	return slug + "-" + shortID(4)
}

func shortID(bytes int) string {
	buf := make([]byte, bytes)
	if _, err := rand.Read(buf); err != nil {
		return "0000"
	}
	return hex.EncodeToString(buf)
}
