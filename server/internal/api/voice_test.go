package api_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gitee.com/kobeyoung81/nanoportal/server/internal/api"
)

// TestVoiceEndpointsUseTheVerifiedIdentity pins the scoping of every voice
// route: the user whose dictation is served must come from the verified
// identity, never from the request. A caller must not be able to point the
// session mint — or the diagnostic upload — at somebody else's account.
func TestVoiceEndpointsUseTheVerifiedIdentity(t *testing.T) {
	cases := []struct {
		name       string
		method     string
		path       string
		body       string
		wantAction string
	}{
		{"config", http.MethodGet, "/api/user/v1/voice/config", "", "config"},
		{"session", http.MethodPost, "/api/user/v1/voice/session", "", "session"},
		{"polish", http.MethodPost, "/api/user/v1/voice/polish", `{"text":"原文"}`, "polish"},
		{"transcribe", http.MethodPost, "/api/user/v1/voice/transcribe", "RIFF", "transcribe"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var gotPath, gotQuery, gotBody string
			bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath = r.URL.Path
				gotQuery = r.URL.RawQuery
				payload, _ := io.ReadAll(r.Body)
				gotBody = string(payload)
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"status":"ok"}`))
			}))
			defer bus.Close()

			env := newTestEnv(t, "user", api.Backends{BusURL: bus.URL})

			// A user_id in the request must be ignored: the identity decides.
			rec := doRequest(t, env.handler, tc.method, tc.path+"?user_id=someone-else", tc.body, env.token)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
			}
			if want := "/api/v1/user/voice/" + tc.wantAction; gotPath != want {
				t.Fatalf("upstream path = %q, want %q", gotPath, want)
			}
			if gotQuery != "user_id=test-admin" {
				t.Fatalf("upstream query = %q, want user_id=test-admin", gotQuery)
			}
			if tc.body != "" && gotBody != tc.body {
				t.Fatalf("upstream body = %q, want %q", gotBody, tc.body)
			}
		})
	}
}

func TestVoicePolishesThroughTheBus(t *testing.T) {
	var gotBody map[string]any
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"text":"润色后的文本","changed":true}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "user", api.Backends{BusURL: bus.URL})
	rec := doRequest(t, env.handler, http.MethodPost, "/api/user/v1/voice/polish", `{"text":"原文"}`, env.token)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	if gotBody["text"] != "原文" {
		t.Fatalf("upstream body = %v", gotBody)
	}
	if !strings.Contains(rec.Body.String(), "润色后的文本") {
		t.Fatalf("payload not passed through: %q", rec.Body.String())
	}
}

func TestVoiceTranscribePreservesContentType(t *testing.T) {
	var gotContentType string
	bus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotContentType = r.Header.Get("Content-Type")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"text":"你好"}`))
	}))
	defer bus.Close()

	env := newTestEnv(t, "user", api.Backends{BusURL: bus.URL})
	req := httptest.NewRequest(http.MethodPost, "/api/user/v1/voice/transcribe", strings.NewReader("--boundary--"))
	req.Header.Set("Authorization", "Bearer "+env.token)
	req.Header.Set("Content-Type", "multipart/form-data; boundary=boundary")
	rec := httptest.NewRecorder()
	env.handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	if gotContentType != "multipart/form-data; boundary=boundary" {
		t.Fatalf("upstream content type = %q, want the multipart boundary preserved", gotContentType)
	}
}

func TestVoiceEndpointsRequireAToken(t *testing.T) {
	env := newTestEnv(t, "user", api.Backends{})
	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/api/user/v1/voice/config"},
		{http.MethodPost, "/api/user/v1/voice/session"},
		{http.MethodPost, "/api/user/v1/voice/polish"},
		{http.MethodPost, "/api/user/v1/voice/transcribe"},
	} {
		rec := doRequest(t, env.handler, tc.method, tc.path, "", "")
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s: status = %d, want 401", tc.method, tc.path, rec.Code)
		}
	}
}
