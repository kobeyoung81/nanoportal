package api

import (
	"net/http"
	"net/url"
)

// ======== Voice input (portal -> bus) ========
//
// The composer's dictation settings and its two REST helpers live in the bus,
// which owns the model catalog and the provider credentials. The audio stream
// itself is a WebSocket that nginx proxies straight to the bus (see
// deploy/nginx.conf), so it never passes through this service; the one-time id
// it carries is minted here, on behalf of the verified caller.
//
// Watch the asymmetry on the settings: these routes (write and use) go through
// the bus, while reading them goes through the admin config route, which
// answers from this service's own repository as {component_type, updated_at,
// config:{…}} — a different shape from the bus's {items:[{key, value}]}. The
// browser parses both (web/src/lib/voiceSettings.ts). Changing that read route
// would break the generic Configs page, which expects the repository shape.

// handleVoiceConfig reports whether dictation is available and with which
// models, for the composer to render.
func (server *Server) handleVoiceConfig(w http.ResponseWriter, r *http.Request) {
	server.forwardUserVoice(w, r, "config")
}

// handleVoiceSession mints the single-use id that opens the voice WebSocket.
func (server *Server) handleVoiceSession(w http.ResponseWriter, r *http.Request) {
	server.forwardUserVoice(w, r, "session")
}

// handleVoicePolish rewrites a finished transcript through the configured chat
// model. The bus answers with the original text when polishing is off or the
// model misbehaves, so this never fails the caller's dictation.
func (server *Server) handleVoicePolish(w http.ResponseWriter, r *http.Request) {
	server.forwardUserVoiceBody(w, r, "polish")
}

// handleVoiceTranscribe is the one-shot transcription behind the admin "test
// recognition" button. The body is streamed, so a recording never sits in the
// portal's memory.
func (server *Server) handleVoiceTranscribe(w http.ResponseWriter, r *http.Request) {
	server.forwardUserVoiceBody(w, r, "transcribe")
}

// handleVoiceRefine re-transcribes a finished recording with the batch tier's
// model — the second, higher-accuracy pass the composer runs when a take ends.
// The recording is streamed like the diagnostic upload, so it never sits in this
// service's memory.
func (server *Server) handleVoiceRefine(w http.ResponseWriter, r *http.Request) {
	server.forwardUserVoiceBody(w, r, "refine")
}

// forwardUserVoice forwards a bodyless call, injecting the identity the bus
// trusts. The caller's own user_id in the request is ignored on purpose: the
// bus scopes voice to whoever the portal authenticated.
func (server *Server) forwardUserVoice(w http.ResponseWriter, r *http.Request, action string) {
	userID := server.requireUserID(w, r)
	if userID == "" {
		return
	}
	target := server.busURL() + "/api/v1/user/voice/" + action + "?user_id=" + url.QueryEscape(userID)
	if r.Method == http.MethodGet {
		server.proxy.forwardGET(w, r, target, nil)
		return
	}
	_ = server.proxy.forwardPOST(w, r, target)
}

// forwardUserVoiceBody forwards the request body (JSON, or the multipart audio
// upload) unchanged, with the identity injected the same way.
func (server *Server) forwardUserVoiceBody(w http.ResponseWriter, r *http.Request, action string) {
	userID := server.requireUserID(w, r)
	if userID == "" {
		return
	}
	target := server.busURL() + "/api/v1/user/voice/" + action + "?user_id=" + url.QueryEscape(userID)
	server.proxy.forwardStream(w, r, target)
}
