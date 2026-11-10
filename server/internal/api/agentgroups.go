package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"gitee.com/kobeyoung81/nanoportal/server/internal/auth"
	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
	"gitee.com/kobeyoung81/nanoportal/server/internal/store"
)

// agentGroupPayload is the wire shape of a grouping. Position orders the groups;
// Agents is the order inside the group, which the arrange endpoint rewrites.
type agentGroupPayload struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Position int      `json:"position"`
	Agents   []string `json:"agents"`
}

type agentGroupRequest struct {
	Name string `json:"name"`
}

type reorderAgentGroupsRequest struct {
	IDs []string `json:"ids"`
}

// arrangeAgentGroupsRequest is the sidebar's order: each group with its agents
// in display order, plus the ungrouped tail. The user id comes from the verified
// identity, never from the body.
type arrangeAgentGroupsRequest struct {
	Groups []struct {
		ID     string   `json:"id"`
		Agents []string `json:"agents"`
	} `json:"groups"`
	Ungrouped []string `json:"ungrouped"`
}

// handleListAgentGroups returns the caller's own groups plus the per-group agent
// order.
func (server *Server) handleListAgentGroups(w http.ResponseWriter, r *http.Request) {
	identity := auth.FromContext(r.Context())

	groups, err := server.store.ListAgentGroups(identity.UserID)
	if err != nil {
		slog.Error("list agent groups", "user_id", identity.UserID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	order, ungrouped, err := server.store.ListAgentOrder(identity.UserID)
	if err != nil {
		slog.Error("list agent order", "user_id", identity.UserID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	out := make([]agentGroupPayload, 0, len(groups))
	for _, g := range groups {
		ids := order[g.ID]
		if ids == nil {
			ids = []string{}
		}
		out = append(out, agentGroupPayload{ID: g.ID, Name: g.Name, Position: g.Position, Agents: ids})
	}
	if ungrouped == nil {
		ungrouped = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"groups": out, "ungrouped": ungrouped, "count": len(out)})
}

func (server *Server) handleCreateAgentGroup(w http.ResponseWriter, r *http.Request) {
	var req agentGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	identity := auth.FromContext(r.Context())

	group, err := server.store.CreateAgentGroup(identity.UserID, req.Name)
	if err != nil {
		server.writeAgentGroupError(w, err, "create agent group")
		return
	}
	if err := server.repo.RecordAudit(r.Context(), model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "agent_group.create",
		ResourceType: "agent_group",
		ResourceID:   group.ID,
		Detail:       map[string]any{"name": req.Name},
		IP:           clientIP(r),
	}); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "audit write failed"})
		return
	}
	writeJSON(w, http.StatusCreated, agentGroupPayload{ID: group.ID, Name: group.Name, Position: group.Position})
}

func (server *Server) handleRenameAgentGroup(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("groupID")
	var req agentGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	identity := auth.FromContext(r.Context())

	if err := server.store.RenameAgentGroup(groupID, identity.UserID, req.Name); err != nil {
		server.writeAgentGroupError(w, err, "rename agent group")
		return
	}
	if err := server.repo.RecordAudit(r.Context(), model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "agent_group.rename",
		ResourceType: "agent_group",
		ResourceID:   groupID,
		Detail:       map[string]any{"name": req.Name},
		IP:           clientIP(r),
	}); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "audit write failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": groupID, "status": "updated"})
}

func (server *Server) handleDeleteAgentGroup(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("groupID")
	identity := auth.FromContext(r.Context())

	unassigned, err := server.store.DeleteAgentGroup(groupID, identity.UserID)
	if err != nil {
		server.writeAgentGroupError(w, err, "delete agent group")
		return
	}
	if err := server.repo.RecordAudit(r.Context(), model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "agent_group.delete",
		ResourceType: "agent_group",
		ResourceID:   groupID,
		Detail:       map[string]any{"unassigned": unassigned},
		IP:           clientIP(r),
	}); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "audit write failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": groupID, "status": "deleted", "unassigned": unassigned})
}

func (server *Server) handleReorderAgentGroups(w http.ResponseWriter, r *http.Request) {
	var req reorderAgentGroupsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	identity := auth.FromContext(r.Context())

	if err := server.store.ReorderAgentGroups(identity.UserID, req.IDs); err != nil {
		server.writeAgentGroupError(w, err, "reorder agent groups")
		return
	}
	if err := server.repo.RecordAudit(r.Context(), model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "agent_group.reorder",
		ResourceType: "agent_group",
		IP:           clientIP(r),
	}); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "audit write failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "reordered"})
}

// handleArrangeAgentGroups writes the sidebar's order: which agent belongs to
// which group and where inside it. One request covers a drag across groups.
func (server *Server) handleArrangeAgentGroups(w http.ResponseWriter, r *http.Request) {
	var req arrangeAgentGroupsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	identity := auth.FromContext(r.Context())

	groups := make(map[string][]string, len(req.Groups))
	for _, group := range req.Groups {
		if group.ID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "group id is required"})
			return
		}
		if _, ok := groups[group.ID]; ok {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "repeated group"})
			return
		}
		groups[group.ID] = group.Agents
	}

	if err := server.store.ArrangeAgents(identity.UserID, groups, req.Ungrouped); err != nil {
		server.writeAgentGroupError(w, err, "arrange agents")
		return
	}
	if err := server.repo.RecordAudit(r.Context(), model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "agent_group.arrange",
		ResourceType: "agent_group",
		Detail:       map[string]any{"groups": len(groups), "ungrouped": len(req.Ungrouped)},
		IP:           clientIP(r),
	}); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "audit write failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "arranged"})
}

// writeAgentGroupError maps the store's sentinel errors onto status codes. A
// group owned by someone else surfaces as 404 everywhere (the caller has no
// business learning that the id exists).
func (server *Server) writeAgentGroupError(w http.ResponseWriter, err error, action string) {
	switch {
	case errors.Is(err, store.ErrAgentGroupNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrAgentGroupNameTaken):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrAgentGroupLimit):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrAgentGroupNameInvalid),
		errors.Is(err, store.ErrAgentGroupOrderInvalid),
		errors.Is(err, store.ErrAgentOrderInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	default:
		slog.Error(action, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
	}
}
