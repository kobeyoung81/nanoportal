package auth

import (
	"context"
	"net/http"
	"strings"
)

// Role constants mirror the platform RBAC model.
const (
	RoleAdmin    = "admin"
	RoleOperator = "operator"
	RoleSupport  = "support"
	RoleAuditor  = "auditor"
	RoleUser     = "user"
)

var roleRank = map[string]int{
	RoleAdmin:    100,
	RoleOperator: 80,
	RoleSupport:  60,
	RoleAuditor:  40,
	RoleUser:     20,
}

var validRoles = map[string]struct{}{
	RoleAdmin:    {},
	RoleOperator: {},
	RoleSupport:  {},
	RoleAuditor:  {},
	RoleUser:     {},
}

// Identity is the authenticated admin principal.
type Identity struct {
	UserID      string `json:"user_id"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
}

// Validate checks that the identity has a known role and user.
func (i Identity) Validate() error {
	if _, ok := validRoles[i.Role]; !ok {
		return &roleError{role: i.Role}
	}
	if i.UserID == "" {
		i.UserID = "anonymous"
	}
	return nil
}

// IsAtLeast reports whether the identity's role ranks at or above minRole.
func (i Identity) IsAtLeast(minRole string) bool {
	return roleRank[i.Role] >= roleRank[minRole]
}

// CanManageUsers reports whether the identity may act on other users' resources
// (the Operations section: Users, their containers, agents and storage). This
// is deliberately not rank-based: Operations is RoleSupport while DevOps is
// RoleOperator, and only Operations (plus admin) owns user management.
func (i Identity) CanManageUsers() bool {
	return i.Role == RoleAdmin || i.Role == RoleSupport
}

type roleError struct{ role string }

func (e *roleError) Error() string { return "invalid admin role: " + e.role }

type contextKey string

const identityKey contextKey = "admin-identity"

// Authorizer validates admin identity headers against the role model.
type Authorizer struct {
	defaultUser string
	defaultRole string
}

// NewAuthorizer creates an Authorizer with fallback credentials for the
// no-header (development) case.
func NewAuthorizer(defaultUser, defaultRole string) *Authorizer {
	return &Authorizer{defaultUser: defaultUser, defaultRole: defaultRole}
}

// JWTAuth authenticates requests via a nanoauth-issued Bearer JWT.
type JWTAuth struct {
	validator *JWKSValidator
}

// NewJWTAuth creates a JWT bearer authenticator backed by the given validator.
func NewJWTAuth(validator *JWKSValidator) *JWTAuth {
	return &JWTAuth{validator: validator}
}

// Middleware resolves the identity from a Bearer JWT and injects it into the
// request context. Requests without a valid token are rejected with 401.
func (a *JWTAuth) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
		if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
			http.Error(w, "missing authorization token", http.StatusUnauthorized)
			return
		}

		claims, err := a.validator.ValidateToken(strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer ")))
		if err != nil {
			http.Error(w, "invalid authorization token", http.StatusUnauthorized)
			return
		}

		userID, _ := claims["sub"].(string)
		if userID == "" {
			http.Error(w, "invalid authorization token", http.StatusUnauthorized)
			return
		}
		role, _ := claims["role"].(string)
		if role == "" {
			role = RoleUser
		}

		identity := Identity{UserID: userID, Role: role}
		if err := identity.Validate(); err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		identity.DisplayName, _ = claims["display_name"].(string)
		if identity.DisplayName == "" {
			identity.DisplayName = humanizeUserID(identity.UserID)
		}

		ctx := context.WithValue(r.Context(), identityKey, identity)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Middleware resolves the admin identity from request headers and injects it
// into the context.
func (a *Authorizer) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID := strings.TrimSpace(r.Header.Get("X-Admin-User"))
		role := strings.TrimSpace(r.Header.Get("X-Admin-Role"))

		if userID == "" {
			userID = a.defaultUser
		}
		if role == "" {
			role = a.defaultRole
		}

		identity := Identity{UserID: userID, Role: role}
		if err := identity.Validate(); err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		identity.DisplayName = humanizeUserID(identity.UserID)

		ctx := context.WithValue(r.Context(), identityKey, identity)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireRole returns a middleware that rejects requests whose identity role
// is below the required role in rank.
func RequireRole(minRole string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			identity := FromContext(r.Context())
			if roleRank[identity.Role] < roleRank[minRole] {
				http.Error(w, "insufficient role: "+identity.Role, http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Admin console sections. Section membership is explicit rather than rank-based
// because the roles are not strictly linear: Operations (support) ranks below
// DevOps (operator) yet owns a different section.
const (
	SectionOverview   = "overview"
	SectionOperations = "operations"
	SectionManagement = "management"
	SectionAudit      = "audit"
	SectionMessages   = "messages"
)

// SectionRoles maps each admin section to the roles allowed to access it.
var SectionRoles = map[string][]string{
	SectionOverview:   {RoleAdmin, RoleOperator, RoleSupport, RoleAuditor},
	SectionOperations: {RoleAdmin, RoleSupport},
	SectionManagement: {RoleAdmin, RoleOperator},
	SectionAudit:      {RoleAdmin, RoleAuditor},
	SectionMessages:   {RoleAdmin, RoleOperator},
}

// RequireSection returns a middleware that admits only the roles assigned to
// the given admin section.
func RequireSection(section string) func(http.Handler) http.Handler {
	return RequireAnyRole(SectionRoles[section]...)
}

// RequireAnyRole returns a middleware that admits only the listed roles.
func RequireAnyRole(roles ...string) func(http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(roles))
	for _, role := range roles {
		allowed[role] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			identity := FromContext(r.Context())
			if _, ok := allowed[identity.Role]; !ok {
				http.Error(w, "insufficient role: "+identity.Role, http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireOwnership returns a middleware that ensures the caller either holds
// admin or is the owner of the resource identified by the given path parameter.
func RequireOwnership(pathParam string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			identity := FromContext(r.Context())
			resourceOwner := r.PathValue(pathParam)
			if identity.Role != RoleAdmin && identity.UserID != resourceOwner {
				http.Error(w, "not the resource owner", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// FromContext returns the identity stored in the request context.
func FromContext(ctx context.Context) Identity {
	if identity, ok := ctx.Value(identityKey).(Identity); ok {
		return identity
	}
	return Identity{UserID: "unknown", DisplayName: "Unknown", Role: RoleAuditor}
}

func humanizeUserID(userID string) string {
	parts := strings.FieldsFunc(userID, func(r rune) bool {
		return r == '-' || r == '_' || r == '.'
	})
	for i, part := range parts {
		if len(part) == 0 {
			continue
		}
		parts[i] = strings.ToUpper(part[:1]) + part[1:]
	}
	if len(parts) == 0 {
		return "Portal Admin"
	}
	return strings.Join(parts, " ")
}
