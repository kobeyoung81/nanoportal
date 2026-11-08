package api

import (
	"log/slog"
	"net/http"
	"time"
)

// accessLog reports the requests worth a line in the server log: the ones that
// failed and the ones that took long enough to be felt. A portal page issues
// dozens of requests per view, so logging every one would bury the signal —
// nginx already keeps the full access log. The failures are the part that used
// to be invisible: a handler answering 500 or an upstream answering 502 says
// nothing anywhere else.
func accessLog(next http.Handler) http.Handler {
	const slowRequest = 2 * time.Second
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)
		elapsed := time.Since(start)
		status := rec.status
		if status == 0 {
			status = http.StatusOK
		}
		if status < http.StatusBadRequest && elapsed < slowRequest {
			return
		}
		level := slog.LevelInfo
		if status >= http.StatusInternalServerError {
			level = slog.LevelWarn
		}
		slog.Log(r.Context(), level, "api request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", status,
			"bytes", rec.bytes,
			"duration_ms", elapsed.Milliseconds(),
		)
	})
}

// statusRecorder remembers what a handler answered. It forwards Flush so a
// streaming handler keeps working through the wrapper.
type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *statusRecorder) WriteHeader(code int) {
	if r.status == 0 {
		r.status = code
	}
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	n, err := r.ResponseWriter.Write(b)
	r.bytes += n
	return n, err
}

func (r *statusRecorder) Flush() {
	if flusher, ok := r.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}
