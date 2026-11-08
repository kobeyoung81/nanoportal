package repository

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"gitee.com/kobeyoung81/nanoportal/server/internal/bustoken"
)

// TestConfigClient_ReadsThroughTheBus pins the two things that would break the
// config centre silently: the payload shapes it decodes, and the internal token
// the bus demands. The token is the easy one to lose — a request without it is
// refused by the bus, which reads in the portal as "the config centre is empty".
func TestConfigClient_ReadsThroughTheBus(t *testing.T) {
	t.Setenv(bustoken.EnvVar, "test-token")

	var paths []string
	var authHeaders []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		authHeaders = append(authHeaders, r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/config":
			_, _ = w.Write([]byte(`{"components":["agent","bus"]}`))
		case "/api/v1/config-updated-at/gateway":
			_, _ = w.Write([]byte(`{"component_type":"gateway","updated_at":"2026-10-16T04:00:00Z"}`))
		case "/api/v1/config-counts/gateway":
			// The pattern and the value travel as query parameters.
			if r.URL.Query().Get("key_prefix") != "channels." || r.URL.Query().Get("key_suffix") != ".enabled" ||
				r.URL.Query().Get("value") != "true" {
				http.Error(w, `{"error":"unexpected filters"}`, http.StatusBadRequest)
				return
			}
			_, _ = w.Write([]byte(`{"component_type":"gateway","count":2}`))
		case "/api/v1/config/agent":
			_, _ = w.Write([]byte(`{"component_type":"agent","items":[` +
				`{"key":"model","value":"m","value_type":"string"},` +
				`{"key":"max_tokens","value":"4096","value_type":"int"}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := newConfigClient(srv.URL)
	ctx := context.Background()

	components, err := c.components(ctx)
	if err != nil {
		t.Fatalf("components: %v", err)
	}
	if len(components) != 2 || components[0] != "agent" || components[1] != "bus" {
		t.Fatalf("components = %v", components)
	}

	updated, err := c.updatedAt(ctx, "gateway")
	if err != nil {
		t.Fatalf("updatedAt: %v", err)
	}
	if updated != "2026-10-16T04:00:00Z" {
		t.Fatalf("updatedAt = %q", updated)
	}

	count, err := c.count(ctx, "gateway", "channels.", ".enabled", "true")
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 2 {
		t.Fatalf("count = %d, want 2", count)
	}

	items, err := c.items(ctx, "agent")
	if err != nil {
		t.Fatalf("items: %v", err)
	}
	if len(items) != 2 || items["model"] != "m" || items["max_tokens"] != "4096" {
		t.Fatalf("items = %v", items)
	}

	for i, header := range authHeaders {
		if header != "Bearer test-token" {
			t.Errorf("request %s carried Authorization %q, want the shared token", paths[i], header)
		}
	}
}

// TestConfigClient_UnreachableBusIsAnError pins that the portal reports a broken
// bus rather than an empty configuration: the config centre distinguishing "no
// settings" from "could not ask" is the difference between a blank page and a
// wrong one.
func TestConfigClient_UnreachableBusIsAnError(t *testing.T) {
	os.Unsetenv(bustoken.EnvVar)

	// A server that is closed immediately: the address is real, nothing answers.
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	url := srv.URL
	srv.Close()

	c := newConfigClient(url)
	if _, err := c.components(context.Background()); err == nil {
		t.Fatal("expected an error when the bus is unreachable")
	}
}
