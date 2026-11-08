package api

import (
	"encoding/json"
	"net/http"
	"net/url"

	"gitee.com/kobeyoung81/nanoportal/server/internal/auth"
	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
)

// agentGroupRequest mirrors the bus payload. UserID is always overwritten from
// the verified identity: a caller cannot manage another account's groups by
// putting a different id in the body.
type agentGroupRequest struct {
	UserID string `json:"user_id"`
	Name   string `json:"name"`
}

type reorderAgentGroupsRequest struct {
	UserID string   `json:"user_id"`
	IDs    []string `json:"ids"`
}

// arrangeAgentGroupsRequest is the sidebar's order: each group with its agents
// in display order, plus the ungrouped tail.
type arrangeAgentGroupsRequest struct {
	UserID string `json:"user_id"`
	Groups []struct {
		ID     string   `json:"id"`
		Agents []string `json:"agents"`
	} `json:"groups"`
	Ungrouped []string `json:"ungrouped"`
}

// handleListAgentGroups forwards the caller's own groups. The bus returns
// `{groups: [...]}`; the portal passes that envelope through as-is.
func (server *Server) handleListAgentGroups(w http.ResponseWriter, r *http.Request) {
	identity := auth.FromContext(r.Context())
	target := server.busURL() + "/api/v1/agent-groups?user_id=" + url.QueryEscape(identity.UserID)
	server.proxy.forwardGET(w, r, target, nil)
}

func (server *Server) handleCreateAgentGroup(w http.ResponseWriter, r *http.Request) {
	var req agentGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	identity := auth.FromContext(r.Context())
	req.UserID = identity.UserID

	target := server.busURL() + "/api/v1/agent-groups"
	if err := server.proxy.forwardPOSTJSON(w, r, target, req); err != nil {
		return
	}
	if err := server.repo.RecordAudit(r.Context(), model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "agent_group.create",
		ResourceType: "agent_group",
		Detail:       map[string]any{"name": req.Name},
		IP:           clientIP(r),
	}); err != nil {
		return
	}
}

func (server *Server) handleRenameAgentGroup(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("groupID")
	var req agentGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	identity := auth.FromContext(r.Context())
	req.UserID = identity.UserID

	target := server.busURL() + "/api/v1/agent-groups/" + url.PathEscape(groupID)
	if err := server.proxy.forwardJSON(w, r, target, req); err != nil {
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
		return
	}
}

func (server *Server) handleDeleteAgentGroup(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("groupID")
	identity := auth.FromContext(r.Context())

	target := server.busURL() + "/api/v1/agent-groups/" + url.PathEscape(groupID) +
		"?user_id=" + url.QueryEscape(identity.UserID)
	if err := server.proxy.forwardDELETE(w, r, target); err != nil {
		return
	}
	if err := server.repo.RecordAudit(r.Context(), model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "agent_group.delete",
		ResourceType: "agent_group",
		ResourceID:   groupID,
		IP:           clientIP(r),
	}); err != nil {
		return
	}
}

// handleArrangeAgentGroups forwards the sidebar order. One request covers a drag
// across groups, so the browser does not have to sequence a move and a reorder.
func (server *Server) handleArrangeAgentGroups(w http.ResponseWriter, r *http.Request) {
	var req arrangeAgentGroupsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	identity := auth.FromContext(r.Context())
	req.UserID = identity.UserID

	target := server.busURL() + "/api/v1/agent-groups/arrange"
	if err := server.proxy.forwardPOSTJSON(w, r, target, req); err != nil {
		return
	}
	if err := server.repo.RecordAudit(r.Context(), model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       "agent_group.arrange",
		ResourceType: "agent_group",
		Detail:       map[string]any{"groups": len(req.Groups), "ungrouped": len(req.Ungrouped)},
		IP:           clientIP(r),
	}); err != nil {
		return
	}
}

func (server *Server) handleReorderAgentGroups(w http.ResponseWriter, r *http.Request) {
	var req reorderAgentGroupsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	identity := auth.FromContext(r.Context())
	req.UserID = identity.UserID

	target := server.busURL() + "/api/v1/agent-groups/reorder"
	if err := server.proxy.forwardPOSTJSON(w, r, target, req); err != nil {
		return
	}
}
