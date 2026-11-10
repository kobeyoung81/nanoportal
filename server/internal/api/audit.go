package api

import (
	"log/slog"
	"net/http"

	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
)

// recordAudit writes one trail entry and never fails the request.
//
// The trail is an operation log, not a gate: a user must not lose the agent they
// just created because the audit store is momentarily unavailable, which is how
// the rest of the platform has always behaved (the bus logs a warning and moves
// on). The failure is logged loudly enough to be found, with the action and the
// resource it concerned.
func (server *Server) recordAudit(r *http.Request, entry model.AuditEntry) {
	if entry.IP == "" {
		entry.IP = clientIP(r)
	}
	if err := server.repo.RecordAudit(r.Context(), entry); err != nil {
		slog.Warn("record audit failed",
			"action", entry.Action, "resource_type", entry.ResourceType,
			"resource_id", entry.ResourceID, "error", err)
	}
}
