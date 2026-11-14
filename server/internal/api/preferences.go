package api

import (
	"net/http"
	"net/url"

	"gitee.com/kobeyoung81/nanoportal/server/internal/auth"
	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
)

// The account's language choice: the user-level half of the two-level setting.
// The platform default and the row are both nanoauth's now, so this asks it
// directly — the bus used to forward these calls straight back to it.
//
// The user id comes from the verified identity, never from the request.

func (server *Server) handleMyPreferences(w http.ResponseWriter, r *http.Request) {
	identity := auth.FromContext(r.Context())
	if identity.UserID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	target := server.authURL() + "/internal/v1/users/" + url.PathEscape(identity.UserID) + "/preferences"
	server.proxy.forwardGET(w, r, target, nil)
}

func (server *Server) handleMyPreferencesSave(w http.ResponseWriter, r *http.Request) {
	identity := auth.FromContext(r.Context())
	if identity.UserID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var body struct {
		Language string `json:"language"`
	}
	if err := readJSONBody(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	target := server.authURL() + "/internal/v1/users/" + url.PathEscape(identity.UserID) + "/preferences"
	status, payload, err := server.proxy.doJSON(r, http.MethodPut, target, map[string]string{"language": body.Language})
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	if status == http.StatusOK {
		// The audit entry belongs to the actor's entry point: this is where the
		// caller's role and address are known, and the identity module only stores
		// the row.
		server.recordAudit(r, model.AuditEntry{
			ActorID:      identity.UserID,
			ActorRole:    identity.Role,
			Action:       "user.preferences.language",
			ResourceType: "user",
			ResourceID:   identity.UserID,
			Detail:       map[string]any{"language": body.Language},
		})
	}
	writeUpstream(w, status, payload)
}
