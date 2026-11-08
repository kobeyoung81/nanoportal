package api

import (
	"net/http"
	"net/url"

	"gitee.com/kobeyoung81/nanoportal/server/internal/auth"
)

// The account's language choice: the user-level half of the two-level setting.
// The platform default lives in the config items; this is only the override.
//
// The user id comes from the verified identity, never from the request — the bus
// endpoint takes it as a query parameter and trusts its caller.

func (server *Server) handleMyPreferences(w http.ResponseWriter, r *http.Request) {
	identity := auth.FromContext(r.Context())
	if identity.UserID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	target := server.busURL() + "/api/v1/user/preferences?user_id=" + url.QueryEscape(identity.UserID)
	server.proxy.forwardGET(w, r, target, nil)
}

func (server *Server) handleMyPreferencesSave(w http.ResponseWriter, r *http.Request) {
	identity := auth.FromContext(r.Context())
	if identity.UserID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var body map[string]any
	if err := readJSONBody(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	body["user_id"] = identity.UserID
	_ = server.proxy.forwardJSON(w, r, server.busURL()+"/api/v1/user/preferences", body)
}
