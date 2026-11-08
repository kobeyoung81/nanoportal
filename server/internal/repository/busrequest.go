package repository

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

// busDo sends one request to the bus and decodes the answer.
//
// The portal has several of these now (configuration, conversations, accounts,
// the audit trail), and they all need the same four things: the shared token
// (added by the client's transport, see bustoken), a JSON body when there is one,
// the bus's own error message when it refuses, and — for the administrative ones —
// a way to tell "not there" from "something is wrong". That last one is why the
// refusal comes back as a *busStatusError rather than a formatted string: a caller
// that wants to answer 404 has to be able to see the status.
func busDo(ctx context.Context, client *http.Client, base, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("bus %s %s: encode body: %w", method, path, err)
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, base+path, reader)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("bus %s %s: %w", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("bus %s %s: read body: %w", method, path, err)
	}
	if resp.StatusCode >= http.StatusBadRequest {
		message := ""
		var payload map[string]any
		if json.Unmarshal(raw, &payload) == nil {
			if m, ok := payload["error"].(string); ok {
				message = m
			}
		}
		return &busStatusError{method: method, path: path, status: resp.StatusCode, err: message}
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("bus %s %s: decode: %w", method, path, err)
	}
	return nil
}

// busStatusError carries the bus's status code so a caller can tell "not there"
// from "something went wrong".
type busStatusError struct {
	method string
	path   string
	status int
	err    string
}

func (e *busStatusError) Error() string {
	if e.err != "" {
		return fmt.Sprintf("bus %s %s: %s", e.method, e.path, e.err)
	}
	return fmt.Sprintf("bus %s %s: %d", e.method, e.path, e.status)
}

// isNotFound reports whether the bus answered 404.
func isNotFound(err error) bool {
	var statusErr *busStatusError
	if errors.As(err, &statusErr) {
		return statusErr.status == http.StatusNotFound
	}
	return false
}
