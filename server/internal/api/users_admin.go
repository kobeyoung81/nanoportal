package api

import (
	"crypto/rand"
	"encoding/json"
	"math/big"
	"net/http"

	"golang.org/x/crypto/bcrypt"

	"gitee.com/kobeyoung81/nanoportal/server/internal/auth"
	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
)

var validUserRoles = map[string]struct{}{
	auth.RoleAdmin:    {},
	auth.RoleOperator: {},
	auth.RoleSupport:  {},
	auth.RoleAuditor:  {},
	auth.RoleUser:     {},
}

var validUserTiers = map[string]struct{}{"free": {}, "pro": {}, "ultra": {}}

// loadUserForManagement resolves the target user and applies the Operations
// rule that non-admin operators may not touch administrator accounts. On
// failure the response is already written and ok is false.
func (server *Server) loadUserForManagement(w http.ResponseWriter, r *http.Request) (*model.UserDetail, bool) {
	user, err := server.repo.GetUser(r.Context(), r.PathValue("userID"))
	if err != nil {
		writeError(w, err)
		return nil, false
	}
	identity := auth.FromContext(r.Context())
	if user.Role == auth.RoleAdmin && identity.Role != auth.RoleAdmin {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "operations may not manage administrator accounts"})
		return nil, false
	}
	return &user, true
}

// rejectSelfMutation blocks acting on the caller's own account for destructive
// user-management actions.
func rejectSelfMutation(w http.ResponseWriter, r *http.Request, targetUserID string) bool {
	if auth.FromContext(r.Context()).UserID == targetUserID {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "you cannot perform this action on your own account"})
		return true
	}
	return false
}

// rejectDirectoryAccount blocks local password management for accounts that sign
// in through the LDAP directory: their platform password is not what they use,
// and writing one would create a second, working credential for the account.
func (server *Server) rejectDirectoryAccount(w http.ResponseWriter, r *http.Request, userID string) bool {
	isDirectory, err := server.repo.IsDirectoryAccount(r.Context(), userID)
	if err != nil {
		writeError(w, err)
		return true
	}
	if isDirectory {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "account is managed by the directory"})
		return true
	}
	return false
}

// recordUserAudit reports one account change. It never fails the request: the
// change has already been applied, and the trail is an operation log, not a gate
// (see recordAudit in audit.go).
func (server *Server) recordUserAudit(r *http.Request, action, userID string, detail map[string]any) {
	identity := auth.FromContext(r.Context())
	server.recordAudit(r, model.AuditEntry{
		ActorID:      identity.UserID,
		ActorRole:    identity.Role,
		Action:       action,
		ResourceType: "user",
		ResourceID:   userID,
		Detail:       detail,
		IP:           clientIP(r),
	})
}

func (server *Server) handleUpdateUserRole(w http.ResponseWriter, r *http.Request) {
	user, ok := server.loadUserForManagement(w, r)
	if !ok {
		return
	}

	var body struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Role == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "role is required"})
		return
	}
	if _, valid := validUserRoles[body.Role]; !valid {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid role"})
		return
	}

	identity := auth.FromContext(r.Context())
	if body.Role == auth.RoleAdmin && identity.Role != auth.RoleAdmin {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "only admins may grant the admin role"})
		return
	}
	if rejectSelfMutation(w, r, user.UserID) {
		return
	}
	if user.Role == auth.RoleAdmin && body.Role != auth.RoleAdmin {
		admins, err := server.repo.CountActiveAdmins(r.Context())
		if err != nil {
			writeError(w, err)
			return
		}
		if admins <= 1 {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "cannot remove the last administrator"})
			return
		}
	}

	if err := server.repo.UpdateUserRole(r.Context(), user.UserID, body.Role); err != nil {
		writeError(w, err)
		return
	}
	server.recordUserAudit(r, "user.role.change", user.UserID, map[string]any{"from": user.Role, "to": body.Role})
	writeJSON(w, http.StatusOK, map[string]any{"user_id": user.UserID, "role": body.Role})
}

func (server *Server) setUserStatus(w http.ResponseWriter, r *http.Request, status, action string) {
	user, ok := server.loadUserForManagement(w, r)
	if !ok {
		return
	}
	if rejectSelfMutation(w, r, user.UserID) {
		return
	}
	if status == "deleted" && user.Role == auth.RoleAdmin {
		admins, err := server.repo.CountActiveAdmins(r.Context())
		if err != nil {
			writeError(w, err)
			return
		}
		if admins <= 1 {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "cannot delete the last administrator"})
			return
		}
	}
	if err := server.repo.UpdateUserStatus(r.Context(), user.UserID, status); err != nil {
		writeError(w, err)
		return
	}
	server.recordUserAudit(r, action, user.UserID, map[string]any{"from": user.Status, "to": status})
	writeJSON(w, http.StatusOK, map[string]any{"user_id": user.UserID, "status": status})
}

func (server *Server) handleFreezeUser(w http.ResponseWriter, r *http.Request) {
	server.setUserStatus(w, r, "suspended", "user.freeze")
}

func (server *Server) handleUnfreezeUser(w http.ResponseWriter, r *http.Request) {
	server.setUserStatus(w, r, "active", "user.unfreeze")
}

func (server *Server) handleRestoreUser(w http.ResponseWriter, r *http.Request) {
	server.setUserStatus(w, r, "active", "user.restore")
}

func (server *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	server.setUserStatus(w, r, "deleted", "user.delete")
}

func (server *Server) handleUpdateUserTier(w http.ResponseWriter, r *http.Request) {
	user, ok := server.loadUserForManagement(w, r)
	if !ok {
		return
	}

	var body struct {
		Tier string `json:"tier"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Tier == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tier is required"})
		return
	}
	if _, valid := validUserTiers[body.Tier]; !valid {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid tier"})
		return
	}
	if rejectSelfMutation(w, r, user.UserID) {
		return
	}

	if err := server.repo.UpdateUserTier(r.Context(), user.UserID, body.Tier); err != nil {
		writeError(w, err)
		return
	}
	server.recordUserAudit(r, "user.tier.change", user.UserID, map[string]any{"from": user.Tier, "to": body.Tier})
	writeJSON(w, http.StatusOK, map[string]any{"user_id": user.UserID, "tier": body.Tier})
}

const tempPasswordCharset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

func generateTempPassword(length int) (string, error) {
	out := make([]byte, length)
	max := big.NewInt(int64(len(tempPasswordCharset)))
	for i := range out {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		out[i] = tempPasswordCharset[n.Int64()]
	}
	return string(out), nil
}

func (server *Server) handleResetUserPassword(w http.ResponseWriter, r *http.Request) {
	user, ok := server.loadUserForManagement(w, r)
	if !ok {
		return
	}
	if server.rejectDirectoryAccount(w, r, user.UserID) {
		return
	}
	if rejectSelfMutation(w, r, user.UserID) {
		return
	}

	tempPassword, err := generateTempPassword(12)
	if err != nil {
		writeError(w, err)
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(tempPassword), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, err)
		return
	}
	if err := server.repo.SetUserPassword(r.Context(), user.UserID, string(hash), true); err != nil {
		writeError(w, err)
		return
	}
	server.recordUserAudit(r, "user.password.reset", user.UserID, nil)
	writeJSON(w, http.StatusOK, map[string]any{"user_id": user.UserID, "temp_password": tempPassword})
}

// handleChangeMyPassword lets a signed-in user rotate their own password. It
// also clears the forced-change flag set by an admin password reset.
func (server *Server) handleChangeMyPassword(w http.ResponseWriter, r *http.Request) {
	identity := auth.FromContext(r.Context())
	var body struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if len(body.NewPassword) < 8 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "new password must be at least 8 characters"})
		return
	}

	if server.rejectDirectoryAccount(w, r, identity.UserID) {
		return
	}

	hash, err := server.repo.GetUserPasswordHash(r.Context(), identity.UserID)
	if err != nil {
		writeError(w, err)
		return
	}
	if hash == "" || bcrypt.CompareHashAndPassword([]byte(hash), []byte(body.CurrentPassword)) != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "current password is incorrect"})
		return
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(body.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, err)
		return
	}
	if err := server.repo.SetUserPassword(r.Context(), identity.UserID, string(newHash), false); err != nil {
		writeError(w, err)
		return
	}
	server.recordUserAudit(r, "user.password.change", identity.UserID, nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
