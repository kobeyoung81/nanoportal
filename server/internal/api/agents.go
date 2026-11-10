package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"unicode"

	"gitee.com/kobeyoung81/nanoportal/server/internal/auth"
	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
	"gitee.com/kobeyoung81/nanoportal/server/internal/store"
)

// defaultAgentTypeID is the platform's conversational type. The catalogue is the
// admin module's, but every deployment seeds this one, and a create request with
// no type has always meant "the default build agent".
const defaultAgentTypeID = "build"

// agentInfo is the wire shape of an agent. It mirrors the bus's
// nanoprotocol.AgentInfo because the browser consumes one shape regardless of
// which service produced it: /api/v1/agents (gateway → bus) and the portal's own
// user/admin endpoints must stay interchangeable.
type agentInfo struct {
	ID            string            `json:"id"`
	UserID        string            `json:"user_id"`
	TypeID        string            `json:"type_id,omitempty"`
	GroupID       string            `json:"group_id,omitempty"`
	SessionAgents []string          `json:"session_agents,omitempty"`
	DefaultAgent  string            `json:"default_agent,omitempty"`
	DisplayName   string            `json:"display_name"`
	Description   string            `json:"description"`
	Model         string            `json:"model"`
	ModelID       int64             `json:"model_id,omitempty"`
	Thinking      string            `json:"thinking,omitempty"`
	Settings      map[string]string `json:"settings,omitempty"`
	MaxIterations int               `json:"max_iterations,omitempty"`
	Status        string            `json:"status"`
	Tools         []string          `json:"tools"`
	Workspaces    []string          `json:"workspaces"`
	CreatedAt     string            `json:"created_at"`
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
	TypeID      string `json:"type_id"`
	GroupID     string `json:"group_id,omitempty"`
}

// updateAgentRequest mirrors nanoprotocol.UpdateAgentRequest's partial-update
// semantics: a pointer field that is absent means "leave it alone".
type updateAgentRequest struct {
	TypeID       *string            `json:"type_id,omitempty"`
	DefaultAgent *string            `json:"default_agent,omitempty"`
	DisplayName  *string            `json:"display_name,omitempty"`
	Description  *string            `json:"description,omitempty"`
	GroupID      *string            `json:"group_id,omitempty"`
	Settings     *map[string]string `json:"settings,omitempty"`
}

// infoFromRecord maps a stored agent to the wire type: its switchable session
// agents, its default session agent, and (best effort) the model its default
// mode resolves to. The model comes from the catalogue, which lives in admin.
func (server *Server) infoFromRecord(a store.AgentRecord) agentInfo {
	var sessionAgents []string
	defaultAgent := ""
	if sessions, err := server.store.SessionAgentsForAgent(a.ID); err == nil {
		for _, sa := range sessions {
			sessionAgents = append(sessionAgents, sa.DefID)
			if sa.IsDefault {
				defaultAgent = sa.DefID
			}
		}
		if defaultAgent == "" && len(sessionAgents) > 0 {
			defaultAgent = sessionAgents[0]
		}
	}
	return agentInfo{
		ID:            a.ID,
		UserID:        a.UserID,
		TypeID:        a.TypeID,
		GroupID:       a.GroupID,
		SessionAgents: sessionAgents,
		DefaultAgent:  defaultAgent,
		DisplayName:   a.DisplayName,
		Description:   a.Description,
		Thinking:      a.Thinking,
		Settings:      a.Settings,
		MaxIterations: a.MaxIterations,
		Status:        a.Status,
		Tools:         []string{},
		Workspaces:    []string{},
	}
}

// agentInfos maps agent rows and fills in the model display name in one batched
// catalogue call.
func (server *Server) agentInfos(agents []store.AgentRecord) []agentInfo {
	out := make([]agentInfo, 0, len(agents))
	modes := make([]agentMode, 0, len(agents))
	for _, a := range agents {
		info := server.infoFromRecord(a)
		out = append(out, info)
		modes = append(modes, agentMode{AgentID: a.ID, TypeID: info.DefaultAgent})
	}
	resolved, err := server.resolveAgentModels(modes)
	if err != nil {
		// The catalogue is a display dependency here: a list must still render
		// when it is unreachable, minus one column.
		slog.Warn("resolve agent models", "error", err)
		return out
	}
	for i := range out {
		if m, ok := resolved[out[i].ID]; ok {
			out[i].Model = m.Name
			out[i].ModelID = m.ModelID
		}
	}
	return out
}

// handleCreateAgent creates an agent for the caller (or for another account when
// an operator asks), enqueues its container, and tells the supervisor.
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
	if !identity.CanManageUsers() {
		req.UserID = identity.UserID
	}
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
	typeID := req.TypeID
	if typeID == "" {
		typeID = defaultAgentTypeID
	}

	// The display name is what the sidebar shows; two agents with one name are
	// indistinguishable there, so a duplicate is refused before anything is
	// written (the collection has no unique index to fall back on).
	taken, err := server.store.AgentDisplayNameTaken(req.UserID, req.DisplayName, "")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if taken {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "an agent with this name already exists"})
		return
	}

	if req.GroupID != "" {
		ok, err := server.store.AgentGroupExists(req.UserID, req.GroupID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
		if !ok {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown group"})
			return
		}
	}

	err = server.store.CreateAgent(store.AgentRecord{
		ID:                    req.ID,
		UserID:                req.UserID,
		TypeID:                typeID,
		GroupID:               req.GroupID,
		DisplayName:           req.DisplayName,
		Description:           req.Description,
		MaxConcurrentMessages: 4,
	})
	if err != nil {
		slog.Error("create agent", "agent_id", req.ID, "error", err)
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}

	container := "pending"
	if err := server.enqueueContainer(req.UserID, req.ID); err != nil {
		slog.Error("ensure container request", "user_id", req.UserID, "agent_id", req.ID, "error", err)
		container = "failed"
	}
	server.notifyAgentsChanged(req.UserID, "create", req.ID)

	if err := server.repo.RecordAudit(r.Context(), model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "agent.create",
		ResourceType: "agent",
		ResourceID:   req.ID,
		Detail:       map[string]any{"user_id": req.UserID},
		IP:           clientIP(r),
	}); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "audit write failed"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": req.ID, "status": "created", "container": container})
}

// handleMeAgents lists the caller's own agents (the account page's own view).
func (server *Server) handleMeAgents(w http.ResponseWriter, r *http.Request) {
	identity := auth.FromContext(r.Context())
	server.listAgentsForUser(w, r, identity.UserID)
}

// listAgentsForUser serves both the console's per-user view and the caller's own
// list. `include_deleted` is honoured as before.
func (server *Server) listAgentsForUser(w http.ResponseWriter, r *http.Request, userID string) {
	includeDeleted := r.URL.Query().Get("include_deleted") == "true"
	agents, err := server.store.ListAgentsFiltered(userID, includeDeleted)
	if err != nil {
		slog.Error("list agents", "user_id", userID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusOK, server.agentInfos(agents))
}

// handleAgent returns one agent, decorated with its owner's display name for the
// console's cross-user view.
func (server *Server) handleAgent(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	agent, err := server.store.GetAgent(agentID)
	if err != nil {
		slog.Error("get agent", "agent_id", agentID, "error", err)
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
	infos := server.agentInfos([]store.AgentRecord{*agent})
	if len(infos) == 0 {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	ownerName := ""
	if name, err := server.repo.GetUserDisplayName(r.Context(), agent.UserID); err == nil {
		ownerName = name
	}
	writeJSON(w, http.StatusOK, agentWithOwner{agentInfo: infos[0], OwnerDisplayName: ownerName})
}

func (server *Server) handleUpdateAgent(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")

	existing, err := server.store.GetAgent(agentID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if existing == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
		return
	}

	identity := auth.FromContext(r.Context())
	if !identity.CanManageUsers() && existing.UserID != identity.UserID {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not the agent owner"})
		return
	}

	var req updateAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	defer r.Body.Close()

	if req.DisplayName != nil {
		existing.DisplayName = *req.DisplayName
		if *req.DisplayName != "" {
			taken, err := server.store.AgentDisplayNameTaken(existing.UserID, *req.DisplayName, existing.ID)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
				return
			}
			if taken {
				writeJSON(w, http.StatusConflict, map[string]string{"error": "an agent with this name already exists"})
				return
			}
		}
	}
	if req.Description != nil {
		existing.Description = *req.Description
	}
	if req.TypeID != nil {
		existing.TypeID = *req.TypeID
	}
	if req.DefaultAgent != nil && *req.DefaultAgent != "" {
		if err := server.store.SetDefaultSessionAgent(agentID, *req.DefaultAgent); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
	}
	if req.Settings != nil {
		// Documented semantics: present = replace the override map ({} clears).
		if err := server.store.SetAgentSettings(agentID, *req.Settings); err != nil {
			if errors.Is(err, store.ErrUnsupportedAgentSetting) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
				return
			}
			slog.Error("set agent settings", "agent", agentID, "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
	}
	if req.GroupID != nil {
		if *req.GroupID != "" {
			ok, err := server.store.AgentGroupExists(existing.UserID, *req.GroupID)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
				return
			}
			if !ok {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown group"})
				return
			}
		}
		if err := server.store.SetAgentGroup(agentID, *req.GroupID); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
	}

	if err := server.store.UpdateAgent(*existing); err != nil {
		slog.Error("update agent", "agent", agentID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	server.notifyAgentsChanged(existing.UserID, "update", agentID)
	server.notifyAgentSettingsChanged(agentID)
	if err := server.repo.RecordAudit(r.Context(), model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "agent.update",
		ResourceType: "agent",
		ResourceID:   agentID,
		IP:           clientIP(r),
	}); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "audit write failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": agentID, "status": "updated"})
}

func (server *Server) handleDeleteAgent(w http.ResponseWriter, r *http.Request) {
	agent, ok := server.ownedAgent(w, r)
	if !ok {
		return
	}
	identity := auth.FromContext(r.Context())

	if err := server.store.DeleteAgent(agent.ID); err != nil {
		slog.Error("delete agent", "agent", agent.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	server.notifyAgentsChanged(agent.UserID, "delete", agent.ID)
	if err := server.repo.RecordAudit(r.Context(), model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "agent.delete",
		ResourceType: "agent",
		ResourceID:   agent.ID,
		IP:           clientIP(r),
	}); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "audit write failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": agent.ID, "status": "deleted"})
}

// handleRestartAgent asks the supervisor to respawn a running agent's process.
func (server *Server) handleRestartAgent(w http.ResponseWriter, r *http.Request) {
	agent, ok := server.ownedAgent(w, r)
	if !ok {
		return
	}
	identity := auth.FromContext(r.Context())

	server.notifyAgentsChanged(agent.UserID, "restart", agent.ID)
	if err := server.repo.RecordAudit(r.Context(), model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "agent.restart",
		ResourceType: "agent",
		ResourceID:   agent.ID,
		IP:           clientIP(r),
	}); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "audit write failed"})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"id": agent.ID, "status": "restarting"})
}

// handleProvisionAgent re-triggers provisioning for an agent whose container
// never came up: reset the status, enqueue a request, tell the supervisor.
func (server *Server) handleProvisionAgent(w http.ResponseWriter, r *http.Request) {
	agent, ok := server.ownedAgent(w, r)
	if !ok {
		return
	}
	identity := auth.FromContext(r.Context())

	if agent.Status == "deleted" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "agent is deleted; restore it to start it again"})
		return
	}

	if err := server.store.SetAgentStatus(agent.ID, "provisioning"); err != nil {
		slog.Error("set agent status", "agent_id", agent.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if err := server.enqueueContainer(agent.UserID, agent.ID); err != nil {
		slog.Warn("ensure container request on retry", "agent_id", agent.ID, "error", err)
	}
	server.notifyAgentsChanged(agent.UserID, "provision", agent.ID)

	if err := server.repo.RecordAudit(r.Context(), model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "agent.provision",
		ResourceType: "agent",
		ResourceID:   agent.ID,
		IP:           clientIP(r),
	}); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "audit write failed"})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"id": agent.ID, "status": "provisioning"})
}

// handleRestoreAgent brings a deleted agent back to provisioning.
func (server *Server) handleRestoreAgent(w http.ResponseWriter, r *http.Request) {
	agent, ok := server.ownedAgent(w, r)
	if !ok {
		return
	}
	identity := auth.FromContext(r.Context())

	if err := server.store.RestoreAgent(agent.ID); err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	if err := server.enqueueContainer(agent.UserID, agent.ID); err != nil {
		slog.Warn("ensure container request on restore", "agent_id", agent.ID, "error", err)
	}
	server.notifyAgentsChanged(agent.UserID, "restore", agent.ID)

	if err := server.repo.RecordAudit(r.Context(), model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "agent.restore",
		ResourceType: "agent",
		ResourceID:   agent.ID,
		IP:           clientIP(r),
	}); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "audit write failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": agent.ID, "status": "provisioning"})
}

// ownedAgent resolves the agent named by the path and enforces ownership. It
// writes the failure response itself, so callers only branch on ok.
func (server *Server) ownedAgent(w http.ResponseWriter, r *http.Request) (*store.AgentRecord, bool) {
	agentID := r.PathValue("agentID")
	agent, err := server.store.GetAgent(agentID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return nil, false
	}
	if agent == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
		return nil, false
	}
	identity := auth.FromContext(r.Context())
	if !identity.CanManageUsers() && agent.UserID != identity.UserID {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not the agent owner"})
		return nil, false
	}
	return agent, true
}

// enqueueContainer asks the bus to enqueue a provisioning request. The queue
// still belongs to the bus (its poller serves it), so the portal asks rather
// than writing another service's collection.
func (server *Server) enqueueContainer(userID, agentID string) error {
	body := map[string]string{"user_id": userID, "agent_id": agentID}
	return server.callBusInternal(http.MethodPost, "/api/v1/internal/container-requests", body)
}

// notifyAgentsChanged asks the bus to broadcast an agents_changed event, which
// is what the supervisors listen to (create/delete/restore reconcile, restart
// respawns).
func (server *Server) notifyAgentsChanged(userID, action, agentID string) {
	body := map[string]string{"user_id": userID, "action": action, "agent_id": agentID}
	if err := server.callBusInternal(http.MethodPost, "/api/v1/internal/agents-changed", body); err != nil {
		slog.Warn("notify agents changed", "action", action, "agent_id", agentID, "error", err)
	}
}

// notifyAgentSettingsChanged asks the bus to broadcast a config_changed event
// for one agent, so a running process re-reads its record between turns.
func (server *Server) notifyAgentSettingsChanged(agentID string) {
	body := map[string]string{"agent_id": agentID}
	if err := server.callBusInternal(http.MethodPost, "/api/v1/internal/agents-settings-changed", body); err != nil {
		slog.Warn("notify agent settings changed", "agent_id", agentID, "error", err)
	}
}

// agentOwner resolves the user ID that owns an agent, from this service's own
// store now that the agent rows live here.
func (server *Server) agentOwner(w http.ResponseWriter, r *http.Request, agentID string) (string, bool) {
	agent, err := server.store.GetAgent(agentID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "agent lookup failed"})
		return "", false
	}
	if agent == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
		return "", false
	}
	return agent.UserID, true
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

func shortID(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "0000"
	}
	return hex.EncodeToString(buf)
}

// handleUserAgents lists another account's agents for the console. Operators
// only: the admin route that reaches it is section-gated.
func (server *Server) handleUserAgents(w http.ResponseWriter, r *http.Request) {
	server.listAgentsForUser(w, r, r.PathValue("userID"))
}
