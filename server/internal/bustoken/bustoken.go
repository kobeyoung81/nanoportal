// Package bustoken carries the shared token the platform's components present
// to the bus's internal endpoints.
//
// The bus refuses its REST API and internal sockets to anonymous callers. Its
// callers are all part of one deployment and are configured together, so a
// single shared secret keeps the change to "send this header" instead of
// per-service identities. The value comes from the environment because it is
// needed before any service can ask the bus for anything.
package bustoken

import (
	"net/http"
	"os"
	"strings"
)

// EnvVar is the environment variable holding the shared token.
const EnvVar = "NANOSEC_BUS_INTERNAL_TOKEN"

// Token returns the configured token, or "" when the deployment has none.
func Token() string {
	return strings.TrimSpace(os.Getenv(EnvVar))
}

// Transport wraps base so every request it sends carries the token. Wrapping
// the transport rather than patching each call site means no request builder
// (there are several: JSON forwards, streams, downloads) can forget it.
func Transport(base http.RoundTripper) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	return tokenTransport{base: base, token: Token()}
}

type tokenTransport struct {
	base  http.RoundTripper
	token string
}

func (t tokenTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if t.token == "" || req.Header.Get("Authorization") != "" {
		return t.base.RoundTrip(req)
	}
	// Clone: RoundTrip must not mutate the caller's request.
	clone := req.Clone(req.Context())
	clone.Header.Set("Authorization", "Bearer "+t.token)
	return t.base.RoundTrip(clone)
}
