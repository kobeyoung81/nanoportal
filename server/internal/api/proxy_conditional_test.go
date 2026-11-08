package api_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"gitee.com/kobeyoung81/nanoportal/server/internal/api"
)

// TestSessionConditionalReadPassesThrough pins the ETag round trip through the
// portal: the browser's If-None-Match must reach the bus and a 304 (with its
// validator) must come back untouched. Without the request-header forwarding
// the bus would re-send the whole page, and without the response-header copy
// the browser could never ask conditionally.
func TestSessionConditionalReadPassesThrough(t *testing.T) {
	const etag = `W/"12-4096-100"`

	probes := 0
	conditional := 0
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("If-None-Match") == "" {
			// Ownership probe (and the fallback path): a normal payload.
			probes++
			// The probe only needs account_id, so it must ask for metadata:
			// without this the bus reads and returns the whole messages blob,
			// which the portal then decodes and throws away.
			if got := r.URL.Query().Get("meta"); got != "1" {
				t.Errorf("ownership probe query = %q, want meta=1", r.URL.RawQuery)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"session_id":"web:chat-1","account_id":"someone-else"}`))
			return
		}
		conditional++
		if got := r.Header.Get("If-None-Match"); got != etag {
			t.Errorf("upstream saw If-None-Match = %q, want %q", got, etag)
		}
		w.Header().Set("ETag", etag)
		w.WriteHeader(http.StatusNotModified)
	}))
	defer bus.Close()

	env := newTestEnv(t, "support", api.Backends{BusURL: bus.URL})

	req := httptest.NewRequest(http.MethodGet, "/api/user/v1/sessions/web:chat-1?limit=30", nil)
	req.Header.Set("Authorization", "Bearer "+env.token)
	req.Header.Set("If-None-Match", etag)
	rec := httptest.NewRecorder()
	env.handler.ServeHTTP(rec, req)

	if conditional != 1 {
		t.Fatalf("conditional upstream calls = %d, want 1 (probes = %d)", conditional, probes)
	}
	if rec.Code != http.StatusNotModified {
		t.Fatalf("status = %d, want 304 (%s)", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("ETag"); got != etag {
		t.Fatalf("ETag = %q, want %q", got, etag)
	}
	if rec.Body.Len() != 0 {
		t.Fatalf("304 must not carry a body, got %q", rec.Body.String())
	}
}

// TestSessionFreshnessHeaderPassesThrough keeps the caching contract intact
// across the portal: the bus decides how a session response may be cached, and
// the proxy must not drop that decision.
func TestSessionFreshnessHeaderPassesThrough(t *testing.T) {
	const cacheControl = "private, no-cache"
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("ETag", `W/"1-2-3"`)
		w.Header().Set("Cache-Control", cacheControl)
		_, _ = w.Write([]byte(`{"session_id":"web:chat-1","account_id":"someone-else","messages":"[]"}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "support", api.Backends{BusURL: bus.URL})

	req := httptest.NewRequest(http.MethodGet, "/api/user/v1/sessions/web:chat-1?limit=30", nil)
	req.Header.Set("Authorization", "Bearer "+env.token)
	rec := httptest.NewRecorder()
	env.handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != cacheControl {
		t.Fatalf("Cache-Control = %q, want %q", got, cacheControl)
	}
	if got := rec.Header().Get("ETag"); got == "" {
		t.Fatal("expected the validator to pass through as well")
	}
}

// TestSessionOwnerProbeOnlyForPlainUsers pins who pays for the ownership lookup.
// A plain user must have their session checked against the account that owns it,
// and that check must be a metadata read. A manager (operator/support/admin)
// already reaches every session, so probing for them is one wasted upstream
// read — and it used to turn a missing session into a 502 instead of the bus's
// real 404.
func TestSessionOwnerProbeOnlyForPlainUsers(t *testing.T) {
	// A plain user: probe with meta=1 first, then the read the browser asked for.
	t.Run("plain user is probed with meta only", func(t *testing.T) {
		var queries []string
		counting := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			queries = append(queries, r.URL.RawQuery)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"session_id":"web:c1","account_id":"someone-else"}`))
		}))
		defer counting.Close()

		env := newTestEnv(t, "user", api.Backends{BusURL: counting.URL})
		token := mintToken(t, env.key, testKid, "alice", "user")
		rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/sessions/web:c1?limit=30", "", token)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 for a foreign session, got %d: %s", rec.Code, rec.Body.String())
		}
		if len(queries) != 1 {
			t.Fatalf("expected only the ownership probe, got queries %q", queries)
		}
		if queries[0] != "meta=1" {
			t.Fatalf("probe query = %q, want meta=1", queries[0])
		}
	})

	// A manager: no probe at all, the request goes straight through.
	t.Run("manager is not probed", func(t *testing.T) {
		var queries []string
		counting := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			queries = append(queries, r.URL.RawQuery)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"session_id":"web:c1","account_id":"someone-else"}`))
		}))
		defer counting.Close()

		env := newTestEnv(t, "support", api.Backends{BusURL: counting.URL})
		token := mintToken(t, env.key, testKid, "alice", "support")
		rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/sessions/web:c1?limit=30", "", token)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 for a manager reading a foreign session, got %d: %s", rec.Code, rec.Body.String())
		}
		if len(queries) != 1 || queries[0] != "limit=30" {
			t.Fatalf("expected the single forwarded read, got queries %q", queries)
		}
	})

	// A missing session now reports what the bus said instead of a probe failure.
	t.Run("manager sees the bus 404", func(t *testing.T) {
		missing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, `{"error":"session not found"}`, http.StatusNotFound)
		}))
		defer missing.Close()

		env := newTestEnv(t, "admin", api.Backends{BusURL: missing.URL})
		token := mintToken(t, env.key, testKid, "alice", "admin")
		rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/sessions/web:missing", "", token)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for a missing session, got %d: %s", rec.Code, rec.Body.String())
		}
	})
}
