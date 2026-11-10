package api_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gitee.com/kobeyoung81/nanoportal/server/internal/api"
	"gitee.com/kobeyoung81/nanoportal/server/internal/store"
)

// seedRecord adds one stored conversation to the fake projection.
func seedRecord(env *testEnv, rec store.SessionRecord) store.SessionRecord {
	if rec.Status == "" {
		rec.Status = "active"
	}
	if rec.Messages == "" {
		rec.Messages = "[]"
	}
	if rec.UpdatedAt.IsZero() {
		rec.UpdatedAt = time.Unix(1700000000, 0).UTC()
	}
	if rec.CreatedAt.IsZero() {
		rec.CreatedAt = rec.UpdatedAt
	}
	env.store.records[rec.ID] = &rec
	return rec
}

// The ETag round trip stays intact now that the read is local: an unchanged
// conversation answers 304 with its validator and no body, so a reload costs one
// conditional request and never touches the messages blob.
func TestSessionConditionalReadAnswersNotModified(t *testing.T) {
	env := newTestEnv(t, "support", api.Backends{})
	rec := seedRecord(env, store.SessionRecord{
		ID: "web:chat-1", AgentID: "agent-1", AccountID: "alice",
		MessageCount: 2, MessagesBytes: 42,
		Messages: `[{"role":"user","content":"hi"}]`,
	})

	etag := `W/"2-42-1700000000"`
	if rec.MessageCount != 2 || rec.MessagesBytes != 42 {
		t.Fatalf("seed drifted: %+v", rec)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/user/v1/sessions/web:chat-1?limit=30", nil)
	req.Header.Set("Authorization", "Bearer "+env.token)
	req.Header.Set("If-None-Match", etag)
	recorder := httptest.NewRecorder()
	env.handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusNotModified {
		t.Fatalf("status = %d, want 304 (%s)", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("ETag"); got != etag {
		t.Fatalf("ETag = %q, want %q", got, etag)
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("304 must not carry a body, got %q", recorder.Body.String())
	}
}

// The caching contract is the service's own decision now: storable by the
// browser, but only after revalidation.
func TestSessionReadCarriesTheFreshnessContract(t *testing.T) {
	env := newTestEnv(t, "support", api.Backends{})
	seedRecord(env, store.SessionRecord{
		ID: "web:chat-1", AgentID: "agent-1", AccountID: "someone-else",
		Messages: `[{"role":"user","content":"hi"}]`,
	})

	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/sessions/web:chat-1?limit=30", "", env.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "private, no-cache" {
		t.Fatalf("Cache-Control = %q", got)
	}
	if got := rec.Header().Get("ETag"); got == "" {
		t.Fatal("expected a validator")
	}
}

// Ownership: a plain user only reads their own conversations, a manager reads
// anyone's, and a missing conversation is a 404 rather than a failed probe.
func TestSessionAccessControl(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	seedRecord(env, store.SessionRecord{
		ID: "web:c1", AgentID: "agent-1", AccountID: "someone-else",
		Messages: `[]`,
	})

	aliceToken := mintToken(t, env.key, testKid, "alice", "user")
	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/sessions/web:c1?limit=30", "", aliceToken)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("foreign session: status = %d, want 403 (%s)", rec.Code, rec.Body.String())
	}

	supportToken := mintToken(t, env.key, testKid, "alice", "support")
	rec = doRequest(t, env.handler, http.MethodGet, "/api/user/v1/sessions/web:c1?limit=30", "", supportToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("manager read: status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}

	missingToken := mintToken(t, env.key, testKid, "alice", "admin")
	rec = doRequest(t, env.handler, http.MethodGet, "/api/user/v1/sessions/web:missing", "", missingToken)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing session: status = %d, want 404 (%s)", rec.Code, rec.Body.String())
	}
}

// The owner's own read is a metadata-only read: the history blob must not be
// loaded, which is what makes the resume check cheap.
func TestSessionMetaReadOmitsTheMessages(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	seedRecord(env, store.SessionRecord{
		ID: "web:c1", AgentID: "agent-1", AccountID: "test-admin",
		Messages: `[{"role":"user","content":"a very long history"}]`, MessageCount: 1,
		MessagesBytes: 40,
	})

	rec := doRequest(t, env.handler, http.MethodGet, "/api/user/v1/sessions/web:c1?meta=1", "", env.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "very long history") {
		t.Fatalf("meta read returned the messages: %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"message_count":1`) {
		t.Fatalf("meta read lost its counters: %s", rec.Body.String())
	}
}
