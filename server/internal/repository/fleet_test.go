package repository

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"gitee.com/kobeyoung81/nanoportal/server/internal/bustoken"
)

// TestFleetClient_ReadsThroughTheBus pins what the console's fleet page and the
// runtime snapshot depend on: the runners in registration order, the containers
// with the runner they landed on, and the counts the overview prints.
func TestFleetClient_ReadsThroughTheBus(t *testing.T) {
	t.Setenv(bustoken.EnvVar, "test-token")

	var paths []string
	var auth []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.RequestURI())
		auth = append(auth, r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/runners":
			_, _ = w.Write([]byte(`{"runners":[` +
				`{"id":"runner-1","hostname":"host-a","docker_host":"local","status":"online",` +
				`"last_heartbeat":"2026-10-16T04:00:00Z","registered_at":"2026-10-15T04:00:00Z"}]}`))
		case "/api/v1/runners/counts":
			_, _ = w.Write([]byte(`{"online":1}`))
		case "/api/v1/container-requests":
			_, _ = w.Write([]byte(`{"containers":[` +
				`{"id":"c-1","user_id":"u-1","level":"pro","status":"running","runner_id":"runner-1","updated_at":"2026-10-16T04:00:00Z"}]}`))
		case "/api/v1/container-requests/counts":
			_, _ = w.Write([]byte(`{"by_status":{"running":2,"creating":1,"pending":4}}`))
		case "/api/v1/agent-fleet":
			_, _ = w.Write([]byte(`{"agents":[{"id":"agent-1","user_id":"u-1","display_name":"Ada's agent",` +
				`"status":"running","updated_at":"2026-10-16T04:00:00Z"}],"count":1}`))
		case "/api/v1/queues/counts":
			_, _ = w.Write([]byte(`{"inbound_pending":3,"outbound_pending":5}`))
		case "/api/v1/wechat-kf/counts":
			_, _ = w.Write([]byte(`{"accounts":2}`))
		case "/api/v1/user-activity":
			_, _ = w.Write([]byte(`{"activity":{"u-1":"2026-10-16T03:00:00Z"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := newFleetClient(srv.URL)
	ctx := context.Background()

	runners, err := c.runners(ctx)
	if err != nil {
		t.Fatalf("runners: %v", err)
	}
	if len(runners) != 1 || runners[0].ID != "runner-1" || runners[0].Hostname != "host-a" ||
		runners[0].Status != "online" || runners[0].RegisteredAt == "" {
		t.Fatalf("unexpected runners: %+v", runners)
	}

	c1, err := c.containers(ctx, "u-1", 10)
	if err != nil {
		t.Fatalf("containers: %v", err)
	}
	if len(c1) != 1 {
		t.Fatalf("expected one container, got %+v", c1)
	}
	// The two views the console takes of the same payload.
	if state := c1[0].state(); state.ID != "c-1" || state.Status != "running" || state.Level != "pro" {
		t.Fatalf("unexpected container state: %+v", state)
	}
	if runtime := c1[0].runtime(); runtime.RunnerID != "runner-1" || runtime.UserID != "u-1" {
		t.Fatalf("unexpected runtime container: %+v", runtime)
	}
	// The user filter and the limit travelled with the request.
	if paths[1] != "/api/v1/container-requests?limit=10&user_id=u-1" {
		t.Fatalf("unexpected container request: %s", paths[1])
	}

	// Without a user the request carries no filter at all (the snapshot's view).
	if _, err := c.containers(ctx, "", 0); err != nil {
		t.Fatalf("containers: %v", err)
	}
	if paths[2] != "/api/v1/container-requests" {
		t.Fatalf("an empty user should not filter: %s", paths[2])
	}

	if online, err := c.onlineRunners(ctx); err != nil || online != 1 {
		t.Fatalf("online runners = %d (err %v)", online, err)
	}

	buckets, err := c.containerCounts(ctx)
	if err != nil {
		t.Fatalf("containerCounts: %v", err)
	}
	// The caller sums what it shows: "active" is two statuses here.
	if buckets["running"]+buckets["creating"] != 3 || buckets["pending"] != 4 {
		t.Fatalf("unexpected buckets: %+v", buckets)
	}

	inbound, outbound, err := c.queueDepths(ctx)
	if err != nil {
		t.Fatalf("queueDepths: %v", err)
	}
	if inbound != 3 || outbound != 5 {
		t.Fatalf("depths = %d/%d", inbound, outbound)
	}

	accounts, err := c.wechatAccounts(ctx)
	if err != nil {
		t.Fatalf("wechatAccounts: %v", err)
	}
	if accounts != 2 {
		t.Fatalf("accounts = %d, want 2", accounts)
	}

	agents, err := c.agentFleet(ctx, 10)
	if err != nil {
		t.Fatalf("agentFleet: %v", err)
	}
	if len(agents) != 1 || agents[0].ID != "agent-1" || agents[0].UserID != "u-1" ||
		agents[0].DisplayName != "Ada's agent" || agents[0].UpdatedAt == "" {
		t.Fatalf("unexpected agents: %+v", agents)
	}

	activity, err := c.activityByUser(ctx)
	if err != nil {
		t.Fatalf("activityByUser: %v", err)
	}
	if len(activity) != 1 || activity["u-1"] == "" {
		t.Fatalf("unexpected activity: %+v", activity)
	}

	for i, header := range auth {
		if header == "" {
			t.Fatalf("request %d (%s) went out without the bus token", i, paths[i])
		}
	}
}
