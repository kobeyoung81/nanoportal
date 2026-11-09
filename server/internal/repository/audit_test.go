package repository

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"gitee.com/kobeyoung81/nanoportal/server/internal/bustoken"
	"gitee.com/kobeyoung81/nanoportal/server/internal/model"
)

// TestAuditClient_RoundTrip pins what the console does with the trail: read it
// with the actor's name already resolved, and append to it through the bus. Those
// two used to be the portal's own INSERT and a JOIN it phrased itself.
func TestAuditClient_RoundTrip(t *testing.T) {
	t.Setenv(bustoken.EnvVar, "test-token")

	type request struct {
		method string
		path   string
		body   string
		auth   string
	}
	var requests []request
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := readAll(r)
		requests = append(requests, request{r.Method, r.URL.String(), body, r.Header.Get("Authorization")})
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/audit":
			_, _ = w.Write([]byte(`{"entries":[{"id":7,"actor_id":"u-1","actor_name":"Ada","actor_role":"admin",` +
				`"action":"agent.delete","resource_type":"agent","resource_id":"agent-1","ip":"10.0.0.1",` +
				`"detail":{"why":"test"},"created_at":"2026-10-16T04:00:00Z"}]}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/audit":
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"status":"recorded"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	// Alert rules belong to the admin module now: a separate server proves the
	// client asks the right one, rather than only that a path works somewhere.
	var adminRequests []string
	adminSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		adminRequests = append(adminRequests, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/alert-rules":
			_, _ = w.Write([]byte(`{"rules":[{"id":3,"severity":"warning","message":"m","metric":"inbound_pending","threshold":100,"enabled":true}]}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/alert-rules":
			_, _ = w.Write([]byte(`{"status":"ok","id":9}`))
		case r.Method == http.MethodDelete && r.URL.Path == "/api/v1/alert-rules/9":
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer adminSrv.Close()

	c := newAuditClient(srv.URL, adminSrv.URL)
	ctx := context.Background()

	entries, err := c.entries(ctx, model.AuditQuery{Limit: 25, Action: "agent.delete", ResourceType: "agent"})
	if err != nil {
		t.Fatalf("entries: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected one entry, got %+v", entries)
	}
	got := entries[0]
	if got.ID != 7 || got.ActorID != "u-1" || got.ActorName != "Ada" || got.Action != "agent.delete" {
		t.Fatalf("unexpected entry: %+v", got)
	}
	// The timestamp arrives as an RFC3339 string and stays one.
	if got.CreatedAt != "2026-10-16T04:00:00Z" {
		t.Fatalf("unexpected created_at: %q", got.CreatedAt)
	}
	if got.Detail["why"] != "test" {
		t.Fatalf("detail lost: %+v", got.Detail)
	}
	// The limit and each condition travel with the request, one parameter apiece.
	if requests[0].path != "/api/v1/audit?action=agent.delete&limit=25&resource_type=agent" {
		t.Fatalf("the conditions did not travel: %s", requests[0].path)
	}

	// Recording an entry sends the fields and nothing else: the id and the time
	// belong to the bus.
	if err := c.record(ctx, model.AuditEntry{
		ActorID: "u-1", ActorRole: "admin", Action: "agent.delete", ResourceType: "agent",
		ResourceID: "agent-1", IP: "10.0.0.1", Detail: map[string]any{"why": "test"},
	}); err != nil {
		t.Fatalf("record: %v", err)
	}
	var posted map[string]any
	if err := json.Unmarshal([]byte(requests[1].body), &posted); err != nil {
		t.Fatalf("decode posted body: %v", err)
	}
	if posted["action"] != "agent.delete" || posted["resource_type"] != "agent" || posted["ip"] != "10.0.0.1" {
		t.Fatalf("the recorded entry lost a field: %+v", posted)
	}
	if _, ok := posted["id"]; ok {
		t.Fatalf("the entry was sent with an id: %+v", posted)
	}
	if _, ok := posted["created_at"]; ok {
		t.Fatalf("the entry was sent with a timestamp: %+v", posted)
	}

	rules, err := c.alertRules(ctx)
	if err != nil {
		t.Fatalf("alertRules: %v", err)
	}
	if len(rules) != 1 || rules[0].ID != 3 || rules[0].Metric != "inbound_pending" || rules[0].Threshold != 100 {
		t.Fatalf("unexpected rules: %+v", rules)
	}

	// A created rule reports the id the bus assigned, which is what the console
	// shows next.
	id, err := c.createAlertRule(ctx, model.AlertRule{Severity: "warning", Message: "m", Enabled: true})
	if err != nil {
		t.Fatalf("createAlertRule: %v", err)
	}
	if id != 9 {
		t.Fatalf("id = %d, want 9", id)
	}

	if err := c.deleteAlertRule(ctx, 9); err != nil {
		t.Fatalf("deleteAlertRule: %v", err)
	}
	// Deleting one that is not there is reported, as the SQL's affected-rows check
	// did.
	if err := c.deleteAlertRule(ctx, 404); err == nil {
		t.Fatal("expected an error for a missing alert rule")
	}

	for i, req := range requests {
		if req.auth == "" {
			t.Fatalf("request %d (%s %s) went out without the bus token", i, req.method, req.path)
		}
	}
}

// TestUserAccountClient_TierCounts keeps the console's three columns honest: all
// of them are present even when a tier has nobody in it.
func TestUserAccountClient_TierCounts(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"active":2,"admins":1,"tiers":{"free":1,"pro":1,"ultra":0}}`))
	}))
	defer srv.Close()

	tiers, err := newUserAccountClient(srv.URL).tierCounts(context.Background())
	if err != nil {
		t.Fatalf("tierCounts: %v", err)
	}
	if len(tiers) != 3 || tiers["free"] != 1 || tiers["pro"] != 1 || tiers["ultra"] != 0 {
		t.Fatalf("unexpected tiers: %+v", tiers)
	}
}
