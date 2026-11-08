package bustoken

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTransportAddsTheToken(t *testing.T) {
	t.Setenv(EnvVar, "s3cret")

	var seen []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Header.Get("Authorization"))
		_, _ = io.WriteString(w, "ok")
	}))
	defer upstream.Close()

	client := &http.Client{Transport: Transport(nil)}
	for i := 0; i < 2; i++ {
		resp, err := client.Get(upstream.URL)
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		resp.Body.Close()
	}

	if len(seen) != 2 {
		t.Fatalf("expected 2 requests, got %d", len(seen))
	}
	for _, header := range seen {
		if header != "Bearer s3cret" {
			t.Errorf("Authorization = %q, want the configured token", header)
		}
	}
}

func TestTransportWithoutTokenSendsNothing(t *testing.T) {
	t.Setenv(EnvVar, "")

	var header string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header = r.Header.Get("Authorization")
		_, _ = io.WriteString(w, "ok")
	}))
	defer upstream.Close()

	client := &http.Client{Transport: Transport(nil)}
	resp, err := client.Get(upstream.URL)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	resp.Body.Close()

	if header != "" {
		t.Errorf("Authorization = %q, want none", header)
	}
}
