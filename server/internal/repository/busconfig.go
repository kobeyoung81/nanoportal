package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"gitee.com/kobeyoung81/nanoportal/server/internal/bustoken"
)

// configClient reads platform configuration from the admin module's REST API.
//
// The portal used to read `service_config_items` straight from MySQL. That made
// one table's schema a contract between two services — so nothing about the
// storage could change without changing both — and, worse, it silently bypassed
// the admin module's write path, which is what makes a running agent pick a
// change up.
//
// Reads ask for the masked view (`?mask=1`): the console is a browser surface,
// and a secret (nanoauth's JWT private key) must not travel to it even though
// this client holds the service token that would allow the plaintext.
type configClient struct {
	base string
	http *http.Client
}

func newConfigClient(busURL string) *configClient {
	return &configClient{
		base: busURL,
		// Every request carries the bus's shared token: the bus refuses its
		// internal endpoints to anonymous callers, and the portal is a caller.
		http: &http.Client{Timeout: 15 * time.Second, Transport: bustoken.Transport(nil)},
	}
}

// components lists the component types that have configuration.
func (c *configClient) components(ctx context.Context) ([]string, error) {
	var payload struct {
		Components []string `json:"components"`
	}
	if err := c.get(ctx, "/api/v1/config", &payload); err != nil {
		return nil, err
	}
	return payload.Components, nil
}

// items reads one component's configuration as a key→value map, with secret
// values masked: the console renders these directly.
func (c *configClient) items(ctx context.Context, componentType string) (map[string]string, error) {
	var payload struct {
		Items []struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		} `json:"items"`
	}
	if err := c.get(ctx, "/api/v1/config/"+url.PathEscape(componentType)+"?mask=1", &payload); err != nil {
		return nil, err
	}
	out := make(map[string]string, len(payload.Items))
	for _, item := range payload.Items {
		out[item.Key] = item.Value
	}
	return out, nil
}

func (c *configClient) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("bus config %s: %w", path, err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("bus config %s: read body: %w", path, err)
	}
	if resp.StatusCode >= http.StatusBadRequest {
		message := fmt.Sprintf("bus %d", resp.StatusCode)
		var payload map[string]any
		if json.Unmarshal(body, &payload) == nil {
			if m, ok := payload["error"].(string); ok && m != "" {
				message = m
			}
		}
		return fmt.Errorf("bus config %s: %s", path, message)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("bus config %s: decode: %w", path, err)
	}
	return nil
}

// updatedAt answers "when did this component's configuration last change". The bus
// computes it from the items' own timestamps — the column it used to come from had
// ON UPDATE CURRENT_TIMESTAMP.
func (c *configClient) updatedAt(ctx context.Context, componentType string) (string, error) {
	var payload struct {
		UpdatedAt string `json:"updated_at"`
	}
	path := "/api/v1/config-updated-at/" + url.PathEscape(componentType)
	if err := c.get(ctx, path, &payload); err != nil {
		return "", err
	}
	return payload.UpdatedAt, nil
}

// count answers a patterned question about a component's items — in practice "how
// many channels are enabled", which is a key prefix/suffix plus a value.
func (c *configClient) count(ctx context.Context, componentType, keyPrefix, keySuffix, value string) (int, error) {
	query := url.Values{}
	query.Set("key_prefix", keyPrefix)
	query.Set("key_suffix", keySuffix)
	query.Set("value", value)
	path := "/api/v1/config-counts/" + url.PathEscape(componentType) + "?" + query.Encode()

	var payload struct {
		Count int `json:"count"`
	}
	if err := c.get(ctx, path, &payload); err != nil {
		return 0, err
	}
	return payload.Count, nil
}
