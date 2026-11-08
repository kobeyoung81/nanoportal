package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func identityContext(identity Identity) context.Context {
	return context.WithValue(context.Background(), identityKey, identity)
}

func TestAuthorizer_ValidRole(t *testing.T) {
	authorizer := NewAuthorizer("local-admin", RoleOperator)
	handler := authorizer.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		identity := FromContext(r.Context())
		if identity.Role != RoleOperator {
			t.Errorf("role = %q, want operator", identity.Role)
		}
		if identity.UserID != "someone" {
			t.Errorf("user = %q, want someone", identity.UserID)
		}
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Admin-User", "someone")
	req.Header.Set("X-Admin-Role", "operator")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestAuthorizer_RejectsUnknownRole(t *testing.T) {
	authorizer := NewAuthorizer("local-admin", RoleOperator)
	handler := authorizer.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Admin-User", "hacker")
	req.Header.Set("X-Admin-Role", "root")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestRequireRole_EnforcesRank(t *testing.T) {
	allowed := RequireRole(RoleOperator)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	for _, tc := range []struct {
		role string
		code int
	}{
		{RoleAdmin, http.StatusOK},
		{RoleOperator, http.StatusOK},
		{RoleSupport, http.StatusForbidden},
		{RoleAuditor, http.StatusForbidden},
	} {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		ctx := identityContext(Identity{UserID: "u", Role: tc.role})
		rec := httptest.NewRecorder()
		allowed.ServeHTTP(rec, req.WithContext(ctx))
		if rec.Code != tc.code {
			t.Errorf("role %s → status %d, want %d", tc.role, rec.Code, tc.code)
		}
	}
}

func TestRequireOwnership(t *testing.T) {
	owner := RequireOwnership("userID")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/users/alice", nil)
	req.SetPathValue("userID", "alice")

	// Non-admin non-owner denied.
	ctx := identityContext(Identity{UserID: "bob", Role: RoleOperator})
	rec := httptest.NewRecorder()
	owner.ServeHTTP(rec, req.WithContext(ctx))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-owner status = %d, want 403", rec.Code)
	}

	// Owner allowed.
	ctx = identityContext(Identity{UserID: "alice", Role: RoleOperator})
	rec = httptest.NewRecorder()
	owner.ServeHTTP(rec, req.WithContext(ctx))
	if rec.Code != http.StatusOK {
		t.Fatalf("owner status = %d, want 200", rec.Code)
	}

	// Admin allowed.
	ctx = identityContext(Identity{UserID: "root", Role: RoleAdmin})
	rec = httptest.NewRecorder()
	owner.ServeHTTP(rec, req.WithContext(ctx))
	if rec.Code != http.StatusOK {
		t.Fatalf("admin status = %d, want 200", rec.Code)
	}
}

func TestCanManageUsers(t *testing.T) {
	for _, tc := range []struct {
		role string
		want bool
	}{
		{RoleAdmin, true},
		{RoleSupport, true},
		{RoleOperator, false},
		{RoleAuditor, false},
		{RoleUser, false},
	} {
		if got := (Identity{Role: tc.role}).CanManageUsers(); got != tc.want {
			t.Errorf("CanManageUsers(%s) = %v, want %v", tc.role, got, tc.want)
		}
	}
}

func TestRequireAnyRole_AdmitsListedOnly(t *testing.T) {
	handler := RequireAnyRole(RoleAdmin, RoleSupport)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	for _, tc := range []struct {
		role string
		code int
	}{
		{RoleAdmin, http.StatusOK},
		{RoleSupport, http.StatusOK},
		{RoleOperator, http.StatusForbidden},
		{RoleAuditor, http.StatusForbidden},
		{RoleUser, http.StatusForbidden},
	} {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		ctx := identityContext(Identity{UserID: "u", Role: tc.role})
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req.WithContext(ctx))
		if rec.Code != tc.code {
			t.Errorf("role %s → status %d, want %d", tc.role, rec.Code, tc.code)
		}
	}
}

func TestSectionRolesMatchNote14(t *testing.T) {
	want := map[string][]string{
		SectionOverview:   {RoleAdmin, RoleOperator, RoleSupport, RoleAuditor},
		SectionOperations: {RoleAdmin, RoleSupport},
		SectionManagement: {RoleAdmin, RoleOperator},
		SectionAudit:      {RoleAdmin, RoleAuditor},
		SectionMessages:   {RoleAdmin, RoleOperator},
	}
	for section, roles := range want {
		handler := RequireSection(section)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))
		inSection := map[string]bool{}
		for _, r := range roles {
			inSection[r] = true
		}
		for _, role := range []string{RoleAdmin, RoleOperator, RoleSupport, RoleAuditor, RoleUser} {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			ctx := identityContext(Identity{UserID: "u", Role: role})
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req.WithContext(ctx))
			wantCode := http.StatusForbidden
			if inSection[role] {
				wantCode = http.StatusOK
			}
			if rec.Code != wantCode {
				t.Errorf("section %s role %s → status %d, want %d", section, role, rec.Code, wantCode)
			}
		}
	}
}
