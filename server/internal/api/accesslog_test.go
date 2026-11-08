package api

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	buf := &bytes.Buffer{}
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })
	return buf
}

// A failing request is the one that used to leave no trace in the portal's own
// log: the status only existed in nginx's access log.
func TestAccessLogReportsFailedRequests(t *testing.T) {
	buf := captureLog(t)

	handler := accessLog(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/user/v1/agents/a1", nil))

	line := buf.String()
	if !strings.Contains(line, "api request") || !strings.Contains(line, "status=500") {
		t.Fatalf("log = %q, want a 500 api request line", line)
	}
	if !strings.Contains(line, "path=/api/user/v1/agents/a1") {
		t.Fatalf("log = %q, want the request path", line)
	}
}

// A healthy page issues dozens of requests; logging them would bury the signal.
func TestAccessLogStaysQuietOnSuccess(t *testing.T) {
	buf := captureLog(t)

	handler := accessLog(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/user/v1/me", nil))

	if buf.Len() != 0 {
		t.Fatalf("log = %q, want nothing for a 200", buf.String())
	}
}

// A handler that only writes a body still has a status: 200.
func TestStatusRecorderDefaultsToOK(t *testing.T) {
	rec := &statusRecorder{ResponseWriter: httptest.NewRecorder()}
	if _, err := rec.Write([]byte("body")); err != nil {
		t.Fatal(err)
	}
	if rec.status != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.status)
	}
	if rec.bytes != 4 {
		t.Fatalf("bytes = %d, want 4", rec.bytes)
	}
}
