package api_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gitee.com/kobeyoung81/nanoportal/server/internal/api"
)

// TestDirectoryConsoleCarriesTheCallersToken pins the second half of the
// directory console's guard: the portal gates the section, and nanoauth verifies
// the same token again. If the portal stopped forwarding it, a direct call to the
// auth service and a call through the portal would no longer be held to the same
// rule.
func TestDirectoryConsoleCarriesTheCallersToken(t *testing.T) {
	var (
		seenAuth   string
		seenPath   string
		seenBody   string
		seenMethod string
	)
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenAuth = r.Header.Get("Authorization")
		seenPath = r.URL.Path
		seenMethod = r.Method
		body := make([]byte, r.ContentLength)
		if r.ContentLength > 0 {
			_, _ = r.Body.Read(body)
		}
		seenBody = string(body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"steps":[],"kind":"ad","preset":{"kind":"ad"}}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "admin", api.Backends{BusURL: bus.URL})

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/directory/test", strings.NewReader(`{"settings":{"url":"ldap://dir"}}`))
	req.Header.Set("Authorization", "Bearer "+env.token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	env.handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if seenMethod != http.MethodPost {
		t.Fatalf("upstream method = %q, want POST", seenMethod)
	}
	if seenPath != "/auth/v1/directory/test" {
		t.Fatalf("upstream path = %q", seenPath)
	}
	if seenAuth != "Bearer "+env.token {
		t.Fatalf("upstream Authorization = %q, want the caller's token", seenAuth)
	}
	if !strings.Contains(seenBody, "ldap://dir") {
		t.Fatalf("the draft settings must reach the auth service, got %q", seenBody)
	}
}

// The console lives in the management section: a support account cannot reach it
// even though it may manage users.
func TestDirectoryConsoleRequiresTheManagementSection(t *testing.T) {
	hits := 0
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.WriteHeader(http.StatusOK)
	}))
	defer bus.Close()

	for _, tc := range []struct {
		role string
		want int
	}{
		{"admin", http.StatusOK},
		{"operator", http.StatusOK},
		{"support", http.StatusForbidden},
		{"auditor", http.StatusForbidden},
	} {
		t.Run(tc.role, func(t *testing.T) {
			hits = 0
			env := newTestEnv(t, tc.role, api.Backends{BusURL: bus.URL})
			req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/directory/effective", nil)
			req.Header.Set("Authorization", "Bearer "+env.token)
			rec := httptest.NewRecorder()
			env.handler.ServeHTTP(rec, req)

			if rec.Code != tc.want {
				t.Fatalf("role %s: status = %d, want %d", tc.role, rec.Code, tc.want)
			}
			if tc.want == http.StatusForbidden && hits != 0 {
				t.Fatalf("role %s reached the upstream %d time(s)", tc.role, hits)
			}
		})
	}
}

// Only the known diagnostics are proxied: an unknown operation is answered
// locally and never reaches the auth service.
func TestDirectoryConsoleRejectsAnUnknownOperation(t *testing.T) {
	hits := 0
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.WriteHeader(http.StatusOK)
	}))
	defer bus.Close()

	env := newTestEnv(t, "admin", api.Backends{BusURL: bus.URL})

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/directory/wipe", strings.NewReader(`{}`))
	req.Header.Set("Authorization", "Bearer "+env.token)
	rec := httptest.NewRecorder()
	env.handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (%s)", rec.Code, rec.Body.String())
	}
	if hits != 0 {
		t.Fatalf("an unknown operation must not reach the auth service (%d call(s))", hits)
	}
}

// The auth service's stable code travels with its message, so the page can word
// the failure itself.
func TestDirectoryConsolePassesTheUpstreamCodeThrough(t *testing.T) {
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":"directory unavailable","code":"directory_unavailable"}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "admin", api.Backends{BusURL: bus.URL})

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/directory/effective", nil)
	req.Header.Set("Authorization", "Bearer "+env.token)
	rec := httptest.NewRecorder()
	env.handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 (%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"code":"directory_unavailable"`) {
		t.Fatalf("the code must survive the proxy: %s", rec.Body.String())
	}
}

// A 401 or 403 from the auth service must not reach the browser as a 401: the
// console's diagnostics go through this same proxy, and the browser's global
// handler reads any 401 as "your session is over" — it clears the session and
// sends the operator to the login page. One rejected diagnostic call used to
// log them out of the portal entirely.
func TestDirectoryConsoleTurnsUpstreamDenialsIntoABadGateway(t *testing.T) {
	for _, upstream := range []int{http.StatusUnauthorized, http.StatusForbidden} {
		t.Run(http.StatusText(upstream), func(t *testing.T) {
			bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(upstream)
				_, _ = w.Write([]byte(`{"error":"invalid token"}`))
			}))
			defer bus.Close()

			env := newTestEnv(t, "admin", api.Backends{BusURL: bus.URL})

			req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/directory/effective", nil)
			req.Header.Set("Authorization", "Bearer "+env.token)
			rec := httptest.NewRecorder()
			env.handler.ServeHTTP(rec, req)

			if rec.Code == http.StatusUnauthorized {
				t.Fatal("a 401 reached the browser: the global session handler would log the operator out")
			}
			if rec.Code != http.StatusBadGateway {
				t.Fatalf("status = %d, want 502 (%s)", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), `"code":"directory_upstream_denied"`) {
				t.Fatalf("the console needs a code it can word itself: %s", rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), "invalid token") {
				t.Fatalf("the upstream's own words must survive: %s", rec.Body.String())
			}
		})
	}
}
